/**
 * Deterministic verification for deduplicateSessions + filterSessions.
 * Pure function tests — no DB, no LLM, no HTTP.
 *
 * Run with:  npx tsx scripts/verify-rules.ts
 */

import { filterSessions, deduplicateSessions } from "../lib/rules/index";
import type { PlannedSession } from "../lib/ai/adapter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function session(overrides: Partial<PlannedSession> & { dateStr: string }): PlannedSession {
  return {
    scheduledDate: new Date(overrides.dateStr + "T12:00:00Z"),
    preferredSlot: overrides.preferredSlot ?? "morning",
    planningType: overrides.planningType ?? "generated",
    durationMin: overrides.durationMin ?? 60,
    intensity: overrides.intensity ?? "moderate",
    notes: overrides.notes ?? "running: easy run",
  };
}

const noConstraints = {
  blockedDates: [],
  blockedHardSessionDates: [],
  maxWeeklyMinutes: Infinity,
};

// ─── filterSessions ──────────────────────────────────────────────────────────

console.log("\n── filterSessions ───────────────────────────────────────────");

{
  console.log("\nScenario 1: blocked date removes session");
  const sessions = [
    session({ dateStr: "2026-04-28", intensity: "easy" }),
    session({ dateStr: "2026-04-29", intensity: "moderate" }),
  ];
  const result = filterSessions(sessions, { ...noConstraints, blockedDates: ["2026-04-28"] });
  expect("sessions on non-blocked date pass through", result.length, 1);
  expect("blocked date session removed", result[0].scheduledDate.toISOString().slice(0, 10), "2026-04-29");
}

{
  console.log("\nScenario 2: 48h hard-session rule");
  const sessions = [
    session({ dateStr: "2026-04-28", intensity: "hard" }),
    session({ dateStr: "2026-04-29", intensity: "hard" }), // <48h after first hard
    session({ dateStr: "2026-04-30", intensity: "hard" }), // exactly 48h after first
  ];
  const result = filterSessions(sessions, noConstraints);
  expect("first hard session passes", result[0].scheduledDate.toISOString().slice(0, 10), "2026-04-28");
  expect("second hard session (24h gap) filtered", result.length, 2);
  expect("third hard session (48h gap) passes", result[1].scheduledDate.toISOString().slice(0, 10), "2026-04-30");
}

{
  console.log("\nScenario 3: blockedHardSessionDates removes only hard sessions");
  const sessions = [
    session({ dateStr: "2026-04-28", intensity: "hard" }),
    session({ dateStr: "2026-04-28", intensity: "easy" }),
  ];
  const result = filterSessions(sessions, {
    ...noConstraints,
    blockedHardSessionDates: ["2026-04-28"],
  });
  expect("hard session on blocked date removed", result.length, 1);
  expect("easy session on blocked date kept", result[0].intensity, "easy");
}

{
  console.log("\nScenario 4: maxWeeklyMinutes cap");
  const sessions = [
    session({ dateStr: "2026-04-28", durationMin: 90 }),
    session({ dateStr: "2026-04-29", durationMin: 90 }),
    session({ dateStr: "2026-04-30", durationMin: 90 }), // would exceed 200 cap
  ];
  const result = filterSessions(sessions, { ...noConstraints, maxWeeklyMinutes: 200 });
  expect("sessions within budget pass", result.length, 2);
}

{
  console.log("\nScenario 4b: fixed session exempt from maxWeeklyMinutes cap");
  const sessions = [
    session({ dateStr: "2026-04-28", durationMin: 90, planningType: "generated" }),
    session({ dateStr: "2026-04-29", durationMin: 90, planningType: "generated" }), // would push total to 180 > 100 cap
    session({ dateStr: "2026-04-30", durationMin: 60, planningType: "fixed", notes: "HYROX group class" }),
  ];
  const result = filterSessions(sessions, { ...noConstraints, maxWeeklyMinutes: 100 });
  expect("generated session over cap dropped, fixed session kept", result.length, 2);
  expect(
    "fixed session survives despite exceeding cap",
    result.some((s) => s.planningType === "fixed"),
    true
  );
}

{
  console.log("\nScenario 4c: fixed session minutes still count toward cap for later sessions");
  const sessions = [
    session({ dateStr: "2026-04-28", durationMin: 90, planningType: "fixed", notes: "HYROX group class" }),
    session({ dateStr: "2026-04-29", durationMin: 90, planningType: "generated" }), // 90+90=180 > 100 cap, should be dropped
  ];
  const result = filterSessions(sessions, { ...noConstraints, maxWeeklyMinutes: 100 });
  expect("fixed session kept, later generated session dropped", result.length, 1);
  expect("survivor is the fixed session", result[0].planningType, "fixed");
}

// ─── deduplicateSessions ─────────────────────────────────────────────────────

console.log("\n── deduplicateSessions ──────────────────────────────────────");

{
  console.log("\nScenario 5: exact slot+modality duplicate on same day is removed");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run" }),
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: false, recoveryOk: true });
  expect("duplicate removed", result.length, 1);
}

{
  console.log("\nScenario 6: valid two-a-day (different slots, different modalities, healthy)");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run" }),
    session({ dateStr: "2026-04-28", preferredSlot: "evening", notes: "cycling: easy aerobic" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: false, recoveryOk: true });
  expect("both sessions kept when allowed", result.length, 2);
}

{
  console.log("\nScenario 7: two-a-day blocked when injury active");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run" }),
    session({ dateStr: "2026-04-28", preferredSlot: "evening", notes: "cycling: easy aerobic" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: true, recoveryOk: false });
  expect("two-a-day removed under injury", result.length, 1);
}

{
  console.log("\nScenario 8: two-a-day blocked when same modality (double run)");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run" }),
    session({ dateStr: "2026-04-28", preferredSlot: "evening", notes: "running: tempo run" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: false, recoveryOk: true });
  expect("double run on same day blocked", result.length, 1);
}

{
  console.log("\nScenario 9: two HYROX + one run already done — no duplicate HYROX on same day");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "evening", notes: "HYROX group class", intensity: "hard" }),
    session({ dateStr: "2026-04-29", notes: "running: easy run 10 km" }),
    session({ dateStr: "2026-05-01", preferredSlot: "evening", notes: "HYROX group class", intensity: "hard" }),
    // extra HYROX on same day as first one — should be deduped
    session({ dateStr: "2026-04-28", preferredSlot: "evening", notes: "HYROX group class", intensity: "hard" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: false, recoveryOk: true });
  const hyroxDates = result
    .filter((s) => s.notes?.startsWith("HYROX"))
    .map((s) => s.scheduledDate.toISOString().slice(0, 10));
  expect("two distinct HYROX dates", hyroxDates.length, 2);
  expect("no duplicate HYROX on same day", new Set(hyroxDates).size, 2);
}

{
  console.log("\nScenario 10: fixed session survives when two-a-day would be blocked");
  const sessions = [
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "running: easy run", planningType: "generated" }),
    session({ dateStr: "2026-04-28", preferredSlot: "morning", notes: "HYROX group class", planningType: "fixed", intensity: "hard" }),
  ];
  const result = deduplicateSessions(sessions, { injuryActive: true, recoveryOk: false });
  expect("one session kept", result.length, 1);
  expect("fixed session survives over generated", result[0].planningType, "fixed");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n── Summary ──────────────────────────────────────────────────`);
console.log(`   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
