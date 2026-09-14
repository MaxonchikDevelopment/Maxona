# Phase 2 — Step 4 Report (weekHistory continuity)

Branch: `phase2-step4-weekhistory-continuity` (off `main`, not merged)

Master doc: confirmed this session's scope against §11.3 item 4 of
`docs/audit/12_CURRENT_STATE_AND_PHASE2_MASTER.md` before starting — matches
exactly ("extend weekHistory to generateWeeklyPlan… and roll SessionMetrics
… into persistWeekSummary…").

Commits:
- `51f7941` — feat(planner): extend weekHistory to generateWeeklyPlan
- `e2acfc4` — feat(planner): roll SessionMetrics decoupling/EF trend into WeekSummary

## 1. weekHistory in generateWeeklyPlan

`lib/planner/orchestrator.ts` — `generateNextWeekDraft` already queried the
last 4 `WeekSummary` rows (`weekStart: { lt: nextWeekStart }`, `orderBy:
desc`, `take: 4`) and mapped them oldest→newest into `weekHistory`.
`generateWeeklyPlan` had no equivalent query at all.

Replicated the identical query/mapping in `generateWeeklyPlan`, keyed off
that function's own `weekStart` (the current week being replanned), added to
its `Promise.all` batch, and wired `weekHistory: weekHistory.length > 0 ?
weekHistory : undefined` into `planningCtx` — same pattern as the draft path.

**Same-week-replan system-prompt flag (as requested):** Read the
`## Multi-week trend (weekHistory)` section in `lib/ai/claude-adapter.ts`
(lines ~271-276) and the `isReplan` logic (lines ~369, 414-415). Finding:
the prompt wording is already conditional — "When weekHistory is present…" —
and `isReplan` is a wholly separate flag (`!!context.replanReason`) with no
coupling to `weekHistory` presence anywhere in the prompt-building code. The
guidance was never written under an assumption that weekHistory is absent
during a same-week replan; it just handles absence generically. **No wording
change needed** — flagging as requested, but nothing to adjust.

## 2. SessionMetrics → WeekSummary

Read `lib/planner/rollover.ts`'s `activateDraftIfReady` in full (it's the
caller — `persistWeekSummary` itself lives in `lib/week-summary.ts`, read in
full too) and the `WeekSummary` Prisma model.

