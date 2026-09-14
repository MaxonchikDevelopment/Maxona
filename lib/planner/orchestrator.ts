import { prisma } from "@/lib/prisma";
import { ClaudeAdapter } from "@/lib/ai/claude-adapter";
import { applyRules, filterSessions, deduplicateSessions, toDateStr, type RuleContext } from "@/lib/rules";
import { noConflictSchedule } from "@/lib/rules/no-conflict-schedule";
import { noOutsideAvailability } from "@/lib/rules/no-outside-availability";
import { minRestHardSessions } from "@/lib/rules/min-rest-hard-sessions";
import { maxWeeklyVolume } from "@/lib/rules/max-weekly-volume";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { parseFamilyConstraints } from "@/lib/ai/parse-family-constraints";
import { renderChangeExplanation, renderNextWeekDraftSummary, type ChangeSummaryPayload } from "@/lib/ai/coach-advice";
import { enforceExplicitPreferences } from "@/lib/planner/preference-constraints";
import { parseLLMPreferences } from "@/lib/ai/parse-training-preferences";
import { deriveExecutionDelta, type ExecutionDelta } from "@/lib/planner/execution-delta";
import { computeGoalGuidance } from "@/lib/planner/goal-guidance";
import { getOrCreateTunableDefaults } from "@/lib/planner/tunable-defaults";
import type {
  PlanningContext,
  RecentCheckIn,
  FixedSession,
  OptionalSlot,
  WeeklyReview,
  PlannedSession,
  CurrentWeekDoneSession,
  ReadinessSummary,
  ReadinessEntry,
} from "@/lib/ai/adapter";
import type { PlannedFixedSession } from "@prisma/client";

// Shared between the fixedSessions payload sent to Claude and the
// consumedByPlanId matching after generation, so both sides agree on the
// same label for a given row.
function plannedFixedSessionNotes(ps: PlannedFixedSession): string {
  const label = ps.notes?.trim();
  return label ? `${ps.modality}: ${label}` : ps.modality;
}

const RULES = [
  noConflictSchedule,
  noOutsideAvailability,
  minRestHardSessions,
  maxWeeklyVolume,
];

function getInjuryWindow(
  checkIns: RecentCheckIn[]
): { injuryDate: string; protectUntil: string } | null {
  const activeInjuries = checkIns
    .filter((c) => !c.resolvedAt && c.category === "injury")
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));

  if (activeInjuries.length === 0) return null;

  const injuryDate = activeInjuries[0].sessionDate;
  const injuryDateObj = new Date(injuryDate + "T00:00:00Z");
  return {
    injuryDate,
    protectUntil: toDateStr(addDays(injuryDateObj, 2)),
  };
}

function toGoalGuidanceInputs(
  goals: Array<{ id: string; title: string; discipline: string | null; targetDate: Date | null; priority: number | null }>
) {
  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    discipline: g.discipline,
    targetDate: g.targetDate ? toDateStr(g.targetDate) : null,
    priority: g.priority,
  }));
}

// ─── Readiness summary ───────────────────────────────────────────────────────

