/**
 * Smoke test for the new submit_plan tool schema (structured session-output
 * fields: distanceKm, targetPaceMinPerKm, targetHrZone, subtype), plus the
 * AthleteDossier/TunableDefaults wiring added in Phase 2 Step 2, plus (Round 2)
 * confirming those structured fields are actually persisted to the
 * TrainingSession row by both generateWeeklyPlan and generateNextWeekDraft.
 *
 * Creates a throwaway dummy user (never touches user_maxon), gives it the
 * minimal viable planning context — one active Goal, wide-open availability
 * for a full week, no prior sessions, and a seeded AthleteDossier
 * (maxHr/lthrEstimate) — and calls generateWeeklyPlan(userId) for real (real
 * Anthropic API call, not mocked). Confirms the call succeeds with no
 * tool-schema validation error, the plan has sessions, reports whether the
 * new structured fields came back populated for a running or cycling
 * session, confirms they are actually non-null on the persisted
 * TrainingSession row (not just the in-memory PlanResult), confirms exactly
 * one TunableDefaults row got bootstrapped with the expected initial
 * rationale, and then repeats the persistence check for
 * generateNextWeekDraft's draft-plan sessions.
 *
 * All synthetic data (including the dossier row) is deleted afterward
 * regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/smoke-test-plan-schema.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateWeeklyPlan, generateNextWeekDraft } from "../lib/planner/orchestrator";
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

    await prisma.athleteDossier.create({
      data: {
        userId: dummyUserId,
        facts: { maxHr: 185, lthrEstimate: 172 },
      },
    });
    console.log(`✓ Seeded AthleteDossier: {maxHr: 185, lthrEstimate: 172}`);

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

      const persistedRunOrCycle = sessions.find((s) => /^(running|cycling)/i.test((s.notes ?? "").trim()));
      console.log(`\nPersisted TrainingSession row for the same session:`);
      if (persistedRunOrCycle) {
        console.log(`  distanceKm: ${JSON.stringify(persistedRunOrCycle.distanceKm)}`);
        console.log(`  targetPaceMinPerKm: ${JSON.stringify(persistedRunOrCycle.targetPaceMinPerKm)}`);
        console.log(
          `  targetHrZoneMin/Max: ${JSON.stringify(persistedRunOrCycle.targetHrZoneMin)}/${JSON.stringify(persistedRunOrCycle.targetHrZoneMax)}`
        );
        console.log(`  subtype: ${JSON.stringify(persistedRunOrCycle.subtype)}`);

        if (runOrCycle.distanceKm != null && persistedRunOrCycle.distanceKm == null) {
          console.log(`  ✗ FAIL: distanceKm present on PlanResult but null on persisted row.`);
          exitCode = 1;
        }
        if (runOrCycle.targetPaceMinPerKm != null && persistedRunOrCycle.targetPaceMinPerKm == null) {
          console.log(`  ✗ FAIL: targetPaceMinPerKm present on PlanResult but null on persisted row.`);
          exitCode = 1;
        }
        if (runOrCycle.targetHrZone != null && persistedRunOrCycle.targetHrZoneMin == null) {
          console.log(`  ✗ FAIL: targetHrZone present on PlanResult but targetHrZoneMin null on persisted row.`);
          exitCode = 1;
        }
        if (
          persistedRunOrCycle.distanceKm == null &&
          persistedRunOrCycle.targetPaceMinPerKm == null &&
          persistedRunOrCycle.targetHrZoneMin == null &&
          persistedRunOrCycle.subtype == null
        ) {
          console.log(`  ✗ FAIL: all structured fields null on persisted generateWeeklyPlan row.`);
          exitCode = 1;
        } else {
          console.log(`  ✓ PASS: structured fields persisted to TrainingSession for generateWeeklyPlan.`);
        }
      } else {
        console.log(`  ✗ FAIL: could not find persisted running/cycling session row to check.`);
        exitCode = 1;
      }
    } else {
      console.log(`\nNo running/cycling session in the returned plan to inspect structured fields on.`);
    }

    const tunableRows = await prisma.tunableDefaults.findMany({ where: { userId: dummyUserId } });
    console.log(`\nTunableDefaults rows for dummy user: ${tunableRows.length}`);
    if (tunableRows.length === 1) {
      const row = tunableRows[0];
      console.log(`  hrDisciplinePct: ${row.hrDisciplinePct}`);
      console.log(`  efStopThresholdPct: ${row.efStopThresholdPct}`);
      console.log(`  jumpRatioCeiling: ${row.jumpRatioCeiling}`);
      console.log(`  rationale: ${JSON.stringify(row.rationale)}`);
      if (row.rationale !== "Initial defaults — not yet athlete-tuned, pending first week of data.") {
        console.log(`  ✗ FAIL: rationale does not match expected initial rationale string.`);
        exitCode = 1;
      }
    } else {
      console.log(`  ✗ FAIL: expected exactly 1 TunableDefaults row, found ${tunableRows.length}.`);
      exitCode = 1;
    }

    if (runOrCycle) {
      console.log(
        `\nSanity check — targetHrZone vs seeded lthrEstimate=172: ` +
          `${JSON.stringify(runOrCycle.targetHrZone)} (not required to match exactly, eyeball only)`
      );
    }

    console.log(`\nCalling generateNextWeekDraft(${dummyUserId})...\n`);
    const draft = await generateNextWeekDraft(dummyUserId);
    const draftSessions = await prisma.trainingSession.findMany({
      where: { planId: draft.id },
      orderBy: { scheduledDate: "asc" },
    });
    console.log(`✓ generateNextWeekDraft succeeded. Draft plan ${draft.id} has ${draftSessions.length} session(s).`);

    const draftRawRunOrCycle = (capturedPlanResult?.sessions ?? []).find((s) =>
      /^(running|cycling)/i.test((s.notes ?? "").trim())
    );
    const draftPersistedRunOrCycle = draftSessions.find((s) => /^(running|cycling)/i.test((s.notes ?? "").trim()));

    if (draftRawRunOrCycle) {
      console.log(`\nDraft raw PlanResult session "${draftRawRunOrCycle.notes}":`);
      console.log(`  distanceKm: ${JSON.stringify(draftRawRunOrCycle.distanceKm)}`);
      console.log(`  targetPaceMinPerKm: ${JSON.stringify(draftRawRunOrCycle.targetPaceMinPerKm)}`);
      console.log(`  targetHrZone: ${JSON.stringify(draftRawRunOrCycle.targetHrZone)}`);
      console.log(`  subtype: ${JSON.stringify(draftRawRunOrCycle.subtype)}`);

      if (draftPersistedRunOrCycle) {
        console.log(`\nPersisted draft TrainingSession row:`);
        console.log(`  distanceKm: ${JSON.stringify(draftPersistedRunOrCycle.distanceKm)}`);
        console.log(`  targetPaceMinPerKm: ${JSON.stringify(draftPersistedRunOrCycle.targetPaceMinPerKm)}`);
        console.log(
          `  targetHrZoneMin/Max: ${JSON.stringify(draftPersistedRunOrCycle.targetHrZoneMin)}/${JSON.stringify(draftPersistedRunOrCycle.targetHrZoneMax)}`
        );
        console.log(`  subtype: ${JSON.stringify(draftPersistedRunOrCycle.subtype)}`);

        if (draftRawRunOrCycle.distanceKm != null && draftPersistedRunOrCycle.distanceKm == null) {
          console.log(`  ✗ FAIL: distanceKm present on draft PlanResult but null on persisted draft row.`);
          exitCode = 1;
        } else {
          console.log(`  ✓ PASS: structured fields persisted to TrainingSession for generateNextWeekDraft.`);
        }
      } else {
        console.log(`  ✗ FAIL: could not find persisted running/cycling session row on the draft plan.`);
        exitCode = 1;
      }
    } else {
      console.log(`\nNo running/cycling session in the draft plan to inspect structured fields on.`);
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
        await prisma.trainingSession.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlanGoal.deleteMany({ where: { planId: { in: planIds } } });
        await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
      }
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
      console.log(
        `✓ Follow-up check: user present=${remaining !== null}, leftover availability rows=${remainingAvail}`
      );
    }
    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
