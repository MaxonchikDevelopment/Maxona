# Phase 2 — Step 1 Report (contracts)

Branch: `phase2-step1-contracts` (off `main`, not merged)

Commits:
- `e6643bd` — feat(dossier): validate PUT /api/dossier facts against zod schema
- `fc58329` — feat(planner): add TunableDefaults bootstrap helper
- `b94c2d3` — feat(planner): add optional structured session-output fields

## 1. Zod schema for AthleteDossierFacts

- Added `lib/dossier/schema.ts` — `athleteDossierFactsSchema`, matching
  `lib/dossier/types.ts`'s `AthleteDossierFacts` field-for-field, all fields
  optional (same optionality as the TS type).
- Wired into `PUT /api/dossier` (`app/api/dossier/route.ts`): after the
  existing "is `facts` an object" check, the body is parsed through
  `athleteDossierFactsSchema.safeParse`. On failure: `400` with
  `{ error: "Invalid facts shape", details: parsed.error.format() }`. On
  success, the *parsed* (not raw) data is written, so unknown/extra keys are
  stripped (zod's default `.object()` behavior — strips unrecognized keys
  rather than erroring on them).
- `GET /api/dossier` untouched.
- Added `zod` as a new dependency (not previously in `package.json`) — small,
  standard, and this task explicitly called for it.

## 2. TunableDefaults bootstrap

- Added `lib/planner/tunable-defaults.ts` — `getOrCreateTunableDefaults(userId)`:
  returns the most recent row (`orderBy: revisedAt desc`) if one exists,
  otherwise creates one with the defaults below and returns it.
- Not wired into the orchestrator — bootstrap helper only, per scope.

**Chosen defaults and reasoning** (schema has no prior usage anywhere in
code, only in two docs describing intent — see §11.2 of the master doc —
so these are a first cut, meant to be revised once real weekly data exists):

| Field | Value | Reasoning |
|---|---|---|
| `hrDisciplinePct` | `80` | Share of planned session time expected inside the prescribed HR zone before a session is flagged off-target. 80% leaves headroom for terrain/warm-up drift without being so loose it never flags anything. |
| `efStopThresholdPct` | `8` | Aerobic decoupling stop-signal threshold. The two validated FIT reference runs in Phase 1b sit at 6.63% (short easy run) and 10.54% (18 km long run) — 8% sits between them, flagging the long-run case as a signal without falsely flagging normal short-run decoupling. |
| `jumpRatioCeiling` | `1.1` | Mirrors the existing deterministic `MaxWeeklyVolumeIncreaseRule` (+10% week-over-week) already enforced elsewhere in the planner — keeps the new tunable consistent with a rule that's already proven out, rather than inventing a new number. |

Rationale text on the bootstrap row is exactly:
`"Initial defaults — not yet athlete-tuned, pending first week of data."`

**Verification**: ran a throwaway script (not committed) that created a
disposable user, called `getOrCreateTunableDefaults` twice (confirmed second
call returns the same row, not a duplicate), asserted the rationale string,
then deleted the `TunableDefaults` row and the user in a `finally` block.
Confirmed zero leftover rows via a follow-up query. `user_maxon` was never
touched.

## 3. Structured session-output fields

- `lib/ai/adapter.ts` — `PlannedSession` gains optional `distanceKm: number`,
  `targetPaceMinPerKm: string`, `targetHrZone: { min: number; max: number }`,
  `subtype: string`. `notes` unchanged and still effectively required at the
  tool-schema level.
- `lib/ai/claude-adapter.ts`:
  - `SubmitPlanInput` and the response-mapping in `generatePlan` carry the
    four new optional fields through.
  - `SUBMIT_PLAN_TOOL.input_schema` adds them as optional properties (not in
    `required`), each with a description telling Claude when to omit it.
  - System prompt gets a new "Structured targets" section: fill these fields
    for running/cycling sessions with a clear numeric target, leave them
    undefined for HYROX/swimming/strength or anything without a specific
    target — explicit instruction not to fabricate values.

**Migration stop condition: not hit.** These fields are carried only through
`PlanResult`/`PlannedSession` (in-memory, adapter output) — they are **not**
persisted. `TrainingSession` and `SessionWorkoutPlan` have no columns for
distance/pace/HR-zone/subtype (confirmed by reading `prisma/schema.prisma`),
and the orchestrator's session-persistence path
(`lib/planner/orchestrator.ts`, `trainingSession.createMany`) was not
touched, so nothing currently writes these new fields to the DB. Wiring
persistence is future work and would need a Prisma migration — flagged here
per CLAUDE.md rather than done silently.

## Validation

- `npx tsc --noEmit` — clean, no errors.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` — 7 files changed (route.ts, adapter.ts,
  claude-adapter.ts, schema.ts, tunable-defaults.ts, package.json,
  package-lock.json), 132 insertions, 3 deletions.

## Smoke test

**Result: PASS.**

End-to-end call of `generateWeeklyPlan(userId)` against the real Anthropic
API, using `scripts/smoke-test-plan-schema.ts`. Followed the throwaway-user
pattern from `scripts/verify-fixed-session-survival.ts`: created a disposable
user (never touching `user_maxon`) with wide-open availability windows for
all 7 days and one active Goal ("Sub-4h marathon", discipline `running`), no
prior sessions, then called `generateWeeklyPlan` for real.

- Tool call succeeded — no `submit_plan` schema validation error from
  Anthropic.
- Returned plan had 1 session: `2026-09-13 morning easy 50min :: running:
  easy run 10 km at conversational pace — aerobic base`.
- Structured fields (captured on the raw `PlanResult` from `ClaudeAdapter`,
  since `TrainingSession` has no DB columns for them and they are dropped
  before persistence — confirmed in the earlier "Migration stop condition"
  section):
  - `distanceKm`: `10`
  - `targetPaceMinPerKm`: `"6:30"`
  - `targetHrZone`: `{"min":130,"max":150}`
  - `subtype`: `"easy run"`
  - All four optional fields came back populated for this running session.
- Cleanup: plan, session, goal, availability windows, and user deleted in a
  `finally` block. Follow-up query confirmed zero leftover rows (user
  absent, 0 availability windows for the dummy userId).

Conclusion: the modified `submit_plan` tool schema is accepted by Anthropic
and Claude returns usable, populated structured output with it.