function buildReadinessSummary(
  records: Array<{
    date: Date;
    feelScore: number;
    category: string;
    tags: string[];
    notes: string | null;
  }>,
  todayStr: string
): ReadinessSummary | undefined {
  if (records.length === 0) return undefined;

  const entries: ReadinessEntry[] = records
    .map((r) => ({
      date: toDateStr(r.date),
      feelScore: r.feelScore,
      category: r.category,
      tags: r.tags,
      notes: r.notes,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const latestEntry = entries[0];
  const activeWarnings = entries.filter(
    (e) => e.category !== "ok" && e.date >= todayStr
  );

  return {
    latestEntry,
    activeWarnings,
    affectsRemainingWeek: activeWarnings.length > 0,
  };
}

// ─── Diff helpers ────────────────────────────────────────────────────────────

function dayLabel(dateStr: string): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = new Date(dateStr + "T12:00:00Z");
  return DAYS[d.getUTCDay()];
}

// Normalize notes to a canonical modality bucket for diffing.
function modalityKey(notes: string | null | undefined, intensity: string): string {
  const raw = (notes ?? "").toLowerCase();
  if (raw.startsWith("running")) return "running";
  if (raw.startsWith("hyrox")) return "hyrox";
  if (raw.startsWith("cycling")) return "cycling";
  if (raw.startsWith("swimming")) return "swimming";
  return intensity;
}

// Human-readable session label for bullet text.
function friendlyLabel(notes: string | null | undefined, intensity: string): string {
  if (!notes) return intensity;
  const colon = notes.indexOf(":");
  if (colon === -1) return notes.trim(); // "HYROX group class"
  const modality = notes.slice(0, colon).trim();
  const detail = notes.slice(colon + 1).trim();
  const short = detail.split(/\s+/).slice(0, 3).join(" ");
  return short ? `${modality}: ${short}` : modality;
}

// ─── Structured change summary for LLM rendering ─────────────────────────────
// Diffs by date+modality so that same-date modality changes are caught.
// Always matches the final validSessions displayed in the plan.
function buildChangeSummaryPayload({
  prevPlannedSessions,
  newSessions,
  injuryWindow,
  safetyBlockedSessions,
  thisWeekCheckIns,
  weeklyReview,
  replanReason,
  doneSessionsThisWeek,
  readinessSummary,
}: {
  prevPlannedSessions: Array<{
    scheduledDate: Date;
    notes: string | null;
    intensity: string;
    durationMin: number;
  }>;
  newSessions: PlannedSession[];
  injuryWindow: { injuryDate: string; protectUntil: string } | null;
  safetyBlockedSessions: FixedSession[];
  thisWeekCheckIns: RecentCheckIn[];
  weeklyReview?: WeeklyReview;
  replanReason?: string;
  doneSessionsThisWeek: CurrentWeekDoneSession[];
  readinessSummary?: ReadinessSummary;
}): ChangeSummaryPayload {
  const injurySignals = thisWeekCheckIns
    .filter((c) => !c.resolvedAt && c.category === "injury")
    .map((c) => ({ date: c.sessionDate, feelScore: c.feelScore, notes: c.notes }));
  const fatigueSignals = thisWeekCheckIns
    .filter((c) => !c.resolvedAt && c.category === "fatigue")
    .map((c) => ({ date: c.sessionDate, feelScore: c.feelScore, notes: c.notes }));

  const sortedCIs = [...thisWeekCheckIns].sort((a, b) =>
    b.sessionDate.localeCompare(a.sessionDate)
  );
  const latestCheckIn =
    sortedCIs.length > 0
      ? {
          date: sortedCIs[0].sessionDate,
          feelScore: sortedCIs[0].feelScore,
          notes: sortedCIs[0].notes,
          category: sortedCIs[0].category as string,
        }
      : undefined;

  const doneSessions = doneSessionsThisWeek.map((s) => {
    const delta = s.executionDelta;
    let executionQuality: string | undefined;
    let distanceNote: string | undefined;
    if (delta && delta.quality !== "matched") {
      executionQuality = delta.quality;
      if (delta.actualDistanceM != null && delta.plannedDistanceM != null) {
        distanceNote = `${(delta.actualDistanceM / 1000).toFixed(1)} km vs ${(delta.plannedDistanceM / 1000).toFixed(0)} km planned`;
      } else if (Math.abs(delta.durationDeltaMin) >= 5) {
        distanceNote =
          delta.durationDeltaMin > 0
            ? `+${delta.durationDeltaMin}min vs plan`
            : `${delta.durationDeltaMin}min vs plan`;
      }
    }
    return {
      date: s.date,
      label: friendlyLabel(s.notes, s.intensity as string),
      intensity: s.intensity as string,
      ...(executionQuality && { executionQuality }),
      ...(distanceNote && { distanceNote }),
    };
  });

  const safetyBlockedDates = new Set(safetyBlockedSessions.map((s) => s.date));
  const safetyBlockedPayload = safetyBlockedSessions.map((s) => ({
    date: s.date,
    day: dayLabel(s.date),
    label: friendlyLabel(s.notes, s.intensity),
  }));

  type SnapKey = string; // "YYYY-MM-DD|modality"

  const prevByKey = new Map<SnapKey, { date: string; notes: string | null; intensity: string }>();
  for (const s of prevPlannedSessions) {
    const d = toDateStr(s.scheduledDate);
    const key = `${d}|${modalityKey(s.notes, s.intensity)}`;
    if (!prevByKey.has(key)) prevByKey.set(key, { date: d, notes: s.notes, intensity: s.intensity });
  }

  const newByKey = new Map<SnapKey, PlannedSession>();
  for (const s of newSessions) {
    const d = toDateStr(s.scheduledDate);
    const key = `${d}|${modalityKey(s.notes, s.intensity)}`;
    if (!newByKey.has(key)) newByKey.set(key, s);
  }

  const prevKeySet = new Set(prevByKey.keys());
  const newKeySet = new Set(newByKey.keys());

  const removedSessions: ChangeSummaryPayload["removedSessions"] = [];
  for (const [, s] of prevByKey) {
    if (newKeySet.has(`${s.date}|${modalityKey(s.notes, s.intensity)}`)) continue;
    if (safetyBlockedDates.has(s.date)) continue;

    let reason: string;
    if (injuryWindow && s.date > injuryWindow.injuryDate && s.date <= injuryWindow.protectUntil) {
      const ci = injurySignals[0];
      reason = `injury window${ci ? ` (feel ${ci.feelScore}/6)` : ""}`;
    } else if (injurySignals.length > 0) {
      reason = `active injury (feel ${injurySignals[0].feelScore}/6)`;
    } else if (fatigueSignals.length > 0) {
      reason = `fatigue signal (feel ${fatigueSignals[0].feelScore}/6)`;
    } else {
      reason = "schedule or availability change";
    }
    removedSessions.push({
      date: s.date,
      day: dayLabel(s.date),
      label: friendlyLabel(s.notes, s.intensity),
      reason,
    });
  }

  const addedSessions: ChangeSummaryPayload["addedSessions"] = [];
  for (const [, s] of newByKey) {
    const d = toDateStr(s.scheduledDate);
    if (prevKeySet.has(`${d}|${modalityKey(s.notes, s.intensity)}`)) continue;
    addedSessions.push({
      date: d,
      day: dayLabel(d),
      label: friendlyLabel(s.notes, s.intensity),
      intensity: s.intensity,
    });
  }

  const remainingPlannedSessions = newSessions.map((s) => {
    const d = toDateStr(s.scheduledDate);
    return {
      date: d,
      day: dayLabel(d),
      label: friendlyLabel(s.notes, s.intensity),
      intensity: s.intensity,
      durationMin: s.durationMin,
    };
  });

  const plannerMode: ChangeSummaryPayload["plannerMode"] =
    injurySignals.length > 0 || safetyBlockedPayload.length > 0
      ? "protecting"
      : fatigueSignals.length > 0
      ? "reducing"
      : addedSessions.length > 0 && removedSessions.length === 0
      ? "building"
      : "maintaining";

  return {
    replanReason,
    doneSessionsThisWeek: doneSessions,
    latestCheckIn,
    injurySignals,
    fatigueSignals,
    safetyBlockedSessions: safetyBlockedPayload,
    removedSessions,
    addedSessions,
    remainingPlannedSessions,
    weeklyReviewPriority: weeklyReview?.priorities?.[0],
    readinessSignal: readinessSummary?.latestEntry
      ? {
          date: readinessSummary.latestEntry.date,
          feelScore: readinessSummary.latestEntry.feelScore,
          category: readinessSummary.latestEntry.category,
          tags: readinessSummary.latestEntry.tags,
          notes: readinessSummary.latestEntry.notes,
        }
      : undefined,
    plannerMode,
  };
}

export async function generateWeeklyPlan(
  userId: string,
  replanReason?: string,
  weeklyReview?: WeeklyReview
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const todayStr = localDateStr(user.timezone);
  const weekStart = currentWeekStart(user.timezone);
  const weekEnd = addDays(weekStart, 6);
  const weekEndStr = toDateStr(weekEnd);

  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  const currentWeekDoneSessions = activePlan
    ? await prisma.trainingSession.findMany({
        where: {
          planId: activePlan.id,
          status: { in: ["done", "skipped"] },
        },
        include: { checkIn: true },
      })
    : [];

  // Future manual sessions that are still planned — carried to new plan unchanged.
  // We move them (same as done sessions) so user-created workouts survive replanning.
  const currentWeekManualPlannedSessions = activePlan
    ? await prisma.trainingSession.findMany({
        where: {
          planId: activePlan.id,
          planningType: "manual",
          status: "planned",
        },
      })
    : [];

  const [
    goals,
    availabilityWindows,
    scheduleEvents,
    rawPreviousSessions,
    recurringSessions,
    prevPlannedSessions,
    weeklyReadinessList,
    weekSummaryHistory,
  ] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, status: "active", deletedAt: null },
    }),
    prisma.availabilityWindow.findMany({
      where: {
        userId,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: weekEnd } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: weekStart } }] },
        ],
      },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId,
        startsAt: { lt: addDays(weekStart, 7) },
        endsAt: { gte: weekStart },
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        userId,
        scheduledDate: { gte: addDays(weekStart, -7), lt: weekStart },
      },
      include: { checkIn: true },
    }),
    prisma.recurringSession.findMany({
      where: { userId, isActive: true },
    }),
    // Previous plan's still-planned sessions — used for deterministic diff
    activePlan
      ? prisma.trainingSession.findMany({
          where: { planId: activePlan.id, status: "planned" },
        })
      : Promise.resolve([]),
    prisma.dailyReadiness.findMany({
      where: { userId, date: { gte: weekStart, lte: weekEnd } },
      orderBy: { date: "desc" },
    }),
    // Last few completed weeks — multi-week trend signal for planning
    prisma.weekSummary.findMany({
      where: { userId, weekStart: { lt: weekStart } },
      orderBy: { weekStart: "desc" },
      take: 4,
    }),
  ]);

  // Oldest → newest for a readable trajectory
  const weekHistory = [...weekSummaryHistory].reverse().map((w) => {
    const signals = (w.signals ?? {}) as { mainLimiter?: string | null };
    return {
      weekStart: toDateStr(w.weekStart),
      adherenceByCount: w.adherenceByCount,
      hardDone: w.hardDone,
      hardPlanned: w.hardPlanned,
      avgFeelScore: w.avgFeelScore,
      mainLimiter: signals.mainLimiter ?? null,
      carryForward: w.carryForward,
    };
  });

  // Strava execution deltas — separate batch query avoids Prisma 6 multi-include type bug
  const sessionDeltas = new Map<string, ExecutionDelta>();
  if (currentWeekDoneSessions.length > 0) {
    const doneStravaLinks = await prisma.sessionStravaActivityLink.findMany({
      where: { sessionId: { in: currentWeekDoneSessions.map((s) => s.id) } },
      include: { activity: true },
      orderBy: { isPrimary: "desc" },
    });
    const linksBySession = new Map<string, typeof doneStravaLinks>();
    for (const l of doneStravaLinks) {
      const list = linksBySession.get(l.sessionId) ?? [];
      list.push(l);
      linksBySession.set(l.sessionId, list);
    }
    for (const s of currentWeekDoneSessions) {
      const links = linksBySession.get(s.id);
      if (!links?.length) continue;
      const delta = deriveExecutionDelta(
        { durationMin: s.durationMin, notes: s.notes, intensity: s.intensity },
        links.map((l) => l.activity)
      );
      if (delta) sessionDeltas.set(s.id, delta);
    }
  }

  // Previous-week check-ins with category
  const recentCheckIns: RecentCheckIn[] = rawPreviousSessions
    .filter((s) => s.checkIn != null)
    .map((s) => ({
      sessionId: s.id,
      sessionDate: toDateStr(s.scheduledDate),
      sessionIntensity: s.intensity,
      feelScore: s.checkIn!.feelScore,
      notes: s.checkIn!.notes,
      resolvedAt: s.checkIn!.resolvedAt ? s.checkIn!.resolvedAt.toISOString() : null,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
    }));

  // Current-week check-ins — highest priority signal
  const thisWeekCheckIns: RecentCheckIn[] = currentWeekDoneSessions
    .filter((s) => s.checkIn != null)
    .map((s) => ({
      sessionId: s.id,
      sessionDate: toDateStr(s.scheduledDate),
      sessionIntensity: s.intensity,
      feelScore: s.checkIn!.feelScore,
      notes: s.checkIn!.notes,
      resolvedAt: s.checkIn!.resolvedAt ? s.checkIn!.resolvedAt.toISOString() : null,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
    }));

  const readinessSummary = buildReadinessSummary(weeklyReadinessList, todayStr);

  // Parse family constraints from free text (Haiku call, non-blocking on failure)
  let parsedWeeklyReview = weeklyReview;
  if (weeklyReview?.familyConstraints) {
    const parsed = await parseFamilyConstraints(
      weeklyReview.familyConstraints,
      todayStr
    );
    if (parsed.length > 0) {
      parsedWeeklyReview = { ...weeklyReview, parsedConstraints: parsed };
    }
  }

  // Split recurring sessions into fixed vs optional
  const doneDateSet = new Set(
    currentWeekDoneSessions.map((s) => toDateStr(s.scheduledDate))
  );
  const DAY_OFFSET: Record<string, number> = {
    mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
  };

  const allFixedSessions: FixedSession[] = [];
  const allOptionalSlots: OptionalSlot[] = [];

  for (const rs of recurringSessions) {
    const offset = DAY_OFFSET[rs.dayOfWeek] ?? 0;
    const date = toDateStr(addDays(weekStart, offset));
    if (date < todayStr || doneDateSet.has(date)) continue;

    const entry = {
      date,
      preferredSlot: rs.preferredSlot,
      durationMin: rs.durationMin,
      intensity: rs.intensity,
      notes: rs.notes,
    };

    if (rs.planningType === "preferred") {
      allOptionalSlots.push(entry);
    } else {
      allFixedSessions.push(entry);
    }
  }

  // Deterministic injury safety override
  const injuryWindow = getInjuryWindow(thisWeekCheckIns);

  const safetyBlockedSessions: FixedSession[] = [];
  let fixedSessions = allFixedSessions;
  let optionalSlots = allOptionalSlots;

  if (injuryWindow) {
    fixedSessions = [];
    for (const fs of allFixedSessions) {
      if (fs.date > injuryWindow.injuryDate && fs.date <= injuryWindow.protectUntil) {
        safetyBlockedSessions.push(fs);
      } else {
        fixedSessions.push(fs);
      }
    }
    optionalSlots = allOptionalSlots.filter(
      (os) =>
        !(os.date > injuryWindow.injuryDate && os.date <= injuryWindow.protectUntil)
    );
  }

  const ruleCtx: RuleContext = {
    availabilityWindows,
    scheduleEvents,
    previousSessions: rawPreviousSessions,
    weekStart,
    constraints: user.constraints as Record<string, unknown>,
  };

  const constraints = applyRules(RULES, ruleCtx);

  const doneMinutesThisWeek = currentWeekDoneSessions.reduce(
    (sum, s) => sum + s.durationMin,
    0
  );
  const adjustedConstraints = {
    ...constraints,
    maxWeeklyMinutes: Math.max(0, constraints.maxWeeklyMinutes - doneMinutesThisWeek),
    blockedHardSessionDates: [...constraints.blockedHardSessionDates],
  };

  // Deterministically block hard sessions in the injury protection window
  if (injuryWindow) {
    let cursor = addDays(new Date(injuryWindow.injuryDate + "T00:00:00Z"), 1);
    while (toDateStr(cursor) <= injuryWindow.protectUntil) {
      adjustedConstraints.blockedHardSessionDates.push(toDateStr(cursor));
      cursor = addDays(cursor, 1);
    }
  }

  const [dossier, tunableDefaults] = await Promise.all([
    prisma.athleteDossier.findUnique({ where: { userId } }),
    getOrCreateTunableDefaults(userId),
  ]);

  const planningCtx: PlanningContext = {
    user: {
      id: user.id,
      name: user.name,
      timezone: user.timezone,
      constraints: user.constraints as Record<string, unknown>,
    },
    goals,
    availabilityWindows,
    scheduleEvents,
    previousSessions: rawPreviousSessions,
    recentCheckIns,
    thisWeekCheckIns,
    weekStart,
    todayStr,
    currentWeekDoneSessions: currentWeekDoneSessions.map((s) => ({
      date: toDateStr(s.scheduledDate),
      durationMin: s.durationMin,
      intensity: s.intensity,
      notes: s.notes,
      status: s.status,
      ...(sessionDeltas.has(s.id) && { executionDelta: sessionDeltas.get(s.id) }),
    })),
    fixedSessions,
    optionalSlots,
    safetyBlockedSessions: safetyBlockedSessions.length > 0 ? safetyBlockedSessions : undefined,
    weeklyReview: parsedWeeklyReview,
    replanReason,
    readinessSummary,
    goalGuidance: computeGoalGuidance(toGoalGuidanceInputs(goals), todayStr),
    weekHistory: weekHistory.length > 0 ? weekHistory : undefined,
    athleteDossier: {
      facts: (dossier?.facts as Record<string, unknown>) ?? {},
      version: dossier?.version ?? 0,
    },
    tunableDefaults: {
      hrDisciplinePct: tunableDefaults.hrDisciplinePct,
      efStopThresholdPct: tunableDefaults.efStopThresholdPct,
      jumpRatioCeiling: tunableDefaults.jumpRatioCeiling,
      safetyPattern: tunableDefaults.safetyPattern,
      rationale: tunableDefaults.rationale,
    },
  };

  const planResult = await new ClaudeAdapter().generatePlan(planningCtx);

  const rawValid = filterSessions(planResult.sessions, adjustedConstraints);
  const dateFiltered = rawValid.filter((s) => {
    const dateStr = toDateStr(s.scheduledDate);
    return dateStr >= todayStr && dateStr <= weekEndStr && !doneDateSet.has(dateStr);
  });
  const activeThisWeekCIs = thisWeekCheckIns.filter((c) => !c.resolvedAt);
  const injuryActive = activeThisWeekCIs.some((c) => c.category === "injury");
  const recoveryOk =
    activeThisWeekCIs.length === 0 || activeThisWeekCIs.every((c) => c.feelScore >= 5);
  const validSessions = deduplicateSessions(dateFiltered, { injuryActive, recoveryOk });

  // LLM-authored changeExplanation grounded in deterministic diff payload
  const changeExplanation = replanReason
    ? await renderChangeExplanation(
        buildChangeSummaryPayload({
          prevPlannedSessions: prevPlannedSessions.filter((s: { scheduledDate: Date }) => {
            const d = toDateStr(s.scheduledDate);
            return d >= todayStr && d <= weekEndStr;
          }),
          newSessions: validSessions,
          injuryWindow,
          safetyBlockedSessions,
          thisWeekCheckIns,
          weeklyReview: parsedWeeklyReview,
          replanReason,
          doneSessionsThisWeek: planningCtx.currentWeekDoneSessions,
          readinessSummary,
        })
      )
    : null;

  return prisma.$transaction(async (tx) => {
    if (activePlan) {
      await tx.trainingPlan.update({
        where: { id: activePlan.id },
        data: { status: "archived" },
      });
    }

    const newPlan = await tx.trainingPlan.create({
      data: {
        userId,
        startsAt: weekStart,
        endsAt: weekEnd,
        status: "active",
        revision: activePlan ? activePlan.revision + 1 : 1,
        parentPlanId: activePlan?.id ?? null,
        replanReason: replanReason ?? null,
        focusSummary: buildDeterministicFocusSummary(validSessions),
        changeExplanation,
        goals: {
          create: goals.map((g) => ({ goalId: g.id })),
        },
      },
    });

    // Move done/skipped sessions to the new plan by updating planId only.
    // This preserves session IDs so CheckIn and SessionStravaActivityLink FKs stay intact.
    if (currentWeekDoneSessions.length > 0) {
      await tx.trainingSession.updateMany({
        where: { id: { in: currentWeekDoneSessions.map((s) => s.id) } },
        data: { planId: newPlan.id },
      });
    }

    // Carry forward user-created manual sessions that are still planned.
    // They survive replanning unchanged — user owns them, LLM doesn't touch them.
    if (currentWeekManualPlannedSessions.length > 0) {
      await tx.trainingSession.updateMany({
        where: { id: { in: currentWeekManualPlannedSessions.map((s) => s.id) } },
        data: { planId: newPlan.id },
      });
    }

    if (validSessions.length > 0) {
      await tx.trainingSession.createMany({
        data: validSessions.map((s) => ({
          planId: newPlan.id,
          userId,
          scheduledDate: s.scheduledDate,
          preferredSlot: s.preferredSlot,
          planningType: s.planningType,
          durationMin: s.durationMin,
          intensity: s.intensity,
          notes: s.notes ?? null,
        })),
      });
    }

    return newPlan;
  });
}

