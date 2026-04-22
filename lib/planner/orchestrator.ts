import { prisma } from "@/lib/prisma";
import { ClaudeAdapter } from "@/lib/ai/claude-adapter";
import { applyRules, filterSessions, type RuleContext } from "@/lib/rules";
import { noConflictSchedule } from "@/lib/rules/no-conflict-schedule";
import { noOutsideAvailability } from "@/lib/rules/no-outside-availability";
import { minRestHardSessions } from "@/lib/rules/min-rest-hard-sessions";
import { maxWeeklyVolume } from "@/lib/rules/max-weekly-volume";
import type { PlanningContext } from "@/lib/ai/adapter";

const USER_ID = "user_maxon";

const RULES = [
  noConflictSchedule,
  noOutsideAvailability,
  minRestHardSessions,
  maxWeeklyVolume,
];

export async function generateWeeklyPlan(replanReason?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart, 6);

  // Fetch active plan for lineage — not archived until generation succeeds
  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  const [goals, availabilityWindows, scheduleEvents, previousSessions] =
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
      }),
    ]);

  const ruleCtx: RuleContext = {
    availabilityWindows,
    scheduleEvents,
    previousSessions,
    weekStart,
    constraints: user.constraints as Record<string, unknown>,
  };

  const constraints = applyRules(RULES, ruleCtx);

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
    previousSessions,
    weekStart,
    replanReason,
  };

  // LLM call before any DB write — failure leaves DB unchanged
  const planResult = await new ClaudeAdapter().generatePlan(planningCtx);
  const validSessions = filterSessions(planResult.sessions, constraints);

  // Archive old plan + create new plan atomically
  return prisma.$transaction(async (tx) => {
    if (activePlan) {
      await tx.trainingPlan.update({
        where: { id: activePlan.id },
        data: { status: "archived" },
      });
    }

    return tx.trainingPlan.create({
      data: {
        userId: USER_ID,
        startsAt: weekStart,
        endsAt: weekEnd,
        status: "active",
        revision: activePlan ? activePlan.revision + 1 : 1,
        parentPlanId: activePlan?.id ?? null,
        replanReason: replanReason ?? null,
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
  });
}

function currentWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
