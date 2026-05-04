/**
 * DB seed helpers for scenarios that are hard to reach by manual clicking.
 * Creates named DB states against the real Supabase DB.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-scenarios.ts <scenario>
 *
 * Scenarios:
 *   rollover        — active plan for last week + draft plan starting TODAY → open /today first
 *   injury-week     — injury check-in on Wed + readiness fatigue on Thu
 *   rebound-friday  — injury Mon, fatigue Wed, good check-in Fri
 *   crowded-week    — 7 sessions this week to stress dedup / two-a-day rules
 *   reset           — archive all plans, clear check-ins and readiness for this week
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseCliArgs(): { positional: string[]; flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-zA-Z]+)(?:=(.+))?$/);
    if (m) flags[m[1]] = m[2] ?? args[++i] ?? "";
    else positional.push(args[i]);
  }
  return { positional, flags };
}

const { positional: cliPositional, flags: cliFlags } = parseCliArgs();
const USER_ID = cliFlags.userId ?? process.env.SCRIPT_USER_ID ?? "user_maxon";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun
  const toMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + toMonday);
  return d.toISOString().slice(0, 10);
}

async function archiveAll() {
  await prisma.trainingPlan.updateMany({
    where: { userId: USER_ID, status: { in: ["active", "draft"] } },
    data: { status: "archived" },
  });
}

// ─── Scenario: rollover ───────────────────────────────────────────────────────
// Sets up: old active plan for last week + draft plan starting TODAY.
// Verify by opening /today (not /week) — rollover should fire and redirect.

async function scenarioRollover() {
  await archiveAll();

  const lastMonday = mondayOf(dateStr(-7));
  const lastSunday = dateStr(-7 + 6).slice(0, 10);
  const todayMonday = mondayOf(today());
  const nextSunday = dateStr(6);

  // Old active plan (last week)
  const oldPlan = await prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(lastMonday + "T00:00:00Z"),
      endsAt: new Date(lastSunday + "T00:00:00Z"),
      status: "active",
      revision: 1,
      focusSummary: "Old week — should be archived on rollover",
      goals: { create: [] },
    },
  });

  // Draft plan starting today (simulates a Monday rollover)
  const draftPlan = await prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(todayMonday + "T00:00:00Z"),
      endsAt: new Date(nextSunday + "T00:00:00Z"),
      status: "draft",
      revision: 1,
      focusSummary: "New week — should activate when /today or /week is opened",
      goals: { create: [] },
      sessions: {
        create: [
          {
            userId: USER_ID,
            scheduledDate: new Date(dateStr(1) + "T00:00:00Z"),
            preferredSlot: "morning",
            planningType: "generated",
            durationMin: 60,
            intensity: "easy",
            notes: "running: easy run 10 km",
          },
          {
            userId: USER_ID,
            scheduledDate: new Date(dateStr(3) + "T00:00:00Z"),
            preferredSlot: "evening",
            planningType: "fixed",
            durationMin: 75,
            intensity: "hard",
            notes: "HYROX group class",
          },
        ],
      },
    },
  });

  console.log(`✓ Created old active plan: ${oldPlan.id} (week ${lastMonday})`);
  console.log(`✓ Created draft plan: ${draftPlan.id} (week ${todayMonday})`);
  console.log(``);
  console.log(`Now open http://localhost:3000/today — rollover should fire`);
  console.log(`and Today should show the new week's sessions.`);
}

// ─── Scenario: injury-week ────────────────────────────────────────────────────
// Injury check-in on Wednesday + readiness fatigue on Thursday.
// Verify: hard sessions blocked; planner protects Friday/Saturday.

async function scenarioInjuryWeek() {
  await archiveAll();

  const weekMonday = mondayOf(today());
  const wed = dateStr(2); // Wednesday offset from Monday
  const thu = dateStr(3);
  const sat = dateStr(5);

  const plan = await prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(weekMonday + "T00:00:00Z"),
      endsAt: new Date(dateStr(6) + "T00:00:00Z"),
      status: "active",
      revision: 1,
      focusSummary: "Injury week test — Wednesday knee pain",
      goals: { create: [] },
      sessions: {
        create: [
          {
            userId: USER_ID,
            scheduledDate: new Date(wed + "T00:00:00Z"),
            preferredSlot: "evening",
            planningType: "generated",
            durationMin: 75,
            intensity: "hard",
            notes: "running: interval run 10 km",
            status: "done",
          },
          {
            userId: USER_ID,
            scheduledDate: new Date(sat + "T00:00:00Z"),
            preferredSlot: "morning",
            planningType: "generated",
            durationMin: 110,
            intensity: "easy",
            notes: "running: long run 21 km",
          },
        ],
      },
    },
  });

  // Find the Wednesday session to attach the injury check-in
  const wedSession = await prisma.trainingSession.findFirst({
    where: { planId: plan.id, scheduledDate: new Date(wed + "T00:00:00Z") },
  });

  if (wedSession) {
    await prisma.checkIn.create({
      data: {
        userId: USER_ID,
        sessionId: wedSession.id,
        occurredAt: new Date(wed + "T20:00:00Z"),
        feelScore: 2,
        notes: "knee pain during intervals — sharp pain left knee",
      },
    });
    console.log(`✓ Injury check-in created for Wednesday session (feel 2/6)`);
  }

  // Readiness fatigue on Thursday
  await prisma.dailyReadiness.upsert({
    where: { userId_date: { userId: USER_ID, date: new Date(thu + "T00:00:00Z") } },
    create: {
      userId: USER_ID,
      date: new Date(thu + "T00:00:00Z"),
      feelScore: 3,
      notes: "knee still sore, slept badly",
      tags: ["soreness", "poor_sleep"],
      category: "fatigue",
    },
    update: {
      feelScore: 3,
      notes: "knee still sore, slept badly",
      tags: ["soreness", "poor_sleep"],
      category: "fatigue",
    },
  });

  console.log(`✓ Readiness fatigue logged for Thursday (feel 3/6)`);
  console.log(`✓ Active plan: ${plan.id} (week ${weekMonday})`);
  console.log(``);
  console.log(`Open /week — expect: injury signal chip, hard sessions blocked on Thu/Fri.`);
  console.log(`Open /today (if today is Thu) — expect: implication line about injury.`);
}

// ─── Scenario: rebound-friday ─────────────────────────────────────────────────
// Injury on Monday, fatigue on Wednesday, strong feel score on Friday.
// Verify: planner shows "protecting" → "building" rebound is acknowledged in coach advice.

async function scenarioReboundFriday() {
  await archiveAll();

  const weekMonday = mondayOf(today());
  const mon = weekMonday;
  const wed = dateStr(2);
  const fri = dateStr(4);
  const sat = dateStr(5);

  const plan = await prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(weekMonday + "T00:00:00Z"),
      endsAt: new Date(dateStr(6) + "T00:00:00Z"),
      status: "active",
      revision: 1,
      focusSummary: "Rebound Friday test",
      goals: { create: [] },
      sessions: {
        create: [
          {
            userId: USER_ID,
            scheduledDate: new Date(mon + "T00:00:00Z"),
            preferredSlot: "evening",
            planningType: "generated",
            durationMin: 75,
            intensity: "hard",
            notes: "HYROX group class",
            status: "done",
          },
          {
            userId: USER_ID,
            scheduledDate: new Date(wed + "T00:00:00Z"),
            preferredSlot: "morning",
            planningType: "generated",
            durationMin: 60,
            intensity: "easy",
            notes: "running: easy run 10 km",
            status: "done",
          },
          {
            userId: USER_ID,
            scheduledDate: new Date(fri + "T00:00:00Z"),
            preferredSlot: "morning",
            planningType: "generated",
            durationMin: 60,
            intensity: "moderate",
            notes: "running: tempo run 10 km",
            status: "done",
          },
          {
            userId: USER_ID,
            scheduledDate: new Date(sat + "T00:00:00Z"),
            preferredSlot: "morning",
            planningType: "generated",
            durationMin: 110,
            intensity: "easy",
            notes: "running: long run 21 km",
          },
        ],
      },
    },
  });

  const sessions = await prisma.trainingSession.findMany({ where: { planId: plan.id } });
  const monSess = sessions.find((s) => s.scheduledDate.toISOString().slice(0, 10) === mon);
  const wedSess = sessions.find((s) => s.scheduledDate.toISOString().slice(0, 10) === wed);
  const friSess = sessions.find((s) => s.scheduledDate.toISOString().slice(0, 10) === fri);

  if (monSess) {
    await prisma.checkIn.create({
      data: {
        userId: USER_ID,
        sessionId: monSess.id,
        occurredAt: new Date(mon + "T20:00:00Z"),
        feelScore: 2,
        notes: "shoulder pain during sled push",
      },
    });
    console.log(`✓ Injury check-in: Monday HYROX (feel 2/6, shoulder)`);
  }
  if (wedSess) {
    await prisma.checkIn.create({
      data: {
        userId: USER_ID,
        sessionId: wedSess.id,
        occurredAt: new Date(wed + "T09:00:00Z"),
        feelScore: 3,
        notes: "shoulder still a bit tight",
      },
    });
    console.log(`✓ Fatigue check-in: Wednesday run (feel 3/6)`);
  }
  if (friSess) {
    await prisma.checkIn.create({
      data: {
        userId: USER_ID,
        sessionId: friSess.id,
        occurredAt: new Date(fri + "T09:00:00Z"),
        feelScore: 6,
        notes: "shoulder completely fine — felt strong",
      },
    });
    console.log(`✓ Positive check-in: Friday tempo (feel 6/6)`);
  }

  console.log(`✓ Active plan: ${plan.id}`);
  console.log(``);
  console.log(`Open /today (if today is Fri/Sat) — coach advice should acknowledge rebound.`);
  console.log(`Open /week — 'What changed' should reference the injury→recovery arc.`);
}

// ─── Scenario: crowded-week ───────────────────────────────────────────────────
// 7 sessions drafted for one week — stresses dedup and two-a-day enforcement.
// The orchestrator / deduplicateSessions should trim it down.

async function scenarioCrowdedWeek() {
  await archiveAll();

  const weekMonday = mondayOf(today());

  const plan = await prisma.trainingPlan.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(weekMonday + "T00:00:00Z"),
      endsAt: new Date(dateStr(6) + "T00:00:00Z"),
      status: "draft",
      revision: 1,
      focusSummary: "Crowded week — verify dedup and two-a-day enforcement",
      goals: { create: [] },
      sessions: {
        create: [
          // Mon: two runs (same modality — should collapse)
          { userId: USER_ID, scheduledDate: new Date(dateStr(0) + "T00:00:00Z"), preferredSlot: "morning", planningType: "generated", durationMin: 60, intensity: "easy", notes: "running: easy run 10 km" },
          { userId: USER_ID, scheduledDate: new Date(dateStr(0) + "T00:00:00Z"), preferredSlot: "evening", planningType: "generated", durationMin: 60, intensity: "easy", notes: "running: recovery run 5 km" },
          // Tue: HYROX
          { userId: USER_ID, scheduledDate: new Date(dateStr(1) + "T00:00:00Z"), preferredSlot: "evening", planningType: "fixed", durationMin: 75, intensity: "hard", notes: "HYROX group class" },
          // Wed: run
          { userId: USER_ID, scheduledDate: new Date(dateStr(2) + "T00:00:00Z"), preferredSlot: "morning", planningType: "generated", durationMin: 60, intensity: "easy", notes: "running: easy run 10 km" },
          // Thu: HYROX (second this week)
          { userId: USER_ID, scheduledDate: new Date(dateStr(3) + "T00:00:00Z"), preferredSlot: "evening", planningType: "fixed", durationMin: 75, intensity: "hard", notes: "HYROX group class" },
          // Sat: long run + cycling two-a-day (different modalities, different slots — allowed)
          { userId: USER_ID, scheduledDate: new Date(dateStr(5) + "T00:00:00Z"), preferredSlot: "morning", planningType: "generated", durationMin: 110, intensity: "easy", notes: "running: long run 21 km" },
          { userId: USER_ID, scheduledDate: new Date(dateStr(5) + "T00:00:00Z"), preferredSlot: "afternoon", planningType: "generated", durationMin: 60, intensity: "easy", notes: "cycling: easy aerobic spin" },
        ],
      },
    },
  });

  console.log(`✓ Created crowded-week DRAFT plan: ${plan.id} (week ${weekMonday})`);
  console.log(``);
  console.log(`This plan is in DRAFT status — activate via /week when ready to test.`);
  console.log(`Expected after deduplication:`);
  console.log(`  Mon: only ONE run (double-run collapsed)`);
  console.log(`  Tue: HYROX (fixed, kept)`);
  console.log(`  Wed: easy run`);
  console.log(`  Thu: HYROX (fixed, kept — 48h after Tue ✓)`);
  console.log(`  Sat: long run + cycling (two-a-day allowed — healthy, diff modalities, diff slots)`);
}

// ─── Scenario: reset ──────────────────────────────────────────────────────────

async function scenarioReset() {
  await archiveAll();

  // Clear readiness records and unresolved check-ins from current week
  const weekMonday = mondayOf(today());
  const weekEnd = new Date(dateStr(6) + "T23:59:59Z");

  await prisma.dailyReadiness.deleteMany({
    where: {
      userId: USER_ID,
      date: { gte: new Date(weekMonday + "T00:00:00Z"), lte: weekEnd },
    },
  });

  console.log(`✓ All plans archived`);
  console.log(`✓ This week's readiness records cleared`);
  console.log(`✓ Ready for a fresh state — generate a new plan via /week`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const scenario = cliPositional[0];

const scenarios: Record<string, () => Promise<void>> = {
  rollover: scenarioRollover,
  "injury-week": scenarioInjuryWeek,
  "rebound-friday": scenarioReboundFriday,
  "crowded-week": scenarioCrowdedWeek,
  reset: scenarioReset,
};

if (!scenario || !scenarios[scenario]) {
  console.log("Usage: npx tsx --env-file=.env.local scripts/test-scenarios.ts <scenario>");
  console.log("\nAvailable scenarios:");
  for (const name of Object.keys(scenarios)) {
    console.log(`  ${name}`);
  }
  process.exit(1);
}

console.log(`\nRunning scenario: ${scenario}\n`);
scenarios[scenario]()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
