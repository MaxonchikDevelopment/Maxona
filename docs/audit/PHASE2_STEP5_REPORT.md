# Phase 2 — Step 5 Report (silent weekly TunableDefaults review)

Branch: `phase2-step5-tunable-review` (off `main`, not merged)

Master doc: confirmed scope against §11.3 item 5 of
`docs/audit/12_CURRENT_STATE_AND_PHASE2_MASTER.md` before starting —
"Silent weekly TunableDefaults review — hook into the same
persistWeekSummary path in rollover.ts, now that there's a bootstrap story
(from step 2) and real trend data to revise against (from step 4)." Matches.

Commits:
- `54e6e9f` — feat(planner): add silent weekly TunableDefaults review
- (this report) — docs(audit): add Phase 2 Step 5 report

## 1. New LLM call — `lib/ai/tunable-review.ts`

`reviewTunableDefaults(current: TunableDefaults, weekSummary: WeekSummary,
weekHistory: WeekHistoryEntry[])` follows the same
Anthropic-client/forced-tool-call pattern as `claude-adapter.ts`'s
`submit_plan`: same `model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"`
(explicitly NOT Haiku — safety-adjacent thresholds), `tool_choice: { type:
"tool", name: "submit_tunables" }`, `max_tokens: 1024`. Tool schema requires
`hrDisciplinePct`, `efStopThresholdPct`, `jumpRatioCeiling` (numbers) and a
required `rationale` string.

System prompt explains each threshold's meaning (lifted from the comments in
`lib/planner/tunable-defaults.ts`'s `INITIAL_DEFAULTS`), instructs the model
to revise gradually rather than swing week to week, that keeping values
close to or equal to current is fine when the week's data doesn't clearly
suggest a change, and explicitly requires the rationale to cite real numbers
from `weekSummary`/`weekHistory` rather than generic language.

The user prompt serializes `currentTunables`, the just-completed
`weekSummary` (planned/done/skipped, adherence, hard sessions, avgFeelScore,
`signals` — including `avgDecouplingPct`/`avgEfWhole` when present —
carryForward), and `weekHistory` mapped the same way
`orchestrator.ts` already maps it for the planner prompt (oldest → newest,
decoupling/EF fields only when present).

## 2. Deterministic guardrails — `clampTunableProposal`

Exported alongside `reviewTunableDefaults` in the same file so the clamp
logic is independently testable. Bounds chosen:

- **hrDisciplinePct: [50, 95]** — below 50% the metric stops meaningfully
  distinguishing "off-target" sessions; above 95% is functionally an
  always-fail bar. The initial default (80) sits centrally.
- **efStopThresholdPct: [4, 15]** — the two validated FIT reference points
  (6.63% / 10.54%, per the `tunable-defaults.ts` comment) both sit
  comfortably inside this range, and the initial default (8) is between
  them. 4% floor keeps the stop-signal from firing on ordinary noise; 15%
  ceiling keeps it from becoming meaningless.
- **jumpRatioCeiling: [1.0, 1.2]** — mirrors the deterministic
  `MaxWeeklyVolumeIncreaseRule`'s existing +10% (`MAX_INCREASE_FACTOR = 1.1`
  in `lib/rules/max-weekly-volume.ts`). 1.0 floor (no volume decrease
  requirement) to 1.2 ceiling (double the deterministic rule's current
  cap) bounds how far the "soft" prompt-facing number can drift from the
  hard-enforced one.

If a clamp changes the LLM's proposed number, a
`[Guardrail clamp applied: ...]` note is appended to the stored rationale
naming the field, the original value, and the clamped value — so the
append-only `TunableDefaults` history stays honest about what actually
happened versus what the LLM proposed. The clamped result is written as a
**new row** via `prisma.tunableDefaults.create` (never an update) —
`getOrCreateTunableDefaults` is untouched and continues to pick up the
latest row by `revisedAt`.

## 3. Wiring — `lib/planner/rollover.ts`

`activateDraftIfReady`, immediately after `persistWeekSummary` returns
`true` for the outgoing week, calls a new local `reviewTunablesIfDue(userId,
weekStart)`:

- Re-reads the just-persisted `WeekSummary` row (`userId_weekStart` unique
  key) and returns early, writing nothing, if `weekSummary.done <= 0` —
  covers "no session data to revise against" without a separate flag.
