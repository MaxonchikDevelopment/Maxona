# 14 — Phase 4 Brief: UI/UX Overhaul

Written 2026-09-15, at the close of Phase 3. Paste/attach at the start
of a Phase 4 chat.

## 1. Why this phase exists

Phase 3 confirmed the backend logic now genuinely works as designed
(tunables loop closed, HR grounding always present, revision history
visible). But the interface itself is the actual blocker to real use:
too technical, not intuitive, hard to navigate. Maksym's own words:
Review & Plan is "awful" (ужас); Settings has too many non-intuitive
parameters. This echoes the original reason the pre-rebuild Maxona went
unused for months — a working backend nobody wants to open isn't a
working product.

Explicit operating principle for this phase, stated by Maksym: don't
move forward without solid logic/foundation in each piece, but never
lose sight of the business side and how the app is actually used day to
day — this is not a pure aesthetics pass.

## 2. Scope and approach

- Screen-by-screen redesign, not a full from-scratch rebuild (lower
  risk, incremental review).
- Worst-first: Review & Plan and Settings are the priority targets.
  Today/Week/Goals get attention after those two, if still warranted.
- Visual style: minor tweaks only, not a rebrand. The core visual
  language (premium athletic, glass/liquid, existing UI primitives)
  stays — the problem is information density and structure, not
  color/typography.
- Design workflow: chat-based collaborative design (Claude proposes
  structure in chat, Maksym approves/adjusts, Claude Code implements) —
  same model as the backend work in Phases 2-3. Not using a separate
  visual prototyping tool (budget-conscious decision, not a quality
  judgment).

## 3. Audit plan (do this first, before any redesign work)

Two parallel inputs:
1. Claude walks the live app via a Chrome browser extension, using
   Maksym's own already-authenticated session (Claude never enters
   credentials). Produces a screen-by-screen list of friction points,
   confusing copy, dead/unused fields, information overload.
2. Maksym provides his own pain-point list per screen, independently.

Cross-reference both before proposing any redesign.

## 4. Known specific targets going in

- **Settings numeric defaults** (running easy/tempo/long distances,
  long-run minutes, cycling/HYROX equivalents): recon first — confirm
  whether the planner (orchestrator.ts/claude-adapter.ts) actually
  reads these anywhere before deciding to remove. If confirmed dead
  (same pattern as the earlier UserTrainingProfile discovery — don't
  assume, verify), delete outright rather than hide. Don't repeat the
  "field exists, nobody remembers why" pattern a third time.
- **Nutrition / height / weight / calorie fields**: keep, but move
  under a collapsed/advanced section — not deleted, just
  de-prioritized visually.
- **Bring back a pre-generation confirmation/negotiation step** —
  explicitly reversing the Phase 2 decision to skip it (§11.3.1 item 6
  in docs/audit/12_CURRENT_STATE_AND_PHASE2_MASTER.md). Maksym wants to
  see and adjust the proposed session count/shape before full detail
  generation, specifically including a way to flag rest/off/busy days
  upfront rather than discovering conflicts after the fact. Design this
  from scratch — the earlier "no negotiation step" decision predates
  this Settings-heavy UX push and should not be treated as still
  binding.
- **Device split informs layout priority**: phone is used for quick
  status checks and marking sessions done; laptop is used for uploading
  FIT files and deeper review. Mobile-first for Today/quick actions;
  desktop can stay information-dense for Review & Plan/Settings/
  analysis screens.
- **Extend "compute instead of manual entry"** (the pattern already
  built for HR zones in Phase 3) to other Settings fields wherever
  feasible — evaluate case by case during the Settings redesign, not a
  blanket rule.

## 5. Deferred backend items — pick up opportunistically only

Not the focus of Phase 4. Only touch these if a session has spare
time/budget after its main UX task:
- Self-serve web upload of the Strava archive (replacing the current
  CLI-only flow) — chunked to fit the Free/Hobby Vercel plan.
- SessionMetrics.efWhole validity flag — only if a real bad number is
  actually observed.

## 6. Longer-horizon ideas — not scheduled, just recorded

Maksym explicitly flagged these as speculative/"several steps ahead,"
not a commitment:
- An in-app conversational chat interface with the planner itself —
  confirm/reject a generated session in natural language, explain
  objections, planner incorporates feedback into regeneration.
  Eventually with voice input.
- Free-text profile updates ("my weight is now 75kg") applied
  automatically by the AI instead of navigating Settings forms.

These are noted for whenever a future phase revisits them — not part
of the Phase 4 UI/UX overhaul itself.

## 7. What to bring into the Phase 4 chat

- This file.
- docs/audit/13_PHASE3_SUMMARY.md for what changed just before this
  phase.
- The Maxona repo itself.
- Whatever the Chrome-extension audit and Maksym's own pain-point list
  turn up — do the audit first, then return to plan the actual redesign
  work.
