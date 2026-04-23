import { prisma } from "@/lib/prisma";
import { ClaudeAdapter } from "@/lib/ai/claude-adapter";
import { applyRules, filterSessions, toDateStr, type RuleContext } from "@/lib/rules";
import { noConflictSchedule } from "@/lib/rules/no-conflict-schedule";
import { noOutsideAvailability } from "@/lib/rules/no-outside-availability";
import { minRestHardSessions } from "@/lib/rules/min-rest-hard-sessions";
import { maxWeeklyVolume } from "@/lib/rules/max-weekly-volume";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { parseFamilyConstraints } from "@/lib/ai/parse-family-constraints";
import type {
  PlanningContext,
  RecentCheckIn,
  FixedSession,
  OptionalSlot,
  WeeklyReview,
  PlannedSession,
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

// Deterministic changeExplanation — generated from actual final sessions, never from LLM intent.
function buildChangeExplanation({
  prevPlannedSessions,
  newSessions,
  injuryWindow,
  safetyBlockedSessions,
  thisWeekCheckIns,
  weeklyReview,
  replanReason,
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
}): string {
  const bullets: string[] = [];

  const injurySignals = thisWeekCheckIns.filter(
    (c) => c.category === "injury" && !c.resolvedAt
  );
  const fatigueSignals = thisWeekCheckIns.filter(
    (c) => c.category === "fatigue" && !c.resolvedAt
  );

  // 1. Safety-blocked fixed sessions (deterministic — these are always accurate)
  for (const blocked of safetyBlockedSessions) {
    if (bullets.length >= 4) break;
    const day = dayLabel(blocked.date);
    const type = (blocked.notes ?? "session").split(":")[0].trim();
    const ci = injurySignals[0];
    const scoreStr = ci ? ` (feelScore ${ci.feelScore}/6)` : "";
    bullets.push(`• ${day} ${type} cancelled → injury protection${scoreStr}`);
  }

  // 2. Diff prev planned vs new sessions by date
  const prevByDate = new Map<
    string,
    { notes: string | null; intensity: string; durationMin: number }
  >();
  for (const s of prevPlannedSessions) {
    const d = toDateStr(s.scheduledDate);
    if (!prevByDate.has(d)) prevByDate.set(d, s);
  }

  const newDates = new Set(newSessions.map((s) => toDateStr(s.scheduledDate)));
  const prevDates = new Set(prevByDate.keys());

  // Removed sessions
  for (const [date, s] of prevByDate) {
    if (bullets.length >= 4) break;
    if (!newDates.has(date)) {
      const day = dayLabel(date);
      const type = (s.notes ?? s.intensity).split(":")[0].trim();
      let reason = "rescheduled";
      if (
        injuryWindow &&
        date > injuryWindow.injuryDate &&
        date <= injuryWindow.protectUntil
      ) {
        reason = "injury protection window";
      } else if (injurySignals.length > 0) {
        reason = `active injury (${injurySignals[0].feelScore}/6)`;
      } else if (fatigueSignals.length > 0) {
        reason = `fatigue signals (${fatigueSignals[0].feelScore}/6)`;
      }
      bullets.push(`• Removed ${day} ${type} → ${reason}`);
    }
  }

  // Added sessions
  const addedByDate = new Map<string, PlannedSession>();
  for (const s of newSessions) {
    const d = toDateStr(s.scheduledDate);
    if (!prevDates.has(d) && !addedByDate.has(d)) addedByDate.set(d, s);
  }
  for (const [date, s] of addedByDate) {
    if (bullets.length >= 4) break;
    const day = dayLabel(date);
    const type = (s.notes ?? s.intensity).split(":")[0].trim();
    bullets.push(`• Added ${day} ${type}`);
  }

  // 3. Catch-all signal summary if diff was empty
  if (bullets.length < 2) {
    if (injurySignals.length > 0 && safetyBlockedSessions.length === 0) {
      bullets.push(
        `• Hard sessions blocked → active injury (feelScore ${injurySignals[0].feelScore}/6)`
      );
    } else if (fatigueSignals.length > 0) {
      bullets.push(
        `• Load eased → fatigue this week (feelScore ${fatigueSignals[0].feelScore}/6)`
      );
    }
  }

  // 4. Weekly review priority
  if (weeklyReview?.priorities?.length && bullets.length < 4) {
    bullets.push(`• Focus: ${weeklyReview.priorities[0].toLowerCase()}`);
  }

  // 5. Fallback
  if (bullets.length === 0) {
    bullets.push(`• Plan updated → ${replanReason ?? "manual replan"}`);
  }

  return bullets.slice(0, 4).join("\n");
}

function dayLabel(dateStr: string): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = new Date(dateStr + "T12:00:00Z");
  return DAYS[d.getUTCDay()];
}

export async function generateWeeklyPlan(
  replanReason?: string,
  weeklyReview?: WeeklyReview
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = localDateStr(user.timezone);
  const weekStart = currentWeekStart(user.timezone);
  const weekEnd = addDays(weekStart, 6);

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
  const validSessions = rawValid.filter((s) => {
    const dateStr = toDateStr(s.scheduledDate);
    return dateStr >= todayStr && !doneDateSet.has(dateStr);
  });

  // Generate deterministic changeExplanation from the FINAL sessions (always matches what's displayed)
  const changeExplanation = replanReason
    ? buildChangeExplanation({
        prevPlannedSessions,
        newSessions: validSessions,
        injuryWindow,
        safetyBlockedSessions,
        thisWeekCheckIns,
        weeklyReview: parsedWeeklyReview,
        replanReason,
      })
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
