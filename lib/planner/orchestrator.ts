import { prisma } from "@/lib/prisma";
import { ClaudeAdapter } from "@/lib/ai/claude-adapter";
import { applyRules, filterSessions, toDateStr, type RuleContext } from "@/lib/rules";
import { noConflictSchedule } from "@/lib/rules/no-conflict-schedule";
import { noOutsideAvailability } from "@/lib/rules/no-outside-availability";
import { minRestHardSessions } from "@/lib/rules/min-rest-hard-sessions";
import { maxWeeklyVolume } from "@/lib/rules/max-weekly-volume";
import type { PlanningContext, RecentCheckIn, FixedSession, OptionalSlot, WeeklyReview } from "@/lib/ai/adapter";

const USER_ID = "user_maxon";

const RULES = [
  noConflictSchedule,
  noOutsideAvailability,
  minRestHardSessions,
  maxWeeklyVolume,
];

const INJURY_KEYWORDS = [
  "injury", "pain", "hurt", "sore", "leg", "knee", "ankle", "back",
  "hip", "muscle", "hamstring", "calf", "shin", "groin", "shoulder",
];

function hasInjuryKeywords(notes: string | null): boolean {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return INJURY_KEYWORDS.some((kw) => lower.includes(kw));
}

function getInjuryWindow(
  checkIns: RecentCheckIn[]
): { injuryDate: string; protectUntil: string } | null {
  const activeInjuries = checkIns
    .filter((c) => !c.resolvedAt && c.feelScore <= 2 && hasInjuryKeywords(c.notes))
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));

  if (activeInjuries.length === 0) return null;

  const injuryDate = activeInjuries[0].sessionDate;
  const injuryDateObj = new Date(injuryDate + "T00:00:00Z");
  return {
    injuryDate,
    protectUntil: toDateStr(addDays(injuryDateObj, 2)),
  };
}

export async function generateWeeklyPlan(replanReason?: string, weeklyReview?: WeeklyReview) {
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

  const [goals, availabilityWindows, scheduleEvents, rawPreviousSessions, recurringSessions] =
    await Promise.all([
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
    ]);

  // Previous-week check-ins — include resolvedAt so Claude knows which are cleared
  const recentCheckIns: RecentCheckIn[] = rawPreviousSessions
    .filter((s) => s.checkIn != null)
    .map((s) => ({
      sessionId: s.id,
      sessionDate: toDateStr(s.scheduledDate),
      sessionIntensity: s.intensity,
      feelScore: s.checkIn!.feelScore,
      notes: s.checkIn!.notes,
      resolvedAt: s.checkIn!.resolvedAt ? s.checkIn!.resolvedAt.toISOString() : null,
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
    }));

  // Split recurring sessions into fixed (guaranteed) vs optional (planner may choose)
  const doneDateSet = new Set(currentWeekDoneSessions.map((s) => toDateStr(s.scheduledDate)));
  const DAY_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

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

  // Deterministic injury safety override — remove fixed/optional sessions
  // that fall within 2 days of an ACTIVE injury check-in.
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
      (os) => !(os.date > injuryWindow.injuryDate && os.date <= injuryWindow.protectUntil)
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
    weeklyReview,
    replanReason,
  };

  const planResult = await new ClaudeAdapter().generatePlan(planningCtx);

  const rawValid = filterSessions(planResult.sessions, adjustedConstraints);
  const validSessions = rawValid.filter((s) => {
    const dateStr = toDateStr(s.scheduledDate);
    return dateStr >= todayStr && !doneDateSet.has(dateStr);
  });

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
        changeExplanation: planResult.changeExplanation ?? null,
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
