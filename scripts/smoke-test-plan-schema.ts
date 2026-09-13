/**
 * Smoke test for the new submit_plan tool schema (structured session-output
 * fields: distanceKm, targetPaceMinPerKm, targetHrZone, subtype).
 *
 * Creates a throwaway dummy user (never touches user_maxon), gives it the
 * minimal viable planning context — one active Goal, wide-open availability
 * for a full week, no prior sessions — and calls generateWeeklyPlan(userId)
 * for real (real Anthropic API call, not mocked). Confirms the call succeeds
 * with no tool-schema validation error, the plan has sessions, and reports
 * whether the new structured fields came back populated for a running or
 * cycling session.
 *
 * All synthetic data is deleted afterward regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-plan-schema.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateWeeklyPlan } from "../lib/planner/orchestrator";
import { ClaudeAdapter } from "../lib/ai/claude-adapter";
import type { PlanResult } from "../lib/ai/adapter";

const prisma = new PrismaClient();

// Capture the raw PlanResult straight from the adapter so we can inspect the
// new structured fields before orchestrator-side filtering/persistence
// (TrainingSession has no columns for them, so they never reach the DB).
let capturedPlanResult: PlanResult | null = null;
const originalGeneratePlan = ClaudeAdapter.prototype.generatePlan;
ClaudeAdapter.prototype.generatePlan = async function (...args) {
  const result = await originalGeneratePlan.apply(this, args);
  capturedPlanResult = result;
  return result;
};

const DUMMY_LOGIN = `synthetic_smoke_test_${Date.now()}`;
const DAYS: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

async function main() {
  let dummyUserId: string | null = null;
  let goalId: string | null = null;
  let exitCode = 0;

  try {
    const dummyUser = await prisma.user.create({
      data: {
        name: "Synthetic Smoke Test User",
        login: DUMMY_LOGIN,
        isActive: true,
        timezone: "Europe/Warsaw",
        constraints: { maxContinuousTrainingMinutes: 240 },
      },
    });
    dummyUserId = dummyUser.id;
    console.log(`✓ Created dummy user: ${dummyUserId}`);

    await prisma.availabilityWindow.createMany({
      data: DAYS.map((dayOfWeek) => ({
        userId: dummyUserId!,
        dayOfWeek,
        timeStartMin: 360, // 06:00
        timeEndMin: 1320, // 22:00
      })),
    });
    console.log(`✓ Seeded wide-open availability windows (all 7 days)`);

    const goal = await prisma.goal.create({
      data: {
        userId: dummyUserId,
        title: "Sub-4h marathon",
        discipline: "running",
        targetDate: new Date(Date.UTC(2027, 3, 1)),
        priority: 1,
        status: "active",
      },
    });
    goalId = goal.id;
    console.log(`✓ Seeded active goal: ${goalId}`);

    console.log(`\nCalling generateWeeklyPlan(${dummyUserId})...\n`);
    const plan = await generateWeeklyPlan(dummyUserId);

    const sessions = await prisma.trainingSession.findMany({
      where: { planId: plan.id },
      orderBy: { scheduledDate: "asc" },
    });

    console.log(`\n✓ generateWeeklyPlan succeeded — no tool-schema validation error.`);
    console.log(`Plan ${plan.id} has ${sessions.length} session(s).`);

    if (sessions.length === 0) {
      console.log(`✗ FAIL: plan has zero sessions.`);
      exitCode = 1;
    }

    for (const s of sessions) {
      console.log(
        `  - ${s.scheduledDate.toISOString().split("T")[0]} ${s.preferredSlot} ` +
          `${s.intensity} ${s.durationMin}min :: ${s.notes}`
      );
    }

    const rawSessions = capturedPlanResult?.sessions ?? [];
    const runOrCycle = rawSessions.find((s) =>
      /^(running|cycling)/i.test((s.notes ?? "").trim())
    );

    if (runOrCycle) {
      console.log(`\nStructured fields on raw PlanResult session "${runOrCycle.notes}":`);
      console.log(`  distanceKm: ${JSON.stringify(runOrCycle.distanceKm)}`);
      console.log(`  targetPaceMinPerKm: ${JSON.stringify(runOrCycle.targetPaceMinPerKm)}`);
      console.log(`  targetHrZone: ${JSON.stringify(runOrCycle.targetHrZone)}`);
      console.log(`  subtype: ${JSON.stringify(runOrCycle.subtype)}`);
      console.log(`  (Not persisted to TrainingSession — no DB columns exist for these fields.)`);
    } else {
      console.log(`\nNo running/cycling session in the returned plan to inspect structured fields on.`);
    }

    console.log(`\nRESULT: PASS`);
  } catch (err) {
    exitCode = 1;
    console.error(`\nRESULT: FAIL`);
    console.error(err);
  } finally {
    if (dummyUserId) {
      const plans = await prisma.trainingPlan.findMany({ where: { userId: dummyUserId } });
      const planIds = plans.map((p) => p.id);
      if (planIds.length > 0) {
        await prisma.trainingSession.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlanGoal.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
      }
      if (goalId) {
        await prisma.goal.deleteMany({ where: { id: goalId } });
      }
      await prisma.availabilityWindow.deleteMany({ where: { userId: dummyUserId } });
      await prisma.user.delete({ where: { id: dummyUserId } });
      console.log(`\n✓ Cleaned up synthetic user ${dummyUserId} and all related rows.`);

      const remaining = await prisma.user.findUnique({ where: { id: dummyUserId } });
      const remainingAvail = await prisma.availabilityWindow.count({ where: { userId: dummyUserId } });
      console.log(
        `✓ Follow-up check: user present=${remaining !== null}, leftover availability rows=${remainingAvail}`
      );
    }
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
