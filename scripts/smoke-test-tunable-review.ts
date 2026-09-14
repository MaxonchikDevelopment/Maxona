/**
 * Smoke test for Phase 2 Step 5: silent weekly TunableDefaults review,
 * wired into lib/planner/rollover.ts's activateDraftIfReady right after
 * persistWeekSummary succeeds for an archived week.
 *
 * Three throwaway users, each exercised through the REAL activateDraftIfReady
 * rollover path (not a direct call to the review function) so the wiring
 * itself is under test:
 *
 *  1. worsening-trend user — 2 prior WeekSummary rows with a rising
 *     avgDecouplingPct trend, plus an outgoing active-plan week with 2 done
 *     sessions (SessionMetrics showing decoupling worse than the trend) and
 *     a draft plan ready to activate. Expects a NEW TunableDefaults row,
 *     rationale citing real numbers, direction reported (not asserted).
 *  2. zero-done user — outgoing week has sessions but none marked "done".
 *     Expects NO new TunableDefaults row.
 *  3. LLM-failure user — same setup as (1), but ANTHROPIC_MODEL is
 *     temporarily pointed at an invalid model name for the duration of the
 *     rollover call. Expects activateDraftIfReady to still return true (the
 *     archive/activate transaction completes) and no new TunableDefaults row
 *     (the review failed and was swallowed). ANTHROPIC_MODEL is restored
 *     immediately after.
 *
 * All synthetic data is deleted afterward regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-tunable-review.ts
 */

import { PrismaClient } from "@prisma/client";
import { activateDraftIfReady } from "../lib/planner/rollover";

const prisma = new PrismaClient();

const DAYS: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