export async function generateNextWeekDraft(userId: string, weeklyReview?: WeeklyReview) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const todayStr = localDateStr(user.timezone);
  const thisWeekStart = currentWeekStart(user.timezone);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const [
    goals,
    availabilityWindows,
    scheduleEvents,
    currentWeekSessions,
    recurringSessions,
    weekSummaryHistory,
    plannedFixedSessions,
  ] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, status: "active", deletedAt: null },
    }),
    prisma.availabilityWindow.findMany({
      where: {
        userId,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: nextWeekEnd } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: nextWeekStart } }] },
        ],
      },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId,
        startsAt: { lt: addDays(nextWeekStart, 7) },
        endsAt: { gte: nextWeekStart },
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        userId,
        scheduledDate: { gte: thisWeekStart, lt: nextWeekStart },
      },
      include: { checkIn: true },
    }),
    prisma.recurringSession.findMany({
      where: { userId, isActive: true },
    }),
    // Last few completed weeks — multi-week trend signal for planning
    prisma.weekSummary.findMany({
      where: { userId, weekStart: { lt: nextWeekStart } },
      orderBy: { weekStart: "desc" },
      take: 4,
    }),
    // Athlete-declared one-off fixed sessions for next week (survive regeneration)
    prisma.plannedFixedSession.findMany({
      where: { userId, scheduledDate: { gte: nextWeekStart, lte: nextWeekEnd } },
    }),
  ]);

  // Oldest → newest for a readable trajectory
  const weekHistory = [...weekSummaryHistory].reverse().map((w) => {
    const signals = (w.signals ?? {}) as { mainLimiter?: string | null };
    return {
      weekStart: toDateStr(w.weekStart),
      adherenceByCount: w.adherenceByCount,
      hardDone: w.hardDone,
      hardPlanned: w.hardPlanned,
      avgFeelScore: w.avgFeelScore,
      mainLimiter: signals.mainLimiter ?? null,
      carryForward: w.carryForward,
    };
  });

  // Current week check-ins as the most recent signal going into next week
  const recentCheckIns: RecentCheckIn[] = currentWeekSessions
    .filter((s) => s.checkIn != null)
    .map((s) => ({
      sessionId: s.id,
      sessionDate: toDateStr(s.scheduledDate),
      sessionIntensity: s.intensity,
      feelScore: s.checkIn!.feelScore,
      notes: s.checkIn!.notes,
      resolvedAt: s.checkIn!.resolvedAt ? s.checkIn!.resolvedAt.toISOString() : null,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
    }));

  // Completed/skipped sessions from the week just finished — the highest-priority
  // retrospective signal for next week's draft (mirrors thisWeekCheckIns/
  // currentWeekDoneSessions treatment in generateWeeklyPlan).
  const doneSessionsThisWeek = currentWeekSessions.filter(
    (s) => s.status === "done" || s.status === "skipped"
  );

  const nextWeekSessionDeltas = new Map<string, ExecutionDelta>();
  if (doneSessionsThisWeek.length > 0) {
    const doneStravaLinks = await prisma.sessionStravaActivityLink.findMany({
      where: { sessionId: { in: doneSessionsThisWeek.map((s) => s.id) } },
      include: { activity: true },
      orderBy: { isPrimary: "desc" },
    });
    const linksBySession = new Map<string, typeof doneStravaLinks>();
    for (const l of doneStravaLinks) {
      const list = linksBySession.get(l.sessionId) ?? [];
      list.push(l);
      linksBySession.set(l.sessionId, list);
    }
    for (const s of doneSessionsThisWeek) {
      const links = linksBySession.get(s.id);
      if (!links?.length) continue;
      const delta = deriveExecutionDelta(
        { durationMin: s.durationMin, notes: s.notes, intensity: s.intensity },
        links.map((l) => l.activity)
      );
      if (delta) nextWeekSessionDeltas.set(s.id, delta);
    }
  }

  const thisWeekCheckIns: RecentCheckIn[] = doneSessionsThisWeek
    .filter((s) => s.checkIn != null)
    .map((s) => ({
      sessionId: s.id,
      sessionDate: toDateStr(s.scheduledDate),
      sessionIntensity: s.intensity,
      feelScore: s.checkIn!.feelScore,
      notes: s.checkIn!.notes,
      resolvedAt: s.checkIn!.resolvedAt ? s.checkIn!.resolvedAt.toISOString() : null,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
    }));

  // Parse family constraints and training preferences (both async, run in parallel)
  let parsedWeeklyReview = weeklyReview;
  const [familyParsed, parsedPreferences] = await Promise.all([
    weeklyReview?.familyConstraints
      ? parseFamilyConstraints(weeklyReview.familyConstraints, todayStr)
      : Promise.resolve([] as import("@/lib/ai/adapter").ParsedTemporalConstraint[]),
    weeklyReview?.trainingPreferencesText
      ? parseLLMPreferences(weeklyReview.trainingPreferencesText)
      : Promise.resolve(undefined),
  ]);
  if (familyParsed.length > 0) {
    parsedWeeklyReview = { ...weeklyReview, parsedConstraints: familyParsed };
  }

  if (process.env.NODE_ENV !== "production") {
    if (weeklyReview?.trainingPreferencesText) {
      console.log("[orchestrator] raw trainingPreferencesText:", weeklyReview.trainingPreferencesText);
    }
    if (parsedPreferences) {
      console.log("[orchestrator] parsedPreferences:", JSON.stringify(parsedPreferences, null, 2));
    }
  }

  // Build fixed / optional slots for next week
  const DAY_OFFSET: Record<string, number> = {
    mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
  };

  const allFixedSessions: FixedSession[] = [];
  const allOptionalSlots: OptionalSlot[] = [];

  for (const rs of recurringSessions) {
    const offset = DAY_OFFSET[rs.dayOfWeek] ?? 0;
    const date = toDateStr(addDays(nextWeekStart, offset));
    const entry = {
      date,
      preferredSlot: rs.preferredSlot,
      durationMin: rs.durationMin,
      intensity: rs.intensity,
      notes: rs.notes,
    };
    if (rs.planningType === "preferred") {
      allOptionalSlots.push(entry);
    } else {
      allFixedSessions.push(entry);
    }
  }

  // Athlete-declared one-off fixed sessions — same treatment as recurring fixed
  // sessions (validated against availability/conflict rules downstream, not an
  // override). notes are modality-prefixed so modalityKey/diff logic recognises them.
  for (const ps of plannedFixedSessions) {
    allFixedSessions.push({
      date: toDateStr(ps.scheduledDate),
      preferredSlot: ps.preferredSlot,
      durationMin: ps.durationMin,
      intensity: ps.intensity,
      notes: plannedFixedSessionNotes(ps),
    });
  }

  // Injury window check — active injuries now affect next week's planning
  const injuryWindow = getInjuryWindow(recentCheckIns);
  let fixedSessions = allFixedSessions;
  let optionalSlots = allOptionalSlots;
  const safetyBlockedSessions: FixedSession[] = [];

  if (injuryWindow) {
    fixedSessions = [];
    for (const fs of allFixedSessions) {
      if (fs.date > injuryWindow.injuryDate && fs.date <= injuryWindow.protectUntil) {
        safetyBlockedSessions.push(fs);
      } else {
        fixedSessions.push(fs);
      }
    }
    optionalSlots = allOptionalSlots.filter(
      (os) => !(os.date > injuryWindow.injuryDate && os.date <= injuryWindow.protectUntil)
    );
  }

  const ruleCtx: RuleContext = {
    availabilityWindows,
    scheduleEvents,
    previousSessions: currentWeekSessions,
    weekStart: nextWeekStart,
    constraints: user.constraints as Record<string, unknown>,
  };
  const constraints = applyRules(RULES, ruleCtx);

  if (injuryWindow) {
    let cursor = addDays(new Date(injuryWindow.injuryDate + "T00:00:00Z"), 1);
    while (toDateStr(cursor) <= injuryWindow.protectUntil) {
      constraints.blockedHardSessionDates.push(toDateStr(cursor));
      cursor = addDays(cursor, 1);
    }
  }

  const [nextWeekDossier, nextWeekTunableDefaults] = await Promise.all([
    prisma.athleteDossier.findUnique({ where: { userId } }),
    getOrCreateTunableDefaults(userId),
  ]);

  const planningCtx: PlanningContext = {
    user: {
      id: user.id,
      name: user.name,
      timezone: user.timezone,
      constraints: user.constraints as Record<string, unknown>,
    },
    goals,
    availabilityWindows,
    scheduleEvents,
    previousSessions: currentWeekSessions,
    recentCheckIns,
    thisWeekCheckIns,
    weekStart: nextWeekStart,
    todayStr,
    currentWeekDoneSessions: doneSessionsThisWeek.map((s) => ({
      date: toDateStr(s.scheduledDate),
      durationMin: s.durationMin,
      intensity: s.intensity,
      notes: s.notes,
      status: s.status,
      ...(nextWeekSessionDeltas.has(s.id) && { executionDelta: nextWeekSessionDeltas.get(s.id) }),
    })),
    fixedSessions,
    optionalSlots,
    safetyBlockedSessions: safetyBlockedSessions.length > 0 ? safetyBlockedSessions : undefined,
    weeklyReview: parsedWeeklyReview,
    replanReason: "weekly review — planning next week",
    parsedPreferences,
    goalGuidance: computeGoalGuidance(toGoalGuidanceInputs(goals), todayStr),
    weekHistory: weekHistory.length > 0 ? weekHistory : undefined,
    athleteDossier: {
      facts: (nextWeekDossier?.facts as Record<string, unknown>) ?? {},
      version: nextWeekDossier?.version ?? 0,
    },
    tunableDefaults: {
      hrDisciplinePct: nextWeekTunableDefaults.hrDisciplinePct,
      efStopThresholdPct: nextWeekTunableDefaults.efStopThresholdPct,
      jumpRatioCeiling: nextWeekTunableDefaults.jumpRatioCeiling,
      safetyPattern: nextWeekTunableDefaults.safetyPattern,
      rationale: nextWeekTunableDefaults.rationale,
    },
  };

  const planResult = await new ClaudeAdapter().generatePlan(planningCtx);

  const rawValidNext = filterSessions(planResult.sessions, constraints).filter(
    (s) => toDateStr(s.scheduledDate) >= toDateStr(nextWeekStart)
  );
  const activeRecentCIs = recentCheckIns.filter((c) => !c.resolvedAt);
  const injuryActiveNext = activeRecentCIs.some((c) => c.category === "injury");
  const recoveryOkNext =
    activeRecentCIs.length === 0 || activeRecentCIs.every((c) => c.feelScore >= 5);
  const dedupedSessions = deduplicateSessions(rawValidNext, {
    injuryActive: injuryActiveNext,
    recoveryOk: recoveryOkNext,
  });

  // Deterministically enforce preference constraints after Claude generation.
  const prefs = parsedPreferences;
  let enforcedSessions = dedupedSessions;
  let unmetPreferences: string[] = [];

  const hasPrefs = prefs && (
    prefs.explicitDayRequests.length > 0 ||
    prefs.sacrificedModalities.length > 0 ||
    prefs.desiredModalities.length > 0 ||
    (prefs.availabilityHints?.length ?? 0) > 0
  );

  if (process.env.NODE_ENV !== "production") {
    console.log(
      "[orchestrator] sessions before enforcement:",
      dedupedSessions.map(s => ({
        date: toDateStr(s.scheduledDate),
        modality: modalityKey(s.notes, s.intensity),
        intensity: s.intensity,
        slot: s.preferredSlot,
      }))
    );
  }

  if (hasPrefs && prefs) {
    const enforced = enforceExplicitPreferences(
      dedupedSessions,
      prefs,
      nextWeekStart,
      scheduleEvents,
      constraints.blockedHardSessionDates,
      user.constraints as Record<string, unknown>
    );
    enforcedSessions = enforced.sessions;
    unmetPreferences = enforced.unmetPreferences;
  }

  if (process.env.NODE_ENV !== "production" && unmetPreferences.length > 0) {
    console.log("[orchestrator] unmet preferences:", unmetPreferences);
  }

  const validSessions = deduplicateSessions(enforcedSessions, {
    injuryActive: injuryActiveNext,
    recoveryOk: recoveryOkNext,
  });

  // Archive any existing draft plans, then create the new draft
  await prisma.trainingPlan.updateMany({
    where: { userId, status: "draft" },
    data: { status: "archived" },
  });

  const deterministicSummary = buildDeterministicFocusSummary(validSessions, unmetPreferences);
  const focusSummary = await renderNextWeekDraftSummary({
    sessions: validSessions,
    deterministicSummary,
    parsedPreferences: parsedPreferences ?? undefined,
    unmetPreferences,
  });

  const draft = await prisma.trainingPlan.create({
    data: {
      userId,
      startsAt: nextWeekStart,
      endsAt: nextWeekEnd,
      status: "draft",
      revision: 1,
      replanReason: "weekly review",
      focusSummary,
      goals: {
        create: goals.map((g) => ({ goalId: g.id })),
      },
      sessions: {
        create: validSessions.map((s) => ({
          userId,
          scheduledDate: s.scheduledDate,
          preferredSlot: s.preferredSlot,
          planningType: s.planningType,
          durationMin: s.durationMin,
          intensity: s.intensity,
          notes: s.notes ?? null,
        })),
      },
    },
  });

  // Mark declared fixed sessions as consumed by this draft — but only the ones that
  // actually survived rules filtering/dedup into the persisted set. A fixed session
  // can still be dropped (e.g. blocked date, hard-session spacing); stamping it as
  // consumed regardless would hide that it silently vanished from the plan. Rows
  // persist across regenerations (queried by date, not plan), so we re-stamp the
  // latest draft id for whichever ones made it in this time.
  const survivingFixedKeys = new Set(
    validSessions
      .filter((s) => s.planningType === "fixed")
      .map((s) => `${toDateStr(s.scheduledDate)}|${s.notes ?? ""}`)
  );

  const consumedIds: string[] = [];
  for (const ps of plannedFixedSessions) {
    const key = `${toDateStr(ps.scheduledDate)}|${plannedFixedSessionNotes(ps)}`;
    if (survivingFixedKeys.has(key)) {
      consumedIds.push(ps.id);
    } else {
      console.warn(
        `[orchestrator] fixed session dropped from draft ${draft.id}: ` +
          `${toDateStr(ps.scheduledDate)} "${plannedFixedSessionNotes(ps)}" ` +
          `(plannedFixedSession id=${ps.id}) did not survive into the persisted plan — ` +
          `leaving consumedByPlanId null so it's retried on next generation.`
      );
    }
  }

  if (consumedIds.length > 0) {
    await prisma.plannedFixedSession.updateMany({
      where: { id: { in: consumedIds } },
      data: { consumedByPlanId: draft.id },
    });
  }

  return draft;
}

