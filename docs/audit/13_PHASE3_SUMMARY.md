# 13 — Phase 3 Summary (complete as of 2026-09-15)

## What shipped

1. jumpRatioCeiling wired into MaxWeeklyVolumeIncreaseRule (commit
   906eb4b) — closes the Phase 2 known gap where
   TunableDefaults.jumpRatioCeiling was revised weekly by the LLM but
   never actually enforced by the deterministic volume-cap rule.
2. UserTrainingProfile → AthleteDossier HR fallback (commit 3adb1f2) —
   when AthleteDossier.facts has no maxHr/lthrEstimate, the planner now
   falls back to the Settings-entered UserTrainingProfile.maxHr/
   .thresholdHr, so plans always get HR grounding when any HR data
   exists anywhere for the user. Dossier values always take priority
   when present. The on-demand single-workout planner
   (lib/ai/workout-plan.ts) already read UserTrainingProfile directly
   and was left untouched.
3. Read-only TunableDefaults revision history UI (commit 165a0b5,
   GET /api/tunables/history + TunablesHistoryCard on /review) — makes
   the weekly silent threshold-review process visible for the first
   time; shows each revision's three numeric values, rationale text,
   and a client-computed delta indicator against the prior revision.
4. HR-from-archive computation (commit 0aaf893) —
   lib/dossier/compute-hr-from-archive.ts +
   scripts/compute-hr-from-archive.ts derive maxHr and lthrEstimate from
   a local Strava archive export (activities.csv + gzipped FIT files)
   instead of manual entry. Run once for user_maxon: facts.maxHr
   183→179, facts.lthrEstimate 170→165.31, both tagged
   source: "computed" with candidate counts and timestamps. This was
   not in the original Phase 3 scope — it emerged mid-phase from a
   broader UX conversation about de-prioritizing manual HR entry in
   Settings, and was intentionally scoped down to "CLI-only, for
   himself, writes to AthleteDossier directly" rather than a self-serve
   web upload flow.

## Explicitly deferred, not fixed

- SessionMetrics.efWhole has no validity flag (unlike decouplingPct).
  Not fixed — no confirmed real-world instance of a misleading number
  seen yet. Revisit only if one actually shows up.
- Self-serve web upload of the Strava archive (chunked processing to
  fit the Free/Hobby Vercel plan's function-duration limits) —
  deliberately deferred until the CLI approach has proven itself
  further. The compute module (compute-hr-from-archive.ts) was written
  with no DB access, specifically so it's reusable for a future web
  flow without a rewrite.

## Process notes worth keeping for Phase 4 and beyond

- `git branch --merged main` is worth running periodically — plain
  `git branch -vv` made two long-since-merged branches
  (feature/goals-rebuild, fix/strava-sync-window) look like live
  unmerged work mid-session. Always check `--merged` before treating an
  old branch as a recon target.
- Every round in this phase followed the same discipline as Phase 2:
  recon → design agreed in chat first → implement → real synthetic-user
  test against the live DB/Claude API → cleanup → report → human review
  → merge. No shortcuts taken despite "burn the whole session" pacing
  requested for a couple of rounds.

## Where things stand entering Phase 4

Phase 4 is a UI/UX-focused phase, not a backend-logic phase — see
docs/audit/14_PHASE4_UX_BRIEF.md.