function addDaysUtc(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfWeekUtc(daysAgo: number): Date {
  const d = addDaysUtc(new Date(), daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function seedUser(loginSuffix: string) {
  const user = await prisma.user.create({
    data: {
      name: `Synthetic Smoke Test User (tunable-review ${loginSuffix})`,
      login: `synthetic_smoke_tunablereview_${loginSuffix}_${Date.now()}`,
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

async function seedWeekHistoryRow(userId: string, weekStart: Date, avgDecouplingPct: number, seq: number) {
  const weekEnd = addDaysUtc(weekStart, 6);
  await prisma.weekSummary.create({
    data: {
      userId,
      weekStart,
      weekEnd,
      planned: 4,
      done: 4,
      skipped: 0,
      plannedDurationMin: 240,
      actualMovingMin: 235,
      adherenceByCount: 100,
      adherenceByDuration: 98,
      hardPlanned: 1,
      hardDone: 1,
      avgFeelScore: 5,
      executionQuality: { matched: 4, slightlyShort: 0, clearlyShort: 0, longerThanPlanned: 0, interrupted: 0, hillyVariant: 0, splitSessions: 0 },
      signals: {
        lowReadinessDays: 0,
        fatigueDays: 0,
        injuryDays: 0,
        unresolvedIssues: 0,
        mainLimiter: null,
        avgDecouplingPct,
        decouplingSessionCount: 1,
        avgEfWhole: 0.015 + seq * 0.001,
        efSessionCount: 1,
      },
      keySessions: [],
      carryForward: [],
    },
  });
}

/** Outgoing "active" plan + "draft" plan so activateDraftIfReady triggers rollover. */
async function seedRolloverPlans(userId: string, opts: { doneSessions: boolean; decouplingPct?: number }) {
  const activeStart = startOfWeekUtc(-7);
  const activeEnd = addDaysUtc(activeStart, 6);
  const activePlan = await prisma.trainingPlan.create({
    data: { userId, startsAt: activeStart, endsAt: activeEnd, status: "active", revision: 1, focusSummary: "Synthetic outgoing week" },
  });

  const sessionIds: string[] = [];
  if (opts.doneSessions) {
    const s1 = await prisma.trainingSession.create({
      data: {
        planId: activePlan.id, userId, scheduledDate: addDaysUtc(activeStart, 1), preferredSlot: "morning",
        planningType: "generated", durationMin: 60, intensity: "moderate", status: "done", notes: "Running: easy 10km",
      },
    });
    const s2 = await prisma.trainingSession.create({
      data: {
        planId: activePlan.id, userId, scheduledDate: addDaysUtc(activeStart, 4), preferredSlot: "morning",
        planningType: "generated", durationMin: 75, intensity: "moderate", status: "done", notes: "Running: tempo 12km",
      },
    });
    sessionIds.push(s1.id, s2.id);
    await prisma.sessionMetrics.create({
      data: { sessionId: s1.id, source: "synthetic", movingTimeSec: 3600, elapsedTimeSec: 3650, pauses: [], distanceKm: 10, efWhole: 0.016, decouplingPct: opts.decouplingPct ?? 9.0, decouplingValid: true },
    });
  } else {
    // Sessions exist but none are "done" — still a real week, zero completions.
    await prisma.trainingSession.create({
      data: {
        planId: activePlan.id, userId, scheduledDate: addDaysUtc(activeStart, 1), preferredSlot: "morning",
        planningType: "generated", durationMin: 60, intensity: "moderate", status: "skipped", notes: "Running: easy 10km",
      },
    });
  }

  const draftStart = startOfWeekUtc(0);
  draftStart.setUTCHours(0, 0, 0, 0);
  const draftEnd = addDaysUtc(draftStart, 6);
  const draftPlan = await prisma.trainingPlan.create({
    data: { userId, startsAt: draftStart, endsAt: draftEnd, status: "draft", revision: 1, focusSummary: "Synthetic draft to activate" },
  });

  return { activePlan, draftPlan, activeStart, sessionIds };
}

async function cleanupUser(userId: string) {
  const plans = await prisma.trainingPlan.findMany({ where: { userId } });
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
  await prisma.weekSummary.deleteMany({ where: { userId } });
  await prisma.tunableDefaults.deleteMany({ where: { userId } });
  await prisma.availabilityWindow.deleteMany({ where: { userId } });
  await prisma.athleteDossier.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function main() {
  let exitCode = 0;
  const createdUserIds: string[] = [];

  try {
    // ---------- Test 1: worsening decoupling trend ----------
    console.log(`\n=== Test 1: worsening decoupling trend → expect a NEW TunableDefaults row ===`);
    const user1 = await seedUser("worsening");
    createdUserIds.push(user1.id);
    const initial1 = await prisma.tunableDefaults.create({
      data: { userId: user1.id, hrDisciplinePct: 80, efStopThresholdPct: 8, jumpRatioCeiling: 1.1, rationale: "Initial defaults — not yet athlete-tuned, pending first week of data." },
    });
    await seedWeekHistoryRow(user1.id, startOfWeekUtc(-21), 3.0, 0);
    await seedWeekHistoryRow(user1.id, startOfWeekUtc(-14), 6.0, 1);
    const { draftPlan: draft1 } = await seedRolloverPlans(user1.id, { doneSessions: true, decouplingPct: 9.0 });
    const todayStr = new Date().toISOString().split("T")[0];

    const rolled1 = await activateDraftIfReady(user1.id, todayStr);
    console.log(`activateDraftIfReady returned: ${rolled1}`);

    const activatedPlan1 = await prisma.trainingPlan.findUnique({ where: { id: draft1.id } });
    console.log(`draft plan status after rollover: ${activatedPlan1?.status}`);

    const latest1 = await prisma.tunableDefaults.findFirst({ where: { userId: user1.id }, orderBy: { revisedAt: "desc" } });
    if (latest1 && latest1.id !== initial1.id) {
      console.log(`✓ PASS: new TunableDefaults row created (id=${latest1.id}).`);
      console.log(`  hrDisciplinePct: ${initial1.hrDisciplinePct} → ${latest1.hrDisciplinePct}`);
      console.log(`  efStopThresholdPct: ${initial1.efStopThresholdPct} → ${latest1.efStopThresholdPct}`);
      console.log(`  jumpRatioCeiling: ${initial1.jumpRatioCeiling} → ${latest1.jumpRatioCeiling}`);
      console.log(`  rationale: ${latest1.rationale}`);
      const citesNumbers = /\d/.test(latest1.rationale);
      if (citesNumbers) {
        console.log(`✓ PASS: rationale contains numeric content.`);
      } else {
        console.log(`✗ FAIL: rationale has no numbers at all.`);
        exitCode = 1;
      }
    } else {
      console.log(`✗ FAIL: no new TunableDefaults row was created.`);
      exitCode = 1;
    }

    // ---------- Test 2: zero done sessions ----------
    console.log(`\n=== Test 2: zero done sessions → expect NO new TunableDefaults row ===`);
    const user2 = await seedUser("zerodone");
    createdUserIds.push(user2.id);
    const initial2 = await prisma.tunableDefaults.create({
      data: { userId: user2.id, hrDisciplinePct: 80, efStopThresholdPct: 8, jumpRatioCeiling: 1.1, rationale: "Initial defaults — not yet athlete-tuned, pending first week of data." },
    });
    await seedRolloverPlans(user2.id, { doneSessions: false });

    const rolled2 = await activateDraftIfReady(user2.id, todayStr);
    console.log(`activateDraftIfReady returned: ${rolled2}`);

    const count2 = await prisma.tunableDefaults.count({ where: { userId: user2.id } });
    if (count2 === 1) {
      console.log(`✓ PASS: no new TunableDefaults row was created (still just the initial one).`);
    } else {
      console.log(`✗ FAIL: expected 1 TunableDefaults row, found ${count2}.`);
      exitCode = 1;
    }

    // ---------- Test 3: LLM call fails ----------
    console.log(`\n=== Test 3: LLM call fails → rollover must still complete, no new row ===`);
    const user3 = await seedUser("llmfail");
    createdUserIds.push(user3.id);
    const initial3 = await prisma.tunableDefaults.create({
      data: { userId: user3.id, hrDisciplinePct: 80, efStopThresholdPct: 8, jumpRatioCeiling: 1.1, rationale: "Initial defaults — not yet athlete-tuned, pending first week of data." },
    });
    await seedWeekHistoryRow(user3.id, startOfWeekUtc(-21), 3.0, 0);
    await seedWeekHistoryRow(user3.id, startOfWeekUtc(-14), 6.0, 1);
    const { draftPlan: draft3 } = await seedRolloverPlans(user3.id, { doneSessions: true, decouplingPct: 9.0 });

    const originalModel = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = "invalid-model-does-not-exist";
    let rolled3: boolean;
    try {
      rolled3 = await activateDraftIfReady(user3.id, todayStr);
    } finally {
      if (originalModel === undefined) {
        delete process.env.ANTHROPIC_MODEL;
      } else {
        process.env.ANTHROPIC_MODEL = originalModel;
      }
    }
    console.log(`activateDraftIfReady returned: ${rolled3}`);

    const activatedPlan3 = await prisma.trainingPlan.findUnique({ where: { id: draft3.id } });
    const count3 = await prisma.tunableDefaults.count({ where: { userId: user3.id } });

    if (rolled3 && activatedPlan3?.status === "active") {
      console.log(`✓ PASS: rollover completed (draft activated) despite the LLM call failing.`);
    } else {
      console.log(`✗ FAIL: rollover did not complete — returned=${rolled3}, draft status=${activatedPlan3?.status}.`);
      exitCode = 1;
    }
    if (count3 === 1) {
      console.log(`✓ PASS: no new TunableDefaults row was created after the simulated LLM failure.`);
    } else {
      console.log(`✗ FAIL: expected 1 TunableDefaults row (initial only), found ${count3}.`);
      exitCode = 1;
    }
    void initial2;
    void initial3;

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
        leftoverWeekSummary: await prisma.weekSummary.count({ where: { userId } }),
        leftoverTunables: await prisma.tunableDefaults.count({ where: { userId } }),
      }))
    );
    console.log(`\n✓ Follow-up check: ${JSON.stringify(remainingChecks)}`);
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
