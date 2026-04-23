import { prisma } from "@/lib/prisma";
import { ClaudeAdapter } from "@/lib/ai/claude-adapter";
import { applyRules, filterSessions, deduplicateSessions, toDateStr, type RuleContext } from "@/lib/rules";
import { noConflictSchedule } from "@/lib/rules/no-conflict-schedule";
import { noOutsideAvailability } from "@/lib/rules/no-outside-availability";
import { minRestHardSessions } from "@/lib/rules/min-rest-hard-sessions";
import { maxWeeklyVolume } from "@/lib/rules/max-weekly-volume";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { parseFamilyConstraints } from "@/lib/ai/parse-family-constraints";
import { renderChangeExplanation, type ChangeSummaryPayload } from "@/lib/ai/coach-advice";
import type {
  PlanningContext,
  RecentCheckIn,
  FixedSession,
  OptionalSlot,
  WeeklyReview,
  PlannedSession,
  CurrentWeekDoneSession,
} from "@/lib/ai/adapter";

const USER_ID = "user_maxon";

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

  const doneSessions = doneSessionsThisWeek.map((s) => ({
    date: s.date,
    label: friendlyLabel(s.notes, s.intensity as string),
    intensity: s.intensity as string,
  }));

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
  };
}

export async function generateWeeklyPlan(
  replanReason?: string,
  weeklyReview?: WeeklyReview
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = localDateStr(user.timezone);
  const weekStart = currentWeekStart(user.timezone);
  const weekEnd = addDays(weekStart, 6);
  const weekEndStr = toDateStr(weekEnd);

  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
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

  const [
    goals,
    availabilityWindows,
    scheduleEvents,
    rawPreviousSessions,
    recurringSessions,
    prevPlannedSessions,
  ] = await Promise.all([
    prisma.goal.findMany({
      where: { userId: USER_ID, status: "active", deletedAt: null },
    }),
    prisma.availabilityWindow.findMany({
      where: {
        userId: USER_ID,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: weekEnd } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: weekStart } }] },
        ],
      },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId: USER_ID,
        startsAt: { lt: addDays(weekStart, 7) },
        endsAt: { gte: weekStart },
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        scheduledDate: { gte: addDays(weekStart, -7), lt: weekStart },
      },
      include: { checkIn: true },
    }),
    prisma.recurringSession.findMany({
      where: { userId: USER_ID, isActive: true },
    }),
    // Previous plan's still-planned sessions — used for deterministic diff
    activePlan
      ? prisma.trainingSession.findMany({
          where: { planId: activePlan.id, status: "planned" },
        })
      : Promise.resolve([]),
  ]);

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
    })),
    fixedSessions,
    optionalSlots,
    safetyBlockedSessions: safetyBlockedSessions.length > 0 ? safetyBlockedSessions : undefined,
    weeklyReview: parsedWeeklyReview,
    replanReason,
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
        userId: USER_ID,
        startsAt: weekStart,
        endsAt: weekEnd,
        status: "active",
        revision: activePlan ? activePlan.revision + 1 : 1,
        parentPlanId: activePlan?.id ?? null,
        replanReason: replanReason ?? null,
        focusSummary: planResult.focusSummary,
        changeExplanation,
        goals: {
          create: goals.map((g) => ({ goalId: g.id })),
        },
      },
    });

    for (const s of currentWeekDoneSessions) {
      const carried = await tx.trainingSession.create({
        data: {
          planId: newPlan.id,
          userId: USER_ID,
          scheduledDate: s.scheduledDate,
          preferredSlot: s.preferredSlot,
          planningType: s.planningType,
          durationMin: s.durationMin,
          intensity: s.intensity,
          notes: s.notes,
          status: s.status,
        },
      });
      if (s.checkIn) {
        await tx.checkIn.update({
          where: { id: s.checkIn.id },
          data: { sessionId: carried.id },
        });
      }
    }

    if (validSessions.length > 0) {
      await tx.trainingSession.createMany({
        data: validSessions.map((s) => ({
          planId: newPlan.id,
          userId: USER_ID,
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

export async function generateNextWeekDraft(weeklyReview?: WeeklyReview) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

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
  ] = await Promise.all([
    prisma.goal.findMany({
      where: { userId: USER_ID, status: "active", deletedAt: null },
    }),
    prisma.availabilityWindow.findMany({
      where: {
        userId: USER_ID,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: nextWeekEnd } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: nextWeekStart } }] },
        ],
      },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId: USER_ID,
        startsAt: { lt: addDays(nextWeekStart, 7) },
        endsAt: { gte: nextWeekStart },
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        scheduledDate: { gte: thisWeekStart, lt: nextWeekStart },
      },
      include: { checkIn: true },
    }),
    prisma.recurringSession.findMany({
      where: { userId: USER_ID, isActive: true },
    }),
  ]);

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

  // Parse family constraints if present
  let parsedWeeklyReview = weeklyReview;
  if (weeklyReview?.familyConstraints) {
    const parsed = await parseFamilyConstraints(weeklyReview.familyConstraints, todayStr);
    if (parsed.length > 0) {
      parsedWeeklyReview = { ...weeklyReview, parsedConstraints: parsed };
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
    thisWeekCheckIns: [],
    weekStart: nextWeekStart,
    todayStr,
    currentWeekDoneSessions: [],
    fixedSessions,
    optionalSlots,
    safetyBlockedSessions: safetyBlockedSessions.length > 0 ? safetyBlockedSessions : undefined,
    weeklyReview: parsedWeeklyReview,
    replanReason: "weekly review — planning next week",
  };

  const planResult = await new ClaudeAdapter().generatePlan(planningCtx);

  const rawValidNext = filterSessions(planResult.sessions, constraints).filter(
    (s) => toDateStr(s.scheduledDate) >= toDateStr(nextWeekStart)
  );
  const activeRecentCIs = recentCheckIns.filter((c) => !c.resolvedAt);
  const injuryActiveNext = activeRecentCIs.some((c) => c.category === "injury");
  const recoveryOkNext =
    activeRecentCIs.length === 0 || activeRecentCIs.every((c) => c.feelScore >= 5);
  const validSessions = deduplicateSessions(rawValidNext, {
    injuryActive: injuryActiveNext,
    recoveryOk: recoveryOkNext,
  });

  // Archive any existing draft plans, then create the new draft
  await prisma.trainingPlan.updateMany({
    where: { userId: USER_ID, status: "draft" },
    data: { status: "archived" },
  });

  return prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: nextWeekStart,
      endsAt: nextWeekEnd,
      status: "draft",
      revision: 1,
      replanReason: "weekly review",
      focusSummary: planResult.focusSummary,
      goals: {
        create: goals.map((g) => ({ goalId: g.id })),
      },
      sessions: {
        create: validSessions.map((s) => ({
          userId: USER_ID,
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
