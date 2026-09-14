# Phase 2 — Step 7 Report (season-block skeleton)

Branch: `phase2-step7-season-block` (off `main`, not merged)

Master doc: confirmed this session's scope against §11.3 item 7 of
`docs/audit/12_CURRENT_STATE_AND_PHASE2_MASTER.md` before starting.

Decision already made (per the prompt, not re-litigated): `blockPhase`/
`blockLabel` on `TrainingPlan` are computed automatically from the existing
`goal-guidance.ts` logic — no manual UI field, no settings input.

Commit: `7001edf` — feat(planner): derive season-block phase/label automatically

## 1. Recon

**`GoalGuidance` / `PerGoalGuidance` shape** (`lib/planner/goal-guidance.ts`,
read in full):

```ts
type GoalPhase = "base" | "build" | "taper";

interface PerGoalGuidance {
  id: string;
  title: string;
  discipline: string | null;
  daysUntil: number | null;
  phase: GoalPhase;
  weight: number; // normalized fraction, sums to ~1
}

interface GoalGuidance {
  primaryFocus: PerGoalGuidance | null; // top priority tier, nearest target date wins ties
  perGoal: PerGoalGuidance[];
  taperGoal: PerGoalGuidance | null;
}
```

`primaryFocus` already carries both `discipline` and `phase` for the
dominant goal — exactly what's needed, no new weighting logic required.
Phase thresholds (`derivePhase`): `days <= 14` → taper, `days <= 56` →
build, else → base (undated goals always `base`).

**blockLabel/blockPhase write paths — confirmed still true:**
`git grep "blockLabel\|blockPhase" app lib components` showed only
`app/api/plans/import/route.ts` touching these fields (typed
passthrough from imported JSON, `input.blockLabel ?? null` /
`input.blockPhase ?? null`). Neither `generateWeeklyPlan` nor
`generateNextWeekDraft` in `lib/planner/orchestrator.ts` wrote them —
confirmed by reading both `trainingPlan.create()` call sites before
editing.

**Schema constraint:** `prisma/schema.prisma:184-185` —
`blockLabel String?` / `blockPhase String?`. Plain optional strings, no
enum, no check constraint. No migration needed for this step.

## 2. Implementation

`lib/planner/orchestrator.ts`:
- Added `deriveSeasonBlock(goalGuidance: GoalGuidance)`, next to the
  existing `toGoalGuidanceInputs` helper. Pulls `primaryFocus` off the
  already-computed `GoalGuidance` (no re-derivation of priority/proximity
  weighting):
  - `blockPhase` = `primaryFocus.phase` verbatim (or `null` if no
    `primaryFocus`, i.e. `goals.length === 0`).
  - `blockLabel` = `` `${discipline} ${Capitalized(phase)}` `` when
    `discipline` is set (e.g. `"Marathon Build"`, `"HYROX Taper"`), else
    just the capitalized phase alone (`discipline` on `Goal` is a free
    string the athlete types — e.g. `"HYROX"` — so it's used as-typed,
    not re-cased, to avoid turning `"HYROX"` into `"Hyrox"`).
  - Zero active goals → both fields `null`, never fabricated.
- In `generateWeeklyPlan`: `goalGuidance` is now computed once into a
  local variable (was previously inlined directly into the
  `planningCtx` object literal) and reused both for `planningCtx` and
  for `deriveSeasonBlock`. `trainingPlan.create()` now writes
  `blockPhase: seasonBlock.blockPhase, blockLabel: seasonBlock.blockLabel`.
- In `generateNextWeekDraft`: identical pattern — `goalGuidance` and
  `seasonBlock` computed once before `planningCtx`, `trainingPlan.create()`
  for the draft plan now writes the same two fields.
- `app/api/plans/import/route.ts` — untouched. Manual override via
  import stays fully supported as-is.

## 3. UI surfacing

Checked `/week` (`app/(app)/week/page.tsx`) and `/review` for any
existing render of `blockLabel` first — `git grep "blockLabel\|blockPhase"`
against both page trees found nothing. Not previously surfaced anywhere.

