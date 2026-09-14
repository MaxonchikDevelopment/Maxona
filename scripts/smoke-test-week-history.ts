/**
 * Smoke test for Phase 2 Step 4: weekHistory extended to generateWeeklyPlan,
 * and SessionMetrics (decouplingPct / efWhole) rolled into persistWeekSummary.
 *
 * Creates a throwaway dummy user (never touches user_maxon) with:
 *  - one archived past-week TrainingPlan containing 2 done sessions, one with
 *    SessionMetrics.decouplingValid=true and one with decouplingValid=false
 *  - an active goal + wide-open availability so generateWeeklyPlan can run
 *
 * Calls persistWeekSummary directly on the archived week and asserts the
 * signals.avgDecouplingPct only reflects the valid session, then calls
 * generateWeeklyPlan(userId) for real (real Anthropic API call, not mocked)
 * and logs PlanningContext.weekHistory right before the Claude call to
 * confirm it is non-empty and carries the new decoupling/EF fields.
 *
 * All synthetic data is deleted afterward regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-week-history.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateWeeklyPlan } from "../lib/planner/orchestrator";
import { persistWeekSummary } from "../lib/week-summary";
import { ClaudeAdapter } from "../lib/ai/claude-adapter";
import type { PlanningContext } from "../lib/ai/adapter";

const prisma = new PrismaClient();

// Capture the PlanningContext straight from the adapter call so we can
// inspect weekHistory exactly as it reaches Claude.
let capturedCtx: PlanningContext | null = null;
const originalGeneratePlan = ClaudeAdapter.prototype.generatePlan;
ClaudeAdapter.prototype.generatePlan = async function (ctx: PlanningContext) {
  capturedCtx = ctx;
  return originalGeneratePlan.call(this, ctx);
};

const DUMMY_LOGIN = `synthetic_smoke_weekhistory_${Date.now()}`;
const DAYS: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

function addDaysUtc(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

async function main() {
  let dummyUserId: string | null = null;
  let goalId: string | null = null;
  let archivedPlanId: string | null = null;
  let exitCode = 0;

  try {
    const dummyUser = await prisma.user.create({
      data: {
        name: "Synthetic Smoke Test User (weekHistory)",
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
        timeStartMin: 360,
        timeEndMin: 1320,
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

    // Archived past week: 14 days ago through 8 days ago — safely before
    // the current week's start regardless of weekday.
    const archivedStart = addDaysUtc(new Date(), -14);
    archivedStart.setUTCHours(0, 0, 0, 0);
    const archivedEnd = addDaysUtc(archivedStart, 6);

    const archivedPlan = await prisma.trainingPlan.create({
      data: {
        userId: dummyUserId,
        startsAt: archivedStart,
        endsAt: archivedEnd,
        status: "archived",
        revision: 1,
        focusSummary: "Synthetic archived week for weekHistory smoke test",
      },
    });
    archivedPlanId = archivedPlan.id;
    console.log(`✓ Created archived plan ${archivedPlanId} (${archivedStart.toISOString().split("T")[0]} → ${archivedEnd.toISOString().split("T")[0]})`);

    const validSession = await prisma.trainingSession.create({
      data: {
        planId: archivedPlanId,
        userId: dummyUserId,
        scheduledDate: addDaysUtc(archivedStart, 1),
        preferredSlot: "morning",
        planningType: "generated",
        durationMin: 60,
        intensity: "moderate",
        status: "done",
        notes: "Running: easy 10km",
      },
    });
    const invalidSession = await prisma.trainingSession.create({
      data: {
        planId: archivedPlanId,
        userId: dummyUserId,
        scheduledDate: addDaysUtc(archivedStart, 3),
        preferredSlot: "morning",
        planningType: "generated",
        durationMin: 45,
        intensity: "hard",
        status: "done",
        notes: "Running: tempo 8km",
      },
    });
    console.log(`✓ Created 2 done sessions in the archived week`);

    await prisma.sessionMetrics.create({
      data: {
        sessionId: validSession.id,
        source: "synthetic",
        movingTimeSec: 3600,
        elapsedTimeSec: 3650,
        pauses: [],
        distanceKm: 10,
        efWhole: 0.0150,
        decouplingPct: 3.2,
        decouplingValid: true,
      },
    });
    await prisma.sessionMetrics.create({
      data: {
        sessionId: invalidSession.id,
        source: "synthetic",
        movingTimeSec: 1200,
        elapsedTimeSec: 1250,
        pauses: [],
        distanceKm: 3,
        efWhole: 0.0180,
        decouplingPct: 25.0, // implausible — this is why decouplingValid is false
        decouplingValid: false,
      },
    });
    console.log(`✓ Created SessionMetrics: 1 decouplingValid=true (3.2%), 1 decouplingValid=false (25.0%)`);

    // --- Part A: persistWeekSummary averaging ---
    const sessionsForSummary = await prisma.trainingSession.findMany({
      where: { planId: archivedPlanId },
      include: {
        checkIn: true,
        stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
        metrics: true,
      },
    });

    const ok = await persistWeekSummary(prisma, dummyUserId, archivedPlan, sessionsForSummary, []);
    console.log(`\npersistWeekSummary returned: ${ok}`);

    const weekSummary = await prisma.weekSummary.findUnique({
      where: { userId_weekStart: { userId: dummyUserId, weekStart: archivedStart } },
    });

    if (!weekSummary) {
      console.log(`✗ FAIL: no WeekSummary row was persisted.`);
      exitCode = 1;
    } else {
      const signals = weekSummary.signals as {
        avgDecouplingPct?: number;
        decouplingSessionCount?: number;
        avgEfWhole?: number;
        efSessionCount?: number;
      };
      console.log(`WeekSummary.signals: ${JSON.stringify(signals, null, 2)}`);

      if (signals.avgDecouplingPct === 3.2 && signals.decouplingSessionCount === 1) {
        console.log(`✓ PASS: avgDecouplingPct only reflects the valid session (3.2%, count=1).`);
      } else {
        console.log(
          `✗ FAIL: expected avgDecouplingPct=3.2/count=1, got ${signals.avgDecouplingPct}/${signals.decouplingSessionCount}`
        );
        exitCode = 1;
      }

      const expectedAvgEf = parseFloat(((0.015 + 0.018) / 2).toFixed(3));
      if (signals.avgEfWhole === expectedAvgEf && signals.efSessionCount === 2) {
        console.log(`✓ PASS: avgEfWhole averages both sessions (no validity flag) — ${expectedAvgEf}, count=2.`);
      } else {
        console.log(`✗ FAIL: expected avgEfWhole=${expectedAvgEf}/count=2, got ${signals.avgEfWhole}/${signals.efSessionCount}`);
        exitCode = 1;
      }
    }

    // --- Part B: generateWeeklyPlan receives non-empty weekHistory ---
    console.log(`\nCalling generateWeeklyPlan(${dummyUserId})...\n`);
    const plan = await generateWeeklyPlan(dummyUserId);
    console.log(`✓ generateWeeklyPlan succeeded — plan ${plan.id}`);

    console.log(`\nPlanningContext.weekHistory as received by ClaudeAdapter.generatePlan:`);
    console.log(JSON.stringify(capturedCtx?.weekHistory, null, 2));

    if (capturedCtx?.weekHistory && capturedCtx.weekHistory.length > 0) {
      console.log(`✓ PASS: weekHistory is non-empty (${capturedCtx.weekHistory.length} week(s)).`);
      const entry = capturedCtx.weekHistory.find((w) => w.avgDecouplingPct != null);
      if (entry) {
        console.log(`✓ PASS: weekHistory entry carries avgDecouplingPct=${entry.avgDecouplingPct}, decouplingSessionCount=${entry.decouplingSessionCount}`);
      } else {
        console.log(`✗ FAIL: no weekHistory entry carried avgDecouplingPct.`);
        exitCode = 1;
      }
    } else {
      console.log(`✗ FAIL: generateWeeklyPlan's PlanningContext.weekHistory was empty/undefined.`);
      exitCode = 1;
    }

    console.log(`\nRESULT: ${exitCode === 0 ? "PASS" : "FAIL"}`);
  } catch (err) {
    exitCode = 1;
    console.error(`\nRESULT: FAIL`);
    console.error(err);
  } finally {
    if (dummyUserId) {
      const plans = await prisma.trainingPlan.findMany({ where: { userId: dummyUserId } });
      const planIds = plans.map((p) => p.id);
      if (planIds.length > 0) {
        const sessions = await prisma.trainingSession.findMany({ where: { planId: { in: planIds } } });
        const sessionIds = sessions.map((s) => s.id);
        if (sessionIds.length > 0) {
          await prisma.sessionMetrics.deleteMany({ where: { sessionId: { in: sessionIds } } });
        }
        await prisma.trainingSession.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlanGoal.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
      }
      await prisma.weekSummary.deleteMany({ where: { userId: dummyUserId } });
      if (goalId) {
        await prisma.goal.deleteMany({ where: { id: goalId } });
      }
      await prisma.availabilityWindow.deleteMany({ where: { userId: dummyUserId } });
      await prisma.tunableDefaults.deleteMany({ where: { userId: dummyUserId } });
      await prisma.athleteDossier.deleteMany({ where: { userId: dummyUserId } });
      await prisma.user.delete({ where: { id: dummyUserId } });
      console.log(`\n✓ Cleaned up synthetic user ${dummyUserId} and all related rows.`);

      const remaining = await prisma.user.findUnique({ where: { id: dummyUserId } });
      const remainingAvail = await prisma.availabilityWindow.count({ where: { userId: dummyUserId } });
      const remainingSummaries = await prisma.weekSummary.count({ where: { userId: dummyUserId } });
      console.log(
        `✓ Follow-up check: user present=${remaining !== null}, leftover availability rows=${remainingAvail}, leftover WeekSummary rows=${remainingSummaries}`
      );
    }
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
