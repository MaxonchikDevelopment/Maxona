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

## Follow-up checks

Read-only investigation only, no feature changes, not merged.

### 1. Duplicate HR data source — `UserTrainingProfile`

`grep -rn "UserTrainingProfile" app lib components` — model name never
appears as a literal identifier; code accesses it via the Prisma
accessor `prisma.userTrainingProfile`. Matches for that accessor:

- `app/(app)/settings/page.tsx:14` — **read**, feeds the Settings page UI.
- `app/(app)/sessions/[id]/page.tsx:80` — **read**, feeds HR zones shown on
  the session detail page (`buildHrZones`).
- `app/api/settings/training-profile/route.ts:9,29` — **read + write**
  (GET/PUT), the Settings-page CRUD endpoint for this model.
- `app/api/sessions/[id]/workout-plan/route.ts:40` — **read**, feeds
  `lib/ai/workout-plan.ts`'s per-session workout-plan generation
  (`buildZoneContext`) — a *different* AI call than the weekly planner.

`lib/planner/orchestrator.ts` and `lib/ai/claude-adapter.ts` — **zero
matches** for `userTrainingProfile`/`trainingProfile`. Confirmed: the
weekly planner (`generateWeeklyPlan`/`generateNextWeekDraft`) never reads
`UserTrainingProfile` at all.

**Conclusion:** `UserTrainingProfile` (Settings-page `maxHr`/`restingHr`/
`thresholdHr`/`zonesJson`, editable via UI) and `AthleteDossier.facts`
(`maxHr`/`lthrEstimate`, set only via `PUT /api/dossier`) are two fully
disconnected sources of the same underlying athlete HR data. Only the
dossier reaches the weekly-plan LLM call; a user who fills in their HR
zones in Settings gets zero effect on weekly-plan `targetHrZone` output —
that data only affects the separate per-session workout-plan endpoint.
Not fixed, per instructions — flagging for a future step.

### 2. Differential test — does `lthrEstimate` causally affect `targetHrZone`?

Ran as a throwaway scratch script (copied into `scripts/` temporarily to
get working relative imports, deleted after the run — not committed, no
permanent change to `scripts/smoke-test-plan-schema.ts`). Two throwaway
users, identical goal (`Sub-4h marathon`, running) and identical wide-open
availability, differing only in seeded `AthleteDossier.facts`:

| Case | Seeded `lthrEstimate` | Seeded `maxHr` | Returned `targetHrZone` (easy run) |
|---|---|---|---|
| A | 185 | 200 | `{"min":130,"max":148}` |
| B | 140 | 165 | `{"min":120,"max":133}` |

`min`-bound diff: **10 bpm**, against a **45 bpm** seeded `lthrEstimate`
gap between the two cases.

**Verdict: cosmetic, not causally effective.** The zones move in the
right *direction* (higher LTHR → higher zone), so the prompt instruction
isn't being ignored outright — but a 45 bpm swing in the athlete's actual
threshold HR should move an aerobic-easy zone by something much closer to
proportional (Case A's zone as %LTHR is ~70–80%; Case B's is ~86–95% —
the model is not consistently anchoring to the stated LTHR, it's mostly
falling back to a default absolute-bpm heuristic and only lightly nudging
it). This means the "ground `targetHrZone` in `athleteProfile.maxHr`/
`.lthrEstimate`" prompt guidance added in this step is present in the
prompt but not meaningfully driving model output — worth tightening
(e.g. an explicit %LTHR formula) in a future step rather than leaving it
as free-text guidance.

Both synthetic users and all related rows (goal, availability windows,
dossier, tunables, plan/sessions) were deleted in a `finally` block;
follow-up queries confirmed both users absent post-cleanup.

## Step 2b — deterministic zone computation

### 1. `buildHrZones()` shape (`lib/training/zones.ts`)

- Input `TrainingProfileInput`: `restingHr`, `maxHr`, `easyHrMin/Max`,
  `tempoHrMin/Max`, `thresholdHr`, `zoneMethod` (all optional/nullable) —
  matches `UserTrainingProfile` (the Settings-page model), not
  `AthleteDossier`.
- Two computation paths:
  - If `easyHrMin/Max` + `tempoHrMin/Max` + `thresholdHr` are all set
    ("manual zone boundaries"), it builds `z1`–`z5` directly from those
    bounds.
  - Otherwise, if `restingHr` **and** `maxHr` are both set, it uses the
    Karvonen formula (`restingHR + HRR × pct`) at 50/60/70/80/90% to build
    `z1`–`z5`.
  - Otherwise returns `null`.