**signals vs. migration decision:** `WeekSummary.signals` is a `Json` field
already holding a fixed-shape object (`{lowReadinessDays, fatigueDays,
injuryDays, unresolvedIssues, mainLimiter}`) assembled entirely in code, not
a loose user-writable bag. Adding `avgDecouplingPct`, `decouplingSessionCount`,
`avgEfWhole`, `efSessionCount` as optional keys fits this shape exactly —
**no new columns, no migration.** (Per instructions, would have stopped and
reported here if a migration had been needed — it wasn't.)

Changes:
- `lib/week-summary.ts`
  - `WeekSummarySession` type gains optional `metrics?: SessionMetrics | null`.
  - `computeWeekSummary` computes:
    - `avgDecouplingPct` — average `decouplingPct` across sessions where
      `metrics.decouplingValid === true` only. Invalid/short sessions never
      enter the average. If zero valid sessions, the field is **omitted
      entirely** (not written as 0/null) — same for `avgEfWhole`.
    - `avgEfWhole` — average `efWhole` across all sessions that have a
      non-null value. **Gap noted, not fixed:** `SessionMetrics.efWhole` has
      no validity flag analogous to `decouplingValid`, so every non-null EF
      value is included regardless of session length/quality. This is a
      real gap in the current schema, not an intentional design choice —
      out of scope to add one this session (would need a schema change).
    - Both averages always ship with a same-week sample-size field
      (`decouplingSessionCount`, `efSessionCount`) — never an average
      without its `n`.
  - `WeekSummaryResult.signals` type extended with these 4 optional fields.
- `lib/planner/rollover.ts` — `activateDraftIfReady`'s session query gains
  `metrics: true` in the `include` so the outgoing week's `SessionMetrics`
  rows are actually fetched before `persistWeekSummary` runs. (The
  in-progress-week stats route, `app/api/plans/review/stats/route.ts`, was
  **not** touched — out of scope; it still computes without `metrics`, so
  the new signal fields are simply absent there, which is correct behavior
  for a still-in-progress week.)
- `lib/ai/adapter.ts` — `WeekHistoryEntry` gains the same 4 optional fields.
- `lib/planner/orchestrator.ts` — both `weekHistory` mapping sites (draft
  and, from item 1, weekly-plan) now read `signals.avgDecouplingPct` /
  `signals.decouplingSessionCount` / `signals.avgEfWhole` /
  `signals.efSessionCount` off the persisted `WeekSummary.signals` Json and
  pass them through only when present.
- `lib/ai/claude-adapter.ts`
  - `weekHistory` prompt rendering includes the new fields per week when
    present.
  - Added one line to the `## Multi-week trend (weekHistory)` system-prompt
    section: a rising `avgDecouplingPct` trend across weekHistory entries is
    framed as a fatigue/overreach signal worth more conservative planning —
    explicitly guidance, not a hard threshold, consistent with the rest of
    that section's style (no rigid pass/fail rules).

## Validation

- `npx tsc --noEmit` — clean, both commits.
- `npm run build` — succeeded, both commits.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` (final, both commits combined):
  `lib/ai/adapter.ts` (+6), `lib/ai/claude-adapter.ts` (+9),
  `lib/planner/orchestrator.ts` (+52), `lib/planner/rollover.ts` (+1),
  `lib/week-summary.ts` (+35/-2), `scripts/smoke-test-week-history.ts`
  (new file) — plus this report.

## Test

Wrote a new throwaway script, `scripts/smoke-test-week-history.ts` (new
file rather than extending `smoke-test-plan-schema.ts` — different fixture
shape: needs an *archived past week* with sessions/metrics, not just a
clean current-week context). Same cleanup discipline as the existing smoke
test: synthetic user + login, `finally` block deletes
`SessionMetrics → TrainingSession → TrainingPlanGoal → TrainingPlan →
WeekSummary → Goal → AvailabilityWindow → TunableDefaults →
AthleteDossier → User` regardless of outcome, follow-up query confirms zero
leftovers, `user_maxon` never touched.

Fixture: dummy user, wide-open availability, one active goal, one archived
`TrainingPlan` for a week 8–14 days in the past with 2 `done` sessions —
one `SessionMetrics` row `decouplingValid: true, decouplingPct: 3.2`, one
`decouplingValid: false, decouplingPct: 25.0` (both `efWhole` set: 0.015
and 0.018).

**Result: PASS.**

- `persistWeekSummary` called directly on the archived week →
  `WeekSummary.signals` = `{avgDecouplingPct: 3.2, decouplingSessionCount: 1,
  avgEfWhole: 0.017, efSessionCount: 2, ...}`. Confirms the invalid session's
  25.0% never entered the decoupling average, and confirms `efWhole`
  correctly averaged both sessions ((0.015+0.018)/2 rounded to 3 decimals =
  0.017 per JS floating-point rounding — script asserted against the same
  computation and matched exactly).
- `generateWeeklyPlan(dummyUserId)` called for real (live Anthropic API
  call) with `ClaudeAdapter.prototype.generatePlan` monkey-patched to
  capture the actual `PlanningContext` passed in. Logged
  `PlanningContext.weekHistory` immediately before the Claude call:
  ```json
  [
    {
      "weekStart": "2026-08-31",
      "adherenceByCount": 100,
      "hardDone": 1,
      "hardPlanned": 1,
      "avgFeelScore": null,
      "mainLimiter": null,
      "carryForward": [],
      "avgDecouplingPct": 3.2,
      "decouplingSessionCount": 1,
      "avgEfWhole": 0.017,
      "efSessionCount": 2
    }
  ]
  ```
  Confirms `generateWeeklyPlan` now receives non-empty `weekHistory`
  (previously always `undefined` for this function) and that it carries the
  new decoupling/EF fields end-to-end from `WeekSummary.signals` through
  the orchestrator mapping into the actual `PlanningContext` object handed
  to Claude.
- Cleanup: all synthetic rows deleted in `finally`. Follow-up query
  confirmed `user present=false, leftover availability rows=0, leftover
  WeekSummary rows=0`.

## Out of scope, not done (confirmed)

- Silent weekly TunableDefaults review (§11.3 item 5) — not started, per
  scope (this session was items 1 and 2 only, i.e. master-doc item 4).
- Negotiation-step and season-block-skeleton questions (§11.3 items 6–7) —
  untouched, still open.
- `efWhole` validity-flag gap on `SessionMetrics` — noted above, not fixed
  (would require a schema change).
- `app/api/plans/review/stats/route.ts` (in-progress-week stats) —
  intentionally not updated to include `metrics`; out of scope for this
  step, which targeted `persistWeekSummary`/archived weeks specifically.

## Follow-up fix

Same branch, one additional commit, fixing a gap this report had flagged
but not fixed: `avgEfWhole` was averaging `efWhole` across every session
regardless of intensity — easy, moderate, and hard sessions blended into
one number.

**Why this is wrong:** EF (efficiency factor, pace/output per heart-rate
beat) is only a meaningful *aerobic-efficiency* trend signal within a
stable intensity band. A hard interval session and an easy aerobic run
have deliberately different EF by design — that's not noise, it's the
point of training at different intensities. Averaging them together
produces a number that doesn't track anything real, unlike
`avgDecouplingPct`, which was already correctly gated by
`decouplingValid` (itself gated on a duration threshold) so short/invalid
sessions never entered that average.

**Fix:** `computeWeekSummary` in `lib/week-summary.ts` now restricts the
`efWhole` values feeding `avgEfWhole`/`efSessionCount` to sessions with
`intensity === "easy" || intensity === "moderate"`, using the existing
`SessionIntensity` Prisma enum already present on each
`WeekSummarySession`. Hard-intensity sessions are excluded from this
average entirely, even though `efWhole` itself still has no validity flag
(that schema gap remains, as noted above). Zero qualifying sessions →
the fields are omitted from `signals` entirely, same discipline as
before (never a fabricated 0/null).

Updated the field-level comments so nobody misreads the semantics later:
- `WeekHistoryEntry.avgEfWhole` in `lib/ai/adapter.ts` — now documented
  as an easy/moderate-only aerobic-efficiency trend, not an all-sessions
  average.
- The `## Multi-week trend (weekHistory)` system-prompt section in
  `lib/ai/claude-adapter.ts` — added a line stating the same restriction,
  so Claude doesn't read a rising/falling `avgEfWhole` as reflecting hard
  efforts too.

### Test additions

Extended `scripts/smoke-test-week-history.ts`:
- Changed the existing "invalid decoupling" session's intensity to `hard`
  (it already had `efWhole: 0.018` and `decouplingValid: false`) so the
  fixture now also exercises the new intensity filter — updated the
  assertion to expect `avgEfWhole` = only the moderate-intensity session's
  value (0.015, count=1), not the two-session average.
- Added a second archived week with one `done` session and **no**
  `SessionMetrics` row at all (the common real-world case: no FIT upload
  that week). Asserts `persistWeekSummary` returns `true` (no crash) and
  that `avgDecouplingPct`, `decouplingSessionCount`, `avgEfWhole`, and
  `efSessionCount` are all absent from `signals` — not written as
  zero/null.
- Cleanup unchanged in structure (deletes by `userId` across both
  archived plans); confirmed zero leftover rows in the follow-up query.

### Test output

Decoupling-validity + intensity-filtering week:
```json
{
  "avgEfWhole": 0.015,
  "injuryDays": 0,
  "fatigueDays": 0,
  "mainLimiter": null,
  "efSessionCount": 1,
  "avgDecouplingPct": 3.2,
  "lowReadinessDays": 0,
  "unresolvedIssues": 0,
  "decouplingSessionCount": 1
}
```
PASS: `avgDecouplingPct` reflects only the valid session (3.2%, n=1).
PASS: `avgEfWhole` excludes the hard-intensity session (0.015, n=1) —
previously this would have been `(0.015+0.018)/2 = 0.0165`.

No-metrics week:
```json
{
  "injuryDays": 0,
  "fatigueDays": 0,
  "mainLimiter": null,
  "lowReadinessDays": 0,
  "unresolvedIssues": 0
}
```
PASS: no crash, all 4 decoupling/EF fields absent entirely.

`generateWeeklyPlan`'s captured `PlanningContext.weekHistory` (both
archived weeks, oldest → newest) confirmed the no-metrics week carries no
decoupling/EF keys while the other week carries the filtered values —
end-to-end, unchanged from persisted `WeekSummary.signals` through to the
`PlanningContext` handed to Claude.

### Validation

- `npx tsc --noEmit` — clean.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` (all commits on this branch combined):
  `lib/ai/adapter.ts` (+9), `lib/ai/claude-adapter.ts` (+10),
  `lib/planner/orchestrator.ts` (+52/-1), `lib/planner/rollover.ts` (+1),
  `lib/week-summary.ts` (+38/-2), `scripts/smoke-test-week-history.ts`
  (+352 new) — plus this report.

Commit: (see git log — appended below after committing)