Added to `/week`'s existing header block (next to the `<h1>Week</h1>`,
same section as the `ReplanButton`): a small pill showing `plan.blockLabel`
when present, reusing the exact style already used for the "Today" badge
elsewhere in the same file (`text-[10px] font-semibold uppercase
tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-100
rounded-full px-2 py-0.5`) — no new visual pattern introduced. `blockLabel`
added to the page's local `PlanWithSessions` type; the existing
`findFirst` query has no `select`, so it already returns the new scalar
field with no query change needed.

`/review` was not touched — no natural header location there for a
plan-level label (it's session-review-focused, not the weekly plan view),
and the prompt only asked to surface it "somewhere the athlete can
actually see it," which `/week`'s header already satisfies as the
primary weekly-plan surface.

## 4. Discrepancy flagged (not silently changed)

The task's test-plan text says "target date ~10 weeks out (should land in
`build` per goal-guidance's existing thresholds)." Per the actual
`derivePhase` thresholds confirmed in recon (`days <= 56` → build, else
`base`), 10 weeks = 70 days actually lands in **`base`**, not `build` —
outside the build band by 14 days. Rather than either silently changing
the target to match the (incorrect) expectation or writing a test that
would fail against the real, unmodified logic, the smoke test uses a
target date 40 days out, which genuinely lands in `build`. This is called
out inline in the test file's header comment as well.

## 5. Test

`scripts/smoke-test-season-block.ts` (new throwaway script), same cleanup
discipline as the existing smoke tests — synthetic user(s) + seeded
`AvailabilityWindow`, `finally` block deletes
`SessionMetrics/SessionWorkoutPlan → TrainingSession → TrainingPlanGoal →
TrainingPlan → Goal → WeekSummary → TunableDefaults → AthleteDossier →
AvailabilityWindow → User` regardless of outcome, follow-up query confirms
zero leftovers, `user_maxon` never touched.

**Test 1 — build-phase goal:** synthetic user with one active
`discipline: "Marathon"` goal, `targetDate` 40 days out. Calls
`generateWeeklyPlan(userId)` for real (live Anthropic API call — this
function always calls Claude, no way to isolate just the deterministic
part without invoking the real generation path). Independently computes
`computeGoalGuidance` on the same goal input outside the orchestrator as
a cross-check.

```
goal-guidance.ts independently computes phase=build
persisted TrainingPlan.blockPhase=build blockLabel=Marathon Build
✓ PASS: blockPhase/blockLabel match expected derivation.
```

Confirms: `blockPhase` matches goal-guidance.ts's own `primaryFocus.phase`
computed independently, and `blockLabel` is exactly `"Marathon Build"` —
discipline as typed + capitalized phase.

**Test 2 — zero active goals:** fresh synthetic user, no goals created.
Calls `generateWeeklyPlan(userId)`.

```
persisted TrainingPlan.blockPhase=null blockLabel=null
✓ PASS: both fields null, nothing fabricated with zero goals.
```

**Result: PASS** (both tests).

Cleanup: both synthetic users deleted in `finally`. Follow-up query
confirmed zero leftover rows for both (`userPresent=false,
leftoverAvailability=0, leftoverGoals=0` for each).

## Validation

- `npx prisma generate && npx tsc --noEmit` — clean.
- `npm run build` — succeeded.
- `git grep "user_maxon" -- app lib components` — no matches.
- `git grep "const USER_ID" -- app lib components` — no matches.
- `git diff --stat main` (implementation commit):
  `app/(app)/week/page.tsx` (+9/-1), `lib/planner/orchestrator.ts`
  (+30/-3), `scripts/smoke-test-season-block.ts` (new, +174) — plus this
  report.

## Out of scope, not done

- `/review` page — not given a blockLabel surface; `/week` already
  satisfies "somewhere the athlete can actually see it" as the primary
  weekly-plan view (see §3).
- No schema change — `blockPhase`/`blockLabel` remain untyped optional
  strings, matching the existing (pre-Step-7) schema; not something this
  step was scoped to touch.
- Items 6 (negotiation-step question) — already resolved per §11.3
  ("decided: no negotiation step, one-shot generation stays as-is").
  Nothing further from this step.