function buildDeterministicFocusSummary(sessions: PlannedSession[], unmetPreferences?: string[]): string {
  if (sessions.length === 0) {
    const unmetNote = unmetPreferences?.length ? " " + unmetPreferences.join(" ") : "";
    return "Rest week." + unmetNote;
  }

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const counts = { running: 0, hyrox: 0, cycling: 0, swimming: 0 };
  const hyroxDays: string[] = [];
  let longRunDay: string | null = null;

  for (const s of sessions) {
    const notes = (s.notes ?? "").toLowerCase();
    const dayName = DAY_NAMES[new Date(s.scheduledDate).getUTCDay()];
    if (notes.startsWith("running")) {
      counts.running++;
      if (notes.includes("long run") || s.durationMin >= 90) longRunDay = dayName;
    } else if (notes.startsWith("hyrox")) {
      counts.hyrox++;
      hyroxDays.push(dayName);
    } else if (notes.startsWith("cycling")) {
      counts.cycling++;
    } else if (notes.startsWith("swimming")) {
      counts.swimming++;
    }
  }

  const sentences: string[] = [];

  // Lead: describe the week's structural focus
  if (counts.hyrox >= 2 && counts.running >= 1) {
    const runStr = counts.running === 1 ? "one run" : `${counts.running} runs`;
    const longNote = longRunDay ? `, including a long run on ${longRunDay}` : "";
    sentences.push(
      `HYROX is on ${hyroxDays.join(" and ")}, with ${runStr} spread around it${longNote}.`
    );
  } else if (counts.hyrox === 1 && counts.running >= 2) {
    const longNote = longRunDay ? ` with the long run on ${longRunDay}` : "";
    sentences.push(
      `Running is the main focus this week (${counts.running} sessions${longNote}), with one HYROX session on ${hyroxDays[0]}.`
    );
  } else if (counts.running >= 3 && counts.hyrox === 0) {
    const longNote = longRunDay ? `, long run on ${longRunDay}` : "";
    sentences.push(`Running-focused week with ${counts.running} sessions${longNote}.`);
  } else if (counts.hyrox >= 2 && counts.running === 0) {
    sentences.push(`HYROX-focused week with sessions on ${hyroxDays.join(" and ")}.`);
  } else {
    // Fallback compact list
    const parts: string[] = [];
    if (counts.running > 0)
      parts.push(`${counts.running} run${counts.running !== 1 ? "s" : ""}${longRunDay ? ` (long ${longRunDay})` : ""}`);
    if (counts.hyrox > 0)
      parts.push(`${counts.hyrox} HYROX${hyroxDays.length ? ` (${hyroxDays.join(", ")})` : ""}`);
    if (counts.cycling > 0)
      parts.push(counts.cycling === 1 ? "cycling" : `${counts.cycling}× cycling`);
    if (counts.swimming > 0)
      parts.push(counts.swimming === 1 ? "swimming" : `${counts.swimming}× swimming`);
    sentences.push(parts.join(", ") + ".");
  }

  // Cycling / swimming addendum
  if (counts.cycling === 1) {
    sentences.push("One easy cycling session adds low-impact aerobic volume.");
  } else if (counts.cycling > 1) {
    sentences.push(`${counts.cycling} cycling sessions for aerobic volume.`);
  }
  if (counts.swimming === 1) {
    sentences.push("Swimming is included for active recovery.");
  } else if (counts.swimming > 1) {
    sentences.push(`${counts.swimming} swimming sessions for active recovery.`);
  }

  // Unmet preferences: only real blocks, not false cap claims
  if (unmetPreferences && unmetPreferences.length > 0) {
    for (const msg of unmetPreferences) {
      sentences.push(msg.endsWith(".") ? msg : msg + ".");
    }
  }

  return sentences.join(" ");
}

function localDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentWeekStart(tz: string): Date {
  const todayStr = localDateStr(tz);
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayUtc = new Date(Date.UTC(y, m - 1, d));
  const dow = todayUtc.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(todayUtc);
  monday.setUTCDate(todayUtc.getUTCDate() - daysFromMonday);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
