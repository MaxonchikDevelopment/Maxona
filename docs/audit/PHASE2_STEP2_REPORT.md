# Phase 2 — Step 2 Report (wire dossier & tunables)

Branch: `phase2-step2-wire-dossier-tunables` (off `main`, not merged)

Commits:
- `999c06d` — docs(claude): update stale domain model list in CLAUDE.md
- `440d174` — feat(planner): wire AthleteDossier and TunableDefaults into planning context
- `7ea4a67` — feat(ai): surface athlete dossier and tunables in the planning prompt
- `ed995f9` — test: extend smoke test to cover dossier/tunables wiring

## 1. CLAUDE.md domain-model fix

- "Domain Model Overview" now lists `PlannedFixedSession`, `SessionMetrics`
  (nested under `TrainingSession`), `WeekSummary`, `AthleteDossier`,
  `TunableDefaults`, `NutritionProfile`, and the Strava model set
  (`StravaConnection`, `StravaActivity`, `StravaActivityStream`,
  `SessionStravaActivityLink`, `StravaWebhookEvent`) — all present in
  `prisma/schema.prisma` but previously missing from this section.
- Non-negotiables/rules sections (Architecture Decisions, Working Rules,
  Session Workflow, etc.) untouched.

## 2. PlanningContext extension

- `lib/ai/adapter.ts` — `PlanningContext` gains two optional fields:
  - `athleteDossier?: { facts: Record<string, unknown>; version: number }`
  - `tunableDefaults?: { hrDisciplinePct: number | null; efStopThresholdPct: number | null; jumpRatioCeiling: number | null; safetyPattern: unknown; rationale: string }`
- Field names/nullability confirmed against the actual `TunableDefaults`
  Prisma model in `prisma/schema.prisma` before writing the type
  (`hrDisciplinePct`/`efStopThresholdPct`/`jumpRatioCeiling` are
  `Float?`, `safetyPattern` is `Json?`, `rationale` is a required `String`).

## 3. Real reads wired into both orchestrator entry points

In `lib/planner/orchestrator.ts`, both `generateWeeklyPlan` and
`generateNextWeekDraft`, immediately before building `planningCtx`:

- `prisma.athleteDossier.findUnique({ where: { userId } })` — read-only.
  When no row exists, `planningCtx.athleteDossier` is populated with
  `{ facts: {}, version: 0 }`; no dossier row is created by the
  orchestrator (only `PUT /api/dossier` creates one).
- `getOrCreateTunableDefaults(userId)` from `lib/planner/tunable-defaults.ts`.

**Note (per instructions, not buried):** `getOrCreateTunableDefaults` WILL
create a first `TunableDefaults` row (the conservative initial defaults from
Step 1: `hrDisciplinePct: 80`, `efStopThresholdPct: 8`,
`jumpRatioCeiling: 1.1`, rationale `"Initial defaults — not yet
athlete-tuned, pending first week of data."`) for any user who calls either
`generateWeeklyPlan` or `generateNextWeekDraft` and doesn't already have a
row. This is a side effect of this step, not opt-in — every plan generation
from now on bootstraps that user's tunables if missing.

## 4. Surfaced in the prompt

- `lib/ai/claude-adapter.ts` `buildUserPrompt` gains an `athleteProfile`
  section, rendered only when `athleteDossier.facts` has at least one key
  or `tunableDefaults` is present. It lists whichever dossier facts exist
  (`maxHr`, `lthrEstimate`, `weightKg`, `unavailablePatterns`,
  `failureHistory`, `gear`, `protocols` — only present ones) directly, plus
  a nested `tunables` object with the non-null tunable values and
  `rationale`.
- System prompt's "Structured targets" section now instructs Claude: when
  `athleteProfile.maxHr`/`.lthrEstimate` are present, ground `targetHrZone`
  bounds in them instead of guessing; when
  `athleteProfile.tunables.hrDisciplinePct`/`.efStopThresholdPct` are
  present, use them to calibrate how conservative to be on borderline
  intensity/duration calls.
- Output schema (`SUBMIT_PLAN_TOOL.input_schema`) unchanged — this is
  prompt guidance only, built on fields added in the previous session.
- Persistence, rules engine, and negotiation/season-block questions
  untouched, per scope.

## Validation

- `npx tsc --noEmit` — clean, no errors.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` (before the smoke-test commit) — 4 files changed:
  `CLAUDE.md` (+13/-1), `lib/ai/adapter.ts` (+8), `lib/ai/claude-adapter.ts`
  (+22), `lib/planner/orchestrator.ts` (+33) — 75 insertions, 1 deletion.

## Smoke test

**Result: PASS.**

Extended `scripts/smoke-test-plan-schema.ts` (throwaway-user pattern, real
Anthropic API call) to also seed the dummy user's `AthleteDossier` with
`{maxHr: 185, lthrEstimate: 172}` before calling `generateWeeklyPlan`, then
query `TunableDefaults` afterward and clean up the dossier row in `finally`.

- `generateWeeklyPlan` succeeded — no `submit_plan` schema validation error.
- Returned plan had 4 sessions (easy run, tempo run, easy run, interval
  run — all running, consistent with the single active running goal).
- Structured fields on the easy-run session:
  `distanceKm: 10`, `targetPaceMinPerKm: "6:30"`,
  `targetHrZone: {"min":130,"max":148}`, `subtype: "easy run"`.
- **TunableDefaults confirmation:** exactly 1 row created for the dummy
  user — `hrDisciplinePct: 80`, `efStopThresholdPct: 8`,
  `jumpRatioCeiling: 1.1`, `rationale: "Initial defaults — not yet
  athlete-tuned, pending first week of data."` — matches the expected
  bootstrap values from Step 1 exactly.
- **targetHrZone sanity check vs seeded `lthrEstimate: 172`:** returned
  `{min: 130, max: 148}` for the easy-run session, i.e. roughly 76–86% of
  172. That's a plausible easy/aerobic-base zone relative to LTHR — eyeballs
  as consistent with the seeded dossier fact, not a guessed absolute number
  (`Structured targets` guidance was applied; not verified as an exact
  formula, per scope — "report what came back so we can eyeball it").
- Cleanup: plan, session, goal, availability windows, `TunableDefaults` row,
  `AthleteDossier` row, and user deleted in a `finally` block. Follow-up
  query confirmed zero leftover rows (user absent, 0 availability windows
  for the dummy userId). `user_maxon` was never touched.

## Out of scope, not done (confirmed)

- No persistence changes — `TrainingSession`/`SessionWorkoutPlan` still
  have no columns for the structured fields or dossier/tunable data.
- Rules engine untouched.
- Negotiation-step and season-block-skeleton questions not addressed —
  both remain open per §11.3 of the master doc, items 6–7.
