/**
 * Smoke test for Phase 2 Step 7: season-block derivation (TrainingPlan.blockPhase
 * / .blockLabel), automatically computed in generateWeeklyPlan from the existing
 * goal-guidance.ts primaryFocus — no manual UI field.
 *
 * NOTE: the original task prompt suggested "~10 weeks out (should land in build)".
 * Per the real derivePhase() thresholds in lib/planner/goal-guidance.ts
 * (<=14d taper, <=56d build, else base), 10 weeks = 70 days actually lands in
 * "base", not "build". Using 40 days out instead so this test actually exercises
 * the "build" branch as intended — flagged in the report, not silently changed.
 *
 * Two throwaway users:
 *  1. build-goal user — one active marathon-discipline goal, target date 40 days
 *     out (build band). Calls generateWeeklyPlan for real (live Anthropic call).
 *     Asserts persisted TrainingPlan.blockPhase === "build" and
 *     blockLabel === "Marathon Build", matching what computeGoalGuidance would
 *     independently compute for the same goal.
 *  2. zero-goals user — no active goals at all. Calls generateWeeklyPlan.
 *     Asserts both blockPhase and blockLabel are null (not fabricated).
 *
 * All synthetic data is deleted afterward regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-season-block.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateWeeklyPlan } from "../lib/planner/orchestrator";
import { computeGoalGuidance } from "../lib/planner/goal-guidance";

const prisma = new PrismaClient();

const DAYS: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

function addDaysUtc(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function seedUser(loginSuffix: string) {
  const user = await prisma.user.create({
    data: {
      name: `Synthetic Smoke Test User (season-block ${loginSuffix})`,
      login: `synthetic_smoke_seasonblock_${loginSuffix}_${Date.now()}`,
      isActive: true,
      timezone: "Europe/Warsaw",
      constraints: { maxContinuousTrainingMinutes: 240 },
    },
  });
  await prisma.availabilityWindow.createMany({
    data: DAYS.map((dayOfWeek) => ({
      userId: user.id,
      dayOfWeek,
      timeStartMin: 360,
      timeEndMin: 1320,
    })),
  });
  return user;
}

async function cleanupUser(userId: string) {
  const plans = await prisma.trainingPlan.findMany({ where: { userId } });
  const planIds = plans.map((p) => p.id);
  if (planIds.length > 0) {
    const sessions = await prisma.trainingSession.findMany({ where: { planId: { in: planIds } } });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await prisma.sessionMetrics.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.sessionWorkoutPlan.deleteMany({ where: { sessionId: { in: sessionIds } } });
    }
    await prisma.trainingSession.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.trainingPlanGoal.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
  }
  await prisma.goal.deleteMany({ where: { userId } });
  await prisma.weekSummary.deleteMany({ where: { userId } });
  await prisma.tunableDefaults.deleteMany({ where: { userId } });
  await prisma.athleteDossier.deleteMany({ where: { userId } });
  await prisma.availabilityWindow.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function main() {
  let exitCode = 0;
  const createdUserIds: string[] = [];
  const todayStr = new Date().toISOString().split("T")[0];

  try {
    // ---------- Test 1: build-phase goal ----------
    console.log(`\n=== Test 1: marathon goal, 40 days out → expect blockPhase="build" ===`);
    const user1 = await seedUser("build");
    createdUserIds.push(user1.id);
    const targetDate1 = addDaysUtc(new Date(todayStr + "T00:00:00Z"), 40);
    const goal1 = await prisma.goal.create({
      data: {
        userId: user1.id,
        title: "Fall Marathon",
        discipline: "Marathon",
        targetDate: targetDate1,
        priority: 1,
        status: "active",
      },
    });

    const expectedGuidance = computeGoalGuidance(
      [{ id: goal1.id, title: goal1.title, discipline: goal1.discipline, targetDate: toDateStr(targetDate1), priority: goal1.priority }],
      todayStr
    );
    console.log(`goal-guidance.ts independently computes phase=${expectedGuidance.primaryFocus?.phase}`);

    const plan1 = await generateWeeklyPlan(user1.id);
    console.log(`persisted TrainingPlan.blockPhase=${plan1.blockPhase} blockLabel=${plan1.blockLabel}`);

    if (plan1.blockPhase === "build" && plan1.blockLabel === "Marathon Build") {
      console.log(`✓ PASS: blockPhase/blockLabel match expected derivation.`);
    } else {
      console.log(`✗ FAIL: expected blockPhase="build", blockLabel="Marathon Build".`);
      exitCode = 1;
    }
    if (plan1.blockPhase !== expectedGuidance.primaryFocus?.phase) {
      console.log(`✗ FAIL: blockPhase diverges from goal-guidance.ts's own primaryFocus.phase.`);
      exitCode = 1;
    }

    // ---------- Test 2: zero active goals ----------
    console.log(`\n=== Test 2: zero active goals → expect blockPhase/blockLabel both null ===`);
    const user2 = await seedUser("nogoals");
    createdUserIds.push(user2.id);

    const plan2 = await generateWeeklyPlan(user2.id);
    console.log(`persisted TrainingPlan.blockPhase=${plan2.blockPhase} blockLabel=${plan2.blockLabel}`);

    if (plan2.blockPhase === null && plan2.blockLabel === null) {
      console.log(`✓ PASS: both fields null, nothing fabricated with zero goals.`);
    } else {
      console.log(`✗ FAIL: expected both null.`);
      exitCode = 1;
    }

    console.log(`\nRESULT: ${exitCode === 0 ? "PASS" : "FAIL"}`);
  } catch (err) {
    exitCode = 1;
    console.error(`\nRESULT: FAIL`);
    console.error(err);
  } finally {
    for (const userId of createdUserIds) {
      try {
        await cleanupUser(userId);
        console.log(`✓ Cleaned up synthetic user ${userId}`);
      } catch (cleanupErr) {
        console.error(`✗ Cleanup failed for ${userId}:`, cleanupErr);
      }
    }
    const remainingChecks = await Promise.all(
      createdUserIds.map(async (userId) => ({
        userId,
        userPresent: (await prisma.user.findUnique({ where: { id: userId } })) !== null,
        leftoverAvailability: await prisma.availabilityWindow.count({ where: { userId } }),
        leftoverGoals: await prisma.goal.count({ where: { userId } }),
      }))
    );
    console.log(`\n✓ Follow-up check: ${JSON.stringify(remainingChecks)}`);
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