- Fetches `current` via `getOrCreateTunableDefaults` and the last 4 prior
  `WeekSummary` rows (`weekStart: { lt: weekStart }`, same query shape as
  `orchestrator.ts`'s `weekHistory` fetch) and maps them into
  `WeekHistoryEntry[]` with the identical oldest→newest / signals-unpacking
  logic already used there.
- Calls `reviewTunableDefaults`, clamps the result, and creates the new
  `TunableDefaults` row.
- The entire function body is one `try/catch`; a caught error is
  `console.error`'d and swallowed. It runs strictly after the
  archive/activate `$transaction` and after the existing best-effort
  `persistWeekSummary` call — same "outside the core transaction,
  best-effort" placement, so a review failure can never roll back or block
  plan activation.

## Test

Wrote `scripts/smoke-test-tunable-review.ts` — three throwaway users, each
driven through the **real** `activateDraftIfReady` rollover path (not a
direct call to the review function) so the wiring itself is under test.
Same cleanup discipline as prior smoke tests: `finally` block deletes
`SessionMetrics → TrainingSession → TrainingPlanGoal → TrainingPlan →
WeekSummary → TunableDefaults → AvailabilityWindow → AthleteDossier → User`
per synthetic user regardless of outcome, follow-up query confirms zero
leftovers.

Run: `npx tsx --env-file=.env.local scripts/smoke-test-tunable-review.ts`

**Result: PASS (all three scenarios).**

### Test 1 — worsening decoupling trend, 2+ done sessions

Setup: 2 prior `WeekSummary` rows with `avgDecouplingPct` 3.0% (3 weeks ago)
→ 6.0% (2 weeks ago), plus an outgoing active-plan week with 2 done
sessions, one carrying `SessionMetrics.decouplingPct = 9.0%`
(`decouplingValid: true`).

Outcome: a new `TunableDefaults` row was created.
- `hrDisciplinePct`: 80 → **80** (unchanged)
- `efStopThresholdPct`: 8 → **7.5** (tightened — sensible direction: rising
  decoupling trend → lower/more-sensitive stop threshold)
- `jumpRatioCeiling`: 1.1 → **1.1** (unchanged)

Rationale (verbatim):
> Three-week decoupling trend is rising: 3% (2026-08-24) → 6% (2026-08-31) →
> 9% (2026-09-07). That is a 3-point jump each successive week, and this
> week's 9% already breaches the current 8% efStopThresholdPct ceiling. The
> validated FIT reference band sits at 6.63%–10.54%, so 9% is not
> catastrophic, but a consistent upward trend across all three available
> weeks is a clear early fatigue/aerobic-drift signal that warrants a
> modest tightening of the stop threshold — from 8% down to 7.5% — so the
> flag fires sooner if the trend continues. avgEfWhole has been
> flat-to-marginally-improving (0.015 → 0.016 → 0.016), meaning the rising
> decoupling is not paired with EF gains, reinforcing the concern.
> hrDisciplinePct stays at 80: adherence by count is 100% across all three
> weeks with zero injuryDays, fatigueDays, lowReadinessDays, or
> unresolvedIssues, but the sample (2 sessions this week, 1 decoupling data
> point) is too small to justify raising the bar. jumpRatioCeiling stays at
> 1.1: the decoupling trend argues against loosening volume constraints, and
> no history of sustained high-volume clean weeks exists yet to justify an
> increase. Changes are intentionally small (−0.5 on efStopThresholdPct
> only) consistent with slow-moving profile adjustment.

Sanity check: direction is sensible (rising decoupling → tighter, not
looser, stop threshold) and the model correctly declined to move
`jumpRatioCeiling` given the trend argues against loosening it. No clamp
was triggered (7.5 is well inside `[4, 15]`).

### Test 2 — zero done sessions

Setup: outgoing week has a scheduled session with `status: "skipped"`, no
`"done"` sessions at all.

Outcome: `activateDraftIfReady` returned `true` (rollover itself still
completed) and `TunableDefaults` row count for the user stayed at **1**
(only the pre-seeded initial row) — confirms the `done <= 0` gate skips the
review silently, no row written, no error.

### Test 3 — simulated LLM failure

Setup: identical to Test 1 (worsening trend, 2 done sessions), but
`process.env.ANTHROPIC_MODEL` was temporarily set to
`"invalid-model-does-not-exist"` for the duration of the
`activateDraftIfReady` call only, then restored in a `finally` block
immediately after.

Outcome: the Anthropic API returned a 404 `not_found_error` for the model
name; `reviewTunablesIfDue`'s catch block logged
`[rollover] reviewTunablesIfDue failed: NotFoundError: 404 ...` and
swallowed it. `activateDraftIfReady` still returned `true` and the draft
plan's status was confirmed `active` in the DB afterward — the core
archive/activate transaction was unaffected. `TunableDefaults` row count
stayed at 1 (no partial/bad row written). `ANTHROPIC_MODEL` was confirmed
restored to its original value afterward.

## Validation

- `npx tsc --noEmit` — clean.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` (feature commit `54e6e9f`):
  `lib/ai/tunable-review.ts` (new, +166), `lib/planner/rollover.ts` (+66/-1),
  `scripts/smoke-test-tunable-review.ts` (new file) — plus this report.

## Flagged, not fixed: jumpRatioCeiling vs. MaxWeeklyVolumeIncreaseRule disconnect

`PHASE2_STEP2_REPORT.md` already noted that wiring `tunableDefaults` into
the planning prompt was "prompt guidance only" — the deterministic rules
engine was untouched. Concretely, `lib/rules/max-weekly-volume.ts` enforces
week-over-week volume with a **hardcoded** `MAX_INCREASE_FACTOR = 1.1`,
entirely independent of `TunableDefaults.jumpRatioCeiling`. That value only
ever reaches Claude as prompt text (`athleteProfile.tunables.jumpRatioCeiling`
in `claude-adapter.ts`'s `buildUserPrompt`) — advisory context for the LLM's
initial draft, not something the deterministic post-check actually reads.

Now that this step makes `jumpRatioCeiling` an **actively LLM-revised**
value (Test 1 shows it can move, even though it didn't this run), the
disconnect is more concrete than before: the athlete's profile can now
diverge from the enforced cap in either direction —
- if the review raises `jumpRatioCeiling` above 1.1 (allowed up to the 1.2
  guardrail), the deterministic rule still silently re-clamps any week that
  tries to use the higher number, so the "personalized" increase has no
  actual effect;
- if the review lowers it below 1.1, the LLM's own draft may respect the
  tighter number, but the deterministic rule would still permit up to +10%
  regardless, so nothing stops a later replan or a different code path from
  producing a jump the athlete's revised profile considered too aggressive.

Not fixed this session — out of scope per the task (`--fix` was not
requested and this is a rules-engine change, not a planner/review one).
Flagging again here since it's now a live, reachable inconsistency rather
than a theoretical one.

## Out of scope, not done (confirmed)

- Negotiation-step question (§11.3 item 6) — untouched, still open.
- Season-block-skeleton question (§11.3 item 7) — untouched, still open.
- `jumpRatioCeiling` → `MaxWeeklyVolumeIncreaseRule` enforcement gap — flagged
  above, not fixed.
- `efWhole` validity-flag gap on `SessionMetrics` (noted in the Step 4
  report) — still open, unrelated to this step's scope.

## Test 4 — empty weekHistory (first-ever rollover)

Added a fourth throwaway user to `scripts/smoke-test-tunable-review.ts`,
same outgoing-week shape as Test 1 (2 done sessions, one with
`SessionMetrics` — `decouplingValid: true, decouplingPct: 9.0`), but with
**zero prior `WeekSummary` rows** — no `seedWeekHistoryRow` calls — to
simulate a user's very first-ever rollover, where `weekHistory` passed into
the review is an empty array. Run through the real `activateDraftIfReady`
path, same as Tests 1–3. Report only, no pass/fail assertion (per task).

Validation before running: `npx tsc --noEmit` clean, `npm run build`
succeeded, `git grep "user_maxon" -- app lib components` and
`git grep "const USER_ID" -- app lib components` both empty.

**Result:**

- `activateDraftIfReady` returned `true` (rollover completed normally).
- A **new** `TunableDefaults` row **was** created.
- Values: `hrDisciplinePct: 80 → 80`, `efStopThresholdPct: 8 → 8`,
  `jumpRatioCeiling: 1.1 → 1.1` — all three held at current defaults,
  unchanged.
- Rationale (verbatim):

  > This is the first completed week with real athlete data (2026-09-07 to
  > 2026-09-13), so all three tunables are held at their initial defaults.
  > [...] hrDisciplinePct (80): No HR discipline data is available to
  > evaluate session targeting quality. [...] efStopThresholdPct (8): The
  > single decoupling session recorded an avgDecouplingPct of 9%, which sits
  > above the current threshold of 8%. This is a mild flag, but with only 1
  > decoupling session and an empty weekHistory, there is no trend to anchor
  > on. [...] Lowering the threshold further on a single data point from the
  > first week would be premature and overly reactive — the slow-moving
  > profile rule applies. Holding at 8%. jumpRatioCeiling (1.1): weekHistory
  > is empty, meaning there is no multi-week volume trend to assess. [...]
  > there is neither a signal to loosen nor tighten volume progression.
  > Holding at 1.1 [...] Revisit next week: if avgDecouplingPct remains
  > above 8% across a second session, a downward adjustment of
  > efStopThresholdPct toward 7.5% should be considered.

**Assessment:** matches the conservative behavior the task described as
appropriate. Even though the single completed session's `decouplingPct`
(9.0%) technically exceeds the current `efStopThresholdPct` (8.0), the
model explicitly declined to react to it — citing the empty `weekHistory`
and single-sample size as insufficient grounds for a swing, and holding all
three values at their existing defaults. It also self-documented a
"revisit next week" condition rather than acting preemptively. No
unwarranted single-week swing observed. The row-creation behavior itself
(a new row is written even when all values are unchanged from the previous
row) matches Test 1's pattern and is unrelated to the empty-history case
specifically — not something this test was scoped to evaluate further.

Not fixed — per the task, this session reports the actual behavior only.
