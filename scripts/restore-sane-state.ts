/**
 * Restore the DB to a sane working state after synthetic test scenarios.
 *
 * What it does:
 *   1. Identifies and archives synthetic test plans (by focusSummary pattern)
 *   2. Deletes check-ins attached to synthetic plan sessions (so they stop
 *      surfacing in ActiveIssues / SignalsHistory which have no plan-status filter)
 *   3. Cleans synthetic DailyReadiness records created by test scenarios
 *   4. Fixes any duplicate-active-plan situation (keeps the newest, archives rest)
 *   5. Reports final state — prompts to generate a real plan if none exists
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/restore-sane-state.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function resolveUserId(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--userId(?:=(.+))?$/);
    if (m) return m[1] ?? args[i + 1] ?? "user_maxon";
  }
  return process.env.SCRIPT_USER_ID ?? "user_maxon";
}

const USER_ID = resolveUserId();

const SYNTHETIC_FOCUS_PATTERNS = [
  "Old week — should be archived on rollover",
  "New week — should activate when /today or /week is opened",
  "Injury week test",
  "Crowded week — verify dedup",
  "Crowded week",
  "Rebound Friday test",
];

const SYNTHETIC_READINESS_NOTES = [
  "knee still sore, slept badly",
];

function isSyntheticPlan(focusSummary: string | null): boolean {
  if (!focusSummary) return false;
  return SYNTHETIC_FOCUS_PATTERNS.some((p) => focusSummary.includes(p));
}

async function main() {
  console.log("=== restore-sane-state ===\n");

  // ── 1. Inspect all plans ────────────────────────────────────────────────────

  const allPlans = await prisma.trainingPlan.findMany({
    where: { userId: USER_ID },
    orderBy: { createdAt: "desc" },
    include: {
      sessions: { select: { id: true } },
    },
  });

  const syntheticPlans = allPlans.filter((p) => isSyntheticPlan(p.focusSummary));
  const realPlans = allPlans.filter((p) => !isSyntheticPlan(p.focusSummary));

  console.log(`Plans total: ${allPlans.length}  (synthetic: ${syntheticPlans.length}, real: ${realPlans.length})`);

  // ── 2. Archive synthetic plans + delete their check-ins ────────────────────

  let totalCheckInsDeleted = 0;

  for (const plan of syntheticPlans) {
    const sessionIds = plan.sessions.map((s) => s.id);

    if (sessionIds.length > 0) {
      const deleted = await prisma.checkIn.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      totalCheckInsDeleted += deleted.count;
    }

    if (plan.status !== "archived") {
      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: { status: "archived" },
      });
      console.log(`  Archived: "${plan.focusSummary?.slice(0, 60)}" (${plan.id.slice(0, 8)}…)`);
    } else {
      console.log(`  Already archived: "${plan.focusSummary?.slice(0, 60)}" — skipped`);
    }
  }

  if (totalCheckInsDeleted > 0) {
    console.log(`  Deleted ${totalCheckInsDeleted} check-in(s) from synthetic sessions`);
  }

  // ── 3. Clean synthetic DailyReadiness records ──────────────────────────────

  let readinessDeleted = 0;
  for (const note of SYNTHETIC_READINESS_NOTES) {
    const result = await prisma.dailyReadiness.deleteMany({
      where: { userId: USER_ID, notes: note },
    });
    readinessDeleted += result.count;
  }
  if (readinessDeleted > 0) {
    console.log(`  Deleted ${readinessDeleted} synthetic readiness record(s)`);
  }

  // ── 4. Fix duplicate active plans ──────────────────────────────────────────

  const activePlans = await prisma.trainingPlan.findMany({
    where: { userId: USER_ID, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  if (activePlans.length > 1) {
    console.log(`\nWARN: ${activePlans.length} active plans found — archiving all but the newest`);
    for (const p of activePlans.slice(1)) {
      await prisma.trainingPlan.update({
        where: { id: p.id },
        data: { status: "archived" },
      });
      console.log(`  Archived stale active: ${p.id.slice(0, 8)}… (created ${p.createdAt.toISOString().slice(0, 10)})`);
    }
  }

  // ── 5. Report final state ──────────────────────────────────────────────────

  const currentActive = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    include: { sessions: { select: { id: true, scheduledDate: true, notes: true } } },
  });

  const currentDraft = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "draft" },
    orderBy: { startsAt: "desc" },
    select: { id: true, startsAt: true, focusSummary: true },
  });

  console.log("\n--- Final state ---");

  if (currentActive) {
    const weekStr = currentActive.startsAt.toISOString().slice(0, 10);
    console.log(
      `Active plan: ${currentActive.id.slice(0, 8)}… — week ${weekStr} — ${currentActive.sessions.length} sessions`
    );
    if (currentActive.focusSummary) {
      console.log(`  Focus: "${currentActive.focusSummary}"`);
    }
  } else {
    console.log("No active plan.");
    console.log("  → Generate one: open /week and click Replan, or POST /api/plans/replan");
  }

  if (currentDraft) {
    const weekStr = currentDraft.startsAt.toISOString().slice(0, 10);
    console.log(`Draft plan:  ${currentDraft.id.slice(0, 8)}… — week ${weekStr}`);
    if (currentDraft.focusSummary) {
      console.log(`  Focus: "${currentDraft.focusSummary}"`);
    }
  } else {
    console.log("No draft plan.");
  }

  console.log("\nDone.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