- Output: `HrZones` = `{ z1..z5: { min, max } }` (recovery → VO2max), plus
  `formatZoneLabel`/`zoneDescription` helpers.

### 2. Reuse vs new helper — decision

Not reused. `buildHrZones()`'s two paths both need fields
`AthleteDossier.facts` doesn't have: the Karvonen path requires
`restingHr` (dossier has no resting-HR fact at all), and the manual path
requires a full pre-set `easyHrMin/Max`/`tempoHrMin/Max`/`thresholdHr`
bundle (dossier only ever has `maxHr`/`lthrEstimate`). Force-fitting either
path would mean fabricating a `restingHr` or fake zone bounds — rejected.

Wrote a separate helper, [`lib/training/zones-from-dossier.ts`](../../lib/training/zones-from-dossier.ts)
(`computeZonesFromDossier(maxHr, lthrEstimate)`), independent of
`buildHrZones()`. No standard %LTHR breakdown was already referenced in
the codebase (`zones.ts` uses %HRR/Karvonen, a different method); used the
bands given in the task instructions, which match common
threshold-anchored training-zone conventions:
- easy: 70–80% of LTHR
- tempo: 80–90% of LTHR
- threshold/hard: 90–100% of LTHR (capped at `maxHr` as a sanity ceiling)

Returns `null` unless both `maxHr` and `lthrEstimate` are present — no
partial-data guessing.

### 3. Prompt wiring

- `lib/ai/claude-adapter.ts`: `athleteProfile` object now includes
  `computedZones: { easy, tempo, threshold }` alongside the raw
  `maxHr`/`lthrEstimate` facts, computed via `computeZonesFromDossier`
  from `context.athleteDossier.facts` at prompt-build time (no orchestrator
  or `PlanningContext` type changes needed — the raw facts were already
  present in context).
- "Structured targets" system-prompt section rewritten: when
  `athleteProfile.computedZones` is present, `targetHrZone` should
  generally fall within the matching named band (easy run → `easy`, tempo
  run → `tempo`, interval/hard → `threshold`), small judgment-based
  adjustments allowed, not required to match exactly. Falls back to the
  previous raw-maxHr/lthrEstimate guidance only when `computedZones` is
  absent.

### 4. Re-run differential test

Same two-case throwaway script as the Step 2 follow-up check
(`{maxHr:200,lthrEstimate:185}` vs `{maxHr:165,lthrEstimate:140}`, same
goal/availability), written temporarily as
`scripts/_scratch-differential-zones.ts` and **deleted after the run** —
not committed, no permanent change to `scripts/`.

| Case | Seeded `lthrEstimate` | Seeded `maxHr` | Returned `targetHrZone` (easy run) | As %LTHR |
|---|---|---|---|---|
| A | 185 | 200 | `{"min":130,"max":148}` | 70.3–80.0% |
| B | 140 | 165 | `{"min":98,"max":112}` | 70.0–80.0% |

`min`-bound diff: **32 bpm**, against the same **45 bpm** seeded
`lthrEstimate` gap used in the Step 2 follow-up check (up from 10 bpm
before this change).

**Verdict: now proportional and causally effective.** Both cases land
almost exactly inside the computed `easy` band (70–80% of LTHR) — the
model is anchoring to `computedZones.easy` rather than applying a loose,
mostly-absolute heuristic as it did before. The remaining gap between the
32 bpm diff and the full 45 bpm LTHR gap is expected: the band itself is a
fixed-width 10%-of-LTHR window, and 10% of a larger LTHR is a larger bpm
span, plus Case A's `threshold` percentage is capped by the 200 `maxHr`
ceiling — neither distorts the comparison, both cases resolve to the same
%LTHR range. This confirms the tightened, explicit-band prompt guidance
(vs. the prior free-text "ground it in maxHr/lthrEstimate" instruction)
is what fixed the weak-effect problem flagged in the Step 2 follow-up
check.

### Validation

- `npx tsc --noEmit` — clean, no errors.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` — `lib/ai/claude-adapter.ts` (+33),
  `lib/training/zones-from-dossier.ts` new file (not shown by `git diff`
  until staged, +30 lines). No changes to `lib/ai/adapter.ts` or
  `lib/planner/orchestrator.ts` — `athleteDossier.facts` was already
  reaching the prompt layer from the Step 2 wiring, so zone computation is
  entirely a `claude-adapter.ts` + new-helper change.
