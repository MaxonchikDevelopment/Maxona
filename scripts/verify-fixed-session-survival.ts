/**
 * Scoped synthetic verification for the fixed-session-vs-volume-cap bug fix.
 *
 * Creates a throwaway dummy user (never touches user_maxon), gives it a thin
 * previous week (~1h) and a PlannedFixedSession for later in "next week",
 * runs generateNextWeekDraft, and confirms:
 *   1. The fixed session survives into the persisted draft.
 *   2. consumedByPlanId is stamped on the PlannedFixedSession row.
 * All synthetic data is deleted afterward regardless of outcome.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/verify-fixed-session-survival.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateNextWeekDraft } from "../lib/planner/orchestrator";

const prisma = new PrismaClient();

const DUMMY_LOGIN = `synthetic_fixed_session_test_${Date.now()}`;
const DAYS: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> = [
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

function localDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
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

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

async function snapshotMaxonCounts() {
  const [plans, sessions] = await Promise.all([
    prisma.trainingPlan.count({ where: { userId: "user_maxon" } }),
    prisma.trainingSession.count({ where: { userId: "user_maxon" } }),
  ]);
  return { plans, sessions };
}

async function main() {
  const before = await snapshotMaxonCounts();
  console.log(`user_maxon before: ${before.plans} plans, ${before.sessions} sessions`);

  const tz = "Europe/Warsaw";
  const thisWeekStart = currentWeekStart(tz);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const fixedDate = addDays(nextWeekStart, 4); // Friday of next week

  let dummyUserId: string | null = null;
  let plannedFixedSessionId: string | null = null;
  let exitCode = 0;

  try {
    const dummyUser = await prisma.user.create({
      data: {
        name: "Synthetic Test User",
        login: DUMMY_LOGIN,
        isActive: true,
        timezone: tz,
        constraints: { maxContinuousTrainingMinutes: 240 },
      },
    });
    dummyUserId = dummyUser.id;
    console.log(`✓ Created dummy user: ${dummyUserId}`);

    // Wide-open availability every day so NoWorkoutOutsideAvailabilityRule
    // doesn't block the fixed session's date for unrelated reasons.
    await prisma.availabilityWindow.createMany({
      data: DAYS.map((dayOfWeek) => ({
        userId: dummyUserId!,
        dayOfWeek,
        timeStartMin: 360, // 06:00
        timeEndMin: 1320, // 22:00
      })),
    });
    console.log(`✓ Seeded wide-open availability windows (all 7 days)`);

    // Thin previous week: a single 60-min easy session → maxWeeklyVolume cap
    // for next week = round(60 * 1.1) = 66 min. The fixed session below is
    // 75 min, i.e. it alone exceeds the cap — reproduces the bug scenario.
    await prisma.trainingPlan.create({
      data: {
        userId: dummyUserId,
        startsAt: thisWeekStart,
        endsAt: addDays(thisWeekStart, 6),
        status: "active",
        revision: 1,
        focusSummary: "Synthetic thin previous week",
        sessions: {
          create: [
            {
              userId: dummyUserId,
              scheduledDate: thisWeekStart,
              preferredSlot: "morning",
              planningType: "generated",
              durationMin: 60,
              intensity: "easy",
              notes: "running: easy run 8 km",
              status: "done",
            },
          ],
        },
      },
    });
    console.log(`✓ Seeded thin previous week (60 min total)`);

    const plannedFixedSession = await prisma.plannedFixedSession.create({
      data: {
        userId: dummyUserId,
        scheduledDate: fixedDate,
        preferredSlot: "evening",
        durationMin: 75,
        intensity: "hard",
        modality: "hyrox",
        notes: "Group class",
      },
    });
    plannedFixedSessionId = plannedFixedSession.id;
    console.log(
      `✓ Seeded PlannedFixedSession for ${toDateStr(fixedDate)}: 75 min hyrox (id=${plannedFixedSessionId})`
    );

    console.log(`\nRunning generateNextWeekDraft(${dummyUserId})...\n`);
    const draft = await generateNextWeekDraft(dummyUserId);

    const persistedSessions = await prisma.trainingSession.findMany({
      where: { planId: draft.id },
    });
    console.log(`Draft ${draft.id} persisted ${persistedSessions.length} session(s):`);
    for (const s of persistedSessions) {
      console.log(
        `  - ${toDateStr(s.scheduledDate)} [${s.planningType}] ${s.durationMin}min "${s.notes}"`
      );
    }

    const survivedFixed = persistedSessions.find(
      (s) =>
        s.planningType === "fixed" &&
        toDateStr(s.scheduledDate) === toDateStr(fixedDate) &&
        s.notes === "hyrox: Group class"
    );

    const refreshedPfs = await prisma.plannedFixedSession.findUniqueOrThrow({
      where: { id: plannedFixedSessionId },
    });

    console.log(`\n── Result ──────────────────────────────────────────`);
    if (survivedFixed) {
      console.log(`✓ PASS: fixed session survived into persisted draft`);
    } else {
      console.log(`✗ FAIL: fixed session did NOT survive into persisted draft`);
      exitCode = 1;
    }

    if (refreshedPfs.consumedByPlanId === draft.id) {
      console.log(`✓ PASS: consumedByPlanId correctly stamped (${draft.id})`);
    } else {
      console.log(
        `✗ FAIL: consumedByPlanId = ${refreshedPfs.consumedByPlanId ?? "null"}, expected ${draft.id}`
      );
      exitCode = 1;
    }

    if (survivedFixed && refreshedPfs.consumedByPlanId !== draft.id) {
      console.log(`  (inconsistent: session survived but stamp missing — investigate)`);
    }
    if (!survivedFixed && refreshedPfs.consumedByPlanId) {
      console.log(`  (inconsistent: stamp set but session missing — the original bug)`);
    }
  } catch (err) {
    console.error("Error during verification:", err);
    exitCode = 1;
  } finally {
    // ─── Cleanup: delete all synthetic data, regardless of outcome ───────────
    if (dummyUserId) {
      await prisma.checkIn.deleteMany({ where: { userId: dummyUserId } });
      await prisma.trainingSession.deleteMany({ where: { userId: dummyUserId } });
      await prisma.trainingPlanGoal.deleteMany({
        where: { plan: { userId: dummyUserId } },
      });
      await prisma.trainingPlan.deleteMany({ where: { userId: dummyUserId } });
      await prisma.plannedFixedSession.deleteMany({ where: { userId: dummyUserId } });
      await prisma.availabilityWindow.deleteMany({ where: { userId: dummyUserId } });
      await prisma.goal.deleteMany({ where: { userId: dummyUserId } });
      await prisma.user.delete({ where: { id: dummyUserId } });
      console.log(`\n✓ Cleaned up all synthetic data for dummy user ${dummyUserId}`);
    }

    const after = await snapshotMaxonCounts();
    console.log(`user_maxon after:  ${after.plans} plans, ${after.sessions} sessions`);
    if (after.plans !== before.plans || after.sessions !== before.sessions) {
      console.error(`✗ FAIL: user_maxon counts changed! Investigate immediately.`);
      exitCode = 1;
    } else {
      console.log(`✓ PASS: user_maxon counts unchanged`);
    }

    await prisma.$disconnect();
    process.exit(exitCode);
  }
}

main();
