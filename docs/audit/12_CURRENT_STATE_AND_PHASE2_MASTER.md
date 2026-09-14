12 — Maxona: Current State & Phase 2 Master (supersedes stale sections of 01/05/07/09/10)

Written 2026-09-13. This file is the authoritative "where things actually stand" doc. Where it conflicts with 01, 05, 07, 08, 09, 10 — this file wins. See §9 for exactly which old sections are dead and why.

1. What Maxona is, as of now

Private MVP adaptive sports planner (Next.js/Prisma/Supabase/Vercel), built by Maksym, one athlete (himself) as the only real user so far, with the eventual option to open it to others.

Repo: github.com/MaxonchikDevelopment/Maxona Live: https://maxona-ai.vercel.app

Core scope, current (post strategic pivot, Sept 2026):

Weekly training plan generation, LLM-judgment-driven, not a rigid rule engine.
FIT-file-based session analytics (EF, decoupling, HR zone share, cadence, power) as the source of truth — not Strava's API streams.
Athlete dossier (facts about the athlete) + tunable per-athlete thresholds, both versioned, both revised over time by LLM judgment based on accumulating data.
Import/export bridge to the manual "Sport" Claude Project workflow (this is the interim state before Phase 2 replaces the manual round-trip).

Explicitly cut from scope (do NOT resurrect without a new explicit decision):

Daily generic Nutrition advice (breakfast/lunch/dinner/grams/kcal). Reduced to a carb-loading calculator triggered near long runs/races only. Reason: daily advice was never actually followed in practice.
Daily subjective Readiness check-in. Cut entirely until a real HRV/sleep-capable tracker is bought (Fitbit Sense or a proper Garmin). Reason: manual subjective input without real tracker data was miscalibrated and low-value.
Strava-stream-based analytics as a source of truth for decoupling/pause detection. Strava's API doesn't expose raw FIT event messages (timer stop/ start), only pre-processed streams — this is structural, not a paid-tier gap. Manual FIT upload for long/key sessions is the permanent design.
2. What's actually live (Phase 0 + Phase 1 — complete, smoke-tested, in prod)
Phase 0
feature/goals-rebuild merged to main: WeekSummary, PlannedFixedSession, week-rollover retrospective logic (lib/planner/rollover.ts), goal-phase weighting (lib/planner/goal-guidance.ts). Two additive migrations applied.
Phase 1a — schema

New models: AthleteDossier (facts: Json, versioned), TunableDefaults (per-athlete tunable thresholds + rationale, versioned), SessionMetrics (EF, decoupling, zone share, cadence, power per session). New fields: SessionWorkoutPlan.rationale / .evaluationMode; TrainingPlan.blockLabel / .blockPhase; WeekSummary.narrativeMd. RLS enabled on all three new tables. lib/dossier/types.ts defines AthleteDossierFacts (TS shape only — not enforced server-side yet, see §5).

Phase 1b — FIT analytics

lib/analytics/run-metrics.ts → computeSessionMetrics(fitBuffer): parses FIT via fit-file-parser, event-based pause detection for moving time, EF (whole/first-half/second-half), decoupling % with validity flag (≥90 min moving time required), HR zone share (<140 / 140–150 / >150), cadence (via total_cycles, same value other libs call total_strides), avg power. POST /api/sessions/[id]/fit-upload — multipart, owner-scoped, upserts SessionMetrics. Validated against two real FIT files, exact match to independently verified reference numbers (decoupling 6.63% short easy run, 10.54% 18km long run).

Phase 1c — import / export / dossier API

POST /api/plans/import — WeeklyPlan JSON → validated → writes TrainingPlan+TrainingSessions+SessionWorkoutPlans+PlannedFixedSessions atomically. Archives prior active TrainingPlan first (bug fixed during testing, see §4). GET /api/plans/export-context — AvailabilityWindow + upcoming ScheduleEvents (14d) + latest WeekSummary (fallback: last 7d SessionMetrics) → one markdown block for the Sport chat. GET/PUT /api/dossier — facts CRUD, versioned, no shape validation yet.

Phase 1d — UI

Three cards on /review: Export context, Import plan, Dossier. Matches existing design system, no new component patterns.

Full smoke test passed end to end — dossier round-trip, plan import, FIT upload with exact-match metrics, export-context surfacing, test data cleaned up.

3. Governing philosophy for the planner (this drives all of Phase 2 design)

This is why Phase 2 looks the way it does — read before designing anything:

No rigid rule-engine / hardcoded decision tree. Metrics are computed deterministically in code; the judgment call on plan shape stays with the LLM, given full context.
Session count per week is negotiated fresh each week, not a fixed constant — athlete and planner agree on count/shape before full session detail is generated.
Safety fallback pattern must be built empirically from this athlete's own history, not generic sports-science thresholds. He trains at HR ~170 as personal normal for years; real failure modes are fueling failures and pre-day alcohol, not HR-ceiling breaches.
Ordinary sessions get descriptive pre/post evaluation (rationale + narrative), not pass/fail. Binary success/fail is reserved for genuinely measurable external milestones (race time, distance milestone).
Tunable per-athlete thresholds (HR-discipline %, EF stop-signal, jump-ratio ceiling, safety pattern) are revised weekly by LLM judgment on accumulating data, stored versioned with rationale — not hardcoded.
4. Known invariant / bug precedent — respect this in every new write path

TrainingPlan.status = "active" must be unique per user. lib/planner/ rollover.ts already archives all active plans before activating a new one (comment: "guards against the synthetic-test multi-active edge case"). /api/plans/import originally didn't follow this and created a second concurrent active plan; /week's findFirst({status:"active"}) had no orderBy, so it non-deterministically served a stale plan. Fixed: import now archives first, in the same transaction; /week query now has orderBy: {startsAt:"desc"} as defense-in-depth.

Rule for Phase 2: any new write path touching TrainingPlan.status (the new generation endpoint especially) must archive-first inside the same transaction. Grep status: "active" before adding a new one.

5. Known open gaps (not blockers, but don't forget them)
/api/plans/import: no check that session dates fall inside declared week range; no DB-level guard against duplicate week import (UI-layer mitigation only — submit disabled while in-flight).
/api/plans/export-context: AvailabilityWindow query doesn't filter by validFrom/validUntil (currently inert, no such data exists yet).
/api/dossier PUT: accepts any JSON shape, not validated against AthleteDossierFacts. This becomes load-bearing in Phase 2 (dossier feeds the plan-generation LLM call directly) — tighten with a zod schema before building the generation endpoint on top of it, not after.
6. Operating conventions (still valid, keep using)
State model + effort per Claude Code prompt: Sonnet+Low for mechanical/schema tasks; Sonnet+Medium for real-logic tasks without architectural judgment; Opus reserved for genuine judgment calls or adversarial review only.
Migration safety pattern (one shared prod DB, no dev/staging):
vercel env pull .env.production.local --environment=production
set -a; source .env.production.local; set +a
pg_dump "$DIRECT_URL" > backup_<name>_$(date +%Y%m%d_%H%M).sql before any migrate deploy
npx prisma migrate dev --create-only fails on shadow DB (pre-existing enable_rls_prisma_migrations migration ALTERs _prisma_migrations itself). Workaround: npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/ <name>/migration.sql — read-only diff, no shadow DB.
Read generated SQL before applying — confirm additive only.
rm .env.production.local after.
.gitignore covers *.sql and test-fixtures/ — never commit FIT files (GPS/home location) or DB dumps.
zsh needs setopt interactive_comments for # during interactive paste (already in ~/.zshrc).
After schema change: npx prisma generate before npx tsc --noEmit, or you get false-positive "property does not exist on PrismaClient" noise.
Audit methodology (from the old self-audit runbook, still valid as a pattern, retarget the content): bounded human-reviewed rounds, never one open-ended /goal loop; isolated beta_audit test user via scripts/add-beta-user.ts; never --bare (skips CLAUDE.md), use --append-system-prompt-file instead. Reuse this shape for the Phase 2 audit pass once the new planner exists — the targets (nutrition regression, Strava mini-chart, settings polish) are dead; the mechanism isn't.
7. CLAUDE.md non-negotiables — unchanged, still binding

No Prisma schema changes / migrations / auth changes without explicit request. No public registration, no billing, no i18n unless asked. No heavy deps. No AI/Strava calls just for layout or on page render. No hardcoded user_maxon / const USER_ID in app/lib/components. Validation before every commit: npx tsc --noEmit, npm run build, both git grep checks, git diff --stat.

Phase 1's schema changes were an explicit, approved, one-time exception — not a standing relaxation.

8. Phase 2 — plan and sequencing (ORIGINAL — see §11 for the revision after real recon)

Step 0 — Recon (read-only). Before touching anything: read the actual current lib/ai/claude-adapter.ts, lib/planner/orchestrator.ts, lib/planner/rollover.ts, lib/planner/goal-guidance.ts, lib/dossier/ types.ts, the current /week "Generate plan" button flow end to end, and the full current schema for TrainingPlan/SessionWorkoutPlan/WeekSummary/ AthleteDossier/TunableDefaults. Report: what the current orchestrator actually does (inputs/outputs), how it diverges from the old rigid-planner description in this brief, and confirm the TrainingPlan.status invariant is still respected everywhere it's touched.

Step 1 — Lock contracts before writing code.

Negotiation request/response schema: proposed N sessions (type, rough duration/intensity, one-line reasoning per session) — explicitly NO full workout detail yet.
Generation request/response: builds on the existing WorkoutPlan contract (blocks with hrRange, rationale, evaluationMode) — confirm/extend it to cover the full inputs (dossier facts + tunables + latest WeekSummary + confirmed session count/constraints + block/phase).
Zod schema for AthleteDossierFacts, wired into the existing PUT /api/dossier before it becomes the generation endpoint's input.

Step 2 — Negotiation endpoint + UI. POST /api/plans/negotiate. UI: a confirm/adjust step before generation (location — /review vs a new step on /week — is an open decision, see §10).

Step 3 — Replace orchestrator.ts/claude-adapter.ts. New generation endpoint, respecting the archive-active-plan invariant (§4) inside the same transaction. Cutover approach (hard replace vs feature flag) — open decision, see §10.

Step 4 — Silent weekly tunable-defaults review. Hooked into the existing lib/planner/rollover.ts week-end trigger: LLM reviews past week's SessionMetrics + WeekSummary, revises HR-discipline/EF-stop/jump-ratio/ safety pattern, writes new versioned TunableDefaults with rationale. No UI beyond maybe a rationale history view later.

Step 5 — Season-block/periodization skeleton. Least defined piece. Blocked on an open decision (§10): is blockPhase set manually by the athlete, or derived from a target race date? Needs that answer before schema/logic design.

9. Status of the old project-knowledge files — what to do with each
File	Verdict	Why
CLAUDE.md	Keep non-negotiables, edit Domain Model section	Recon (§11) confirmed the actual repo CLAUDE.md still describes an MVP-0 world — its "Domain Model Overview" doesn't mention WeekSummary, PlannedFixedSession, AthleteDossier, TunableDefaults, SessionMetrics, Strava, or nutrition models, all of which exist in schema/code. The rules section (no-schema-change, no-auth-change, grep checklist) is still fully valid and untouched — only the descriptive model list is stale.
01_PROJECT_OVERVIEW.md	Edit	Strip/rewrite the daily Nutrition-advice and daily Readiness sections under "Daily use" — both cut from scope. Strava section needs a caveat added: streams are no longer the analytics source of truth, FIT upload is; "sync activities" workflow may still exist for basic linking but shouldn't be described as the analytics path. Everything else (screens, onboarding, Strava attach UI, constraints) still valid.
02_ARCHITECTURE_AND_TECH_STACK.md	Keep, append	Still accurate. Add the Phase 1 models (AthleteDossier, TunableDefaults, SessionMetrics) and the FIT-analytics module to the model/route lists.
03_DEVELOPMENT_HISTORY_TIMELINE.md	Keep as historical record, retire the tail	Sprint history is fine as-is (it happened). Delete the "Current likely next sprint" section at the bottom — it's the pre-pivot nutrition/settings backlog, fully superseded by §8 here.
04_BRANCHES_COMMITS_AND_WORKFLOW.md	Keep as-is	Generic git workflow, still accurate.
05_DESIGN_SYSTEM_AND_UI_SPRINTS.md	Edit	"Today page standard" lists a Daily Readiness card and a generic Nutrition card as expected content — remove Readiness entirely, change Nutrition to "carb-loading calculator, contextual near long runs/races only, not a daily card." Everything else (visual language, motion, primitives, other page standards) still valid.
06_SECURITY_SUPABASE_RLS.md	Keep, append	Still accurate. Note that RLS is now also enabled on the three new Phase 1 tables.
07_CURRENT_STATUS_OPEN_ISSUES.md	Delete entirely	Every open issue in it (nutrition regression, Strava mini-chart, settings polish, nav naming, capitalization) is either resolved, moot, or superseded by the strategic pivot. This file (§8 above) replaces it as "current status."
08_TESTING_AND_DEPLOYMENT_RUNBOOK.md	Edit	Remove the "Nutrition" manual test checklist block (breakfast/lunch/dinner/grams/kcal) — replaced by carb-load-calculator testing once that's built. Remove/adjust the readiness-adjacent parts if any exist implicitly in the daily flow checks. Git/deploy/rollback mechanics stay as-is.
09_PROMPT_LIBRARY_FOR_CLAUDE_CODE.md	Delete the nutrition-regression and settings-polish prompts, keep the rest	The "Standard implementation prompt header," "Merge approved design branch" prompt, and general prompt structure are reusable patterns — keep. The specific Nutrition and Strava-mini-analytics prompts target dead priorities — delete. Settings-polish prompt: keep only if Settings UI work is still wanted independent of the pivot (cosmetic, unrelated to nutrition/readiness) — your call.
10_SELF_AUDIT_LOOP_RUNBOOK.md	Delete the round targets, keep the mechanism as a template	Rounds 1–4 target nutrition/Strava/settings — all dead. The infrastructure (bounded rounds, spend cap discipline, beta_audit isolation, model/effort convention, safety rails) is exactly right and should be kept as a template, retargeted at Phase 2 once there's a new planner to audit. Recommend: gut the round prompts, keep everything from "Environment setup" through "Safety rails," retarget "Round 1–4" to Phase 2 features when you get there.
11_PHASE1_HANDOFF_AND_PHASE2_BRIEF.md	Keep as-is	Source document this file is built from. Still the most detailed version of the philosophy in §3 and the Phase 2 rough shape — this master file summarizes it, doesn't replace it.
12_CURRENT_STATE_AND_PHASE2_MASTER.md (this file)	New, authoritative for "current status"	Add to project knowledge.
10. Open decisions needed from Maksym before Step 1 can be locked
Cutover vs feature flag for replacing orchestrator.ts/claude-adapter.ts — hard replace once the new path is validated, or keep old path behind a flag during transition?
blockPhase source of truth — set manually by the athlete (in dossier or a settings field), or derived from a target race date + periodization logic? Blocks Step 5 entirely until answered.
Negotiation UI placement — new step inserted into the existing /week "Generate plan" flow, or a new card on /review (where the other Phase 1 cards already live)?
11. Recon findings (2026-09-13, from real code) — this revises §8

A real read-only recon pass (PHASE2_RECON_REPORT.md) was run against the actual repo. It changed the picture in ways that matter — §8's sequencing was written without seeing the code and gets some emphasis wrong. This section is the authoritative revision; treat §8 as historical reasoning, not the plan to execute.

11.1 The orchestrator is NOT the "old rigid generic planner" described in §8/brief

It's a rules-engine + LLM hybrid, already doing real work: goal-guidance weighting (deterministic, priority × proximity), injury/fatigue check-in categorization, family-constraint and preference parsing (separate Haiku calls), WeekSummary-based continuity for next-week drafts, deterministic safety-window and volume-cap enforcement on top of LLM output, and a second Claude call for narrative explanation. This is architecturally reasonable. The actual rigidities are narrow and specific, not "replace the whole thing":

Session count is a hardcoded 4–6 prompt-level band, not derived from athlete state or block/phase.
No structured distance/pace/HR-zone fields on planned sessions — that data lives only in a free-text notes string. SessionMetrics (actuals) has real typed fields; planned side doesn't, so planned-vs-actual can't be compared structurally.
SessionIntensity is a 3-value enum (easy/moderate/hard) with no HR/EF target — despite TunableDefaults.hrDisciplinePct/efStopThresholdPct existing in schema specifically to support this, that wiring was never built.
weekHistory (last 4 WeekSummary) only feeds generateNextWeekDraft, never generateWeeklyPlan (same-week replan is blind to multi-week trend). And SessionMetrics per-session physiological data is never rolled up into WeekSummary at all — the one continuity mechanism that exists is one level too coarse.
Two decoupled Claude calls (plan generation, then narrative explanation) with no cross-check between them.

Conclusion: Phase 2 is a set of surgical fixes to a reasonable hybrid, not a rewrite of orchestrator.ts/claude-adapter.ts from scratch. Don't let a new session go in swinging a sledgehammer at files that are mostly fine.

11.2 AthleteDossier and TunableDefaults are dead weight right now
AthleteDossier: CRUD-only via /api/dossier + the /review editor. Zero references from orchestrator.ts or claude-adapter.ts. The premise that "the dossier informs planning" is not yet true in any way — this is net-new wiring, not "confirm/extend an existing contract."
TunableDefaults: zero code references anywhere outside schema.prisma. No reader, no writer, no UI, no seed script. It is a migrated, inert table. This means the "silent weekly tunable-defaults review" (old §8 Step 4) has no bootstrap story yet — there is no first row for any user. That has to be designed explicitly: where do the initial values come from (derived from AthleteDossier.maxHr/lthrEstimate? hardcoded conservative defaults with an honest rationale like "initial defaults, not yet athlete-tuned"?), and who writes that first row.
PUT /api/dossier accepts any JSON with zero runtime validation against AthleteDossierFacts (a compile-time-only TS type). Confirms §5's "tighten before load-bearing" point — now provably true, not a guess.
11.3 Revised Phase 2 sequencing (replaces §8)
CLAUDE.md domain-model fix (trivial, no code risk) — update the stale model list so future Claude Code sessions aren't working from a doc that doesn't mention half the schema. DONE — 999c06d.
Lock contracts, now concretely scoped:
Zod schema for AthleteDossierFacts, wired into PUT /api/dossier.
TunableDefaults bootstrap strategy: initial-value source + who creates the first row + required rationale text for that first write.
Structured session-output schema: add typed distanceKm/paceTarget/ targetHrZone (or similar) fields to PlannedSession/submit_plan, replacing (or supplementing, short-term) the free-text notes field. This is the single highest-leverage change — it's what makes planned vs. SessionMetrics actuals comparable at all.
DONE — 440d174, 7ea4a67, ed995f9.
Wire the two dead tables into the planner: read AthleteDossier.facts and current TunableDefaults into PlanningContext for both generateWeeklyPlan and generateNextWeekDraft. This didn't exist before — it's new plumbing, not an extension. DONE — 440d174, 7ea4a67, 76e9794, acc264c.
Deepen continuity: extend weekHistory to generateWeeklyPlan (not just drafts), and roll SessionMetrics (EF, decoupling, zone share trend) into persistWeekSummary in rollover.ts so the LLM sees real physiological trend, not just adherence counts. DONE — 51f7941, e2acfc4, 7993ace, 56c3dba, 08130d4.
Silent weekly TunableDefaults review — hook into the same persistWeekSummary path in rollover.ts, now that there's a bootstrap story (from step 2) and real trend data to revise against (from step 4). DONE — 54e6e9f, f2ccf16, 7897d29.
Re-open the negotiation-step question. The app currently does one-shot full generation (button → complete plan, no confirm step) with a rules layer already catching safety issues. Before building a negotiation UI: decide whether that's still wanted now that the underlying output is about to get much richer/more personalized, or whether it's lower priority than getting steps 1–5 right first. This is your call, not a technical one. DONE — decided: no negotiation step, one-shot generation stays as-is.
Season-block skeleton — before designing anything new, check whether TrainingPlan.blockLabel/.blockPhase are actually populated by any current write path (recon didn't confirm this either way), and whether goal-guidance.ts's existing per-goal phase (base/build/taper) computation can just be aggregated into a plan-level block/phase instead of inventing new logic from scratch. DONE — 7001edf, b0cb02d.

11.3.1 Phase 2 status: COMPLETE (2026-09-14)

1. CLAUDE.md domain-model fix — 999c06d.
2. Lock contracts (Zod schema for AthleteDossierFacts, structured session-output schema) — 440d174, 7ea4a67, ed995f9.
3. Wire AthleteDossier/TunableDefaults into the planner — 440d174, 7ea4a67, 76e9794, acc264c.
4. Deepen continuity (weekHistory in generateWeeklyPlan, SessionMetrics rolled into WeekSummary) — 51f7941, e2acfc4, 7993ace, 56c3dba, 08130d4.
5. Silent weekly TunableDefaults review — 54e6e9f, f2ccf16, 7897d29.
6. Negotiation-step question re-opened and closed (decision: no negotiation step) — no code change.
7. Season-block skeleton — 7001edf, b0cb02d.

11.4 Process note

The recon agent could not find this file or 11_PHASE1_HANDOFF_AND_PHASE2_BRIEF.md anywhere in the repo — there was no docs/audit/ directory at all. These files were only ever placed in Claude.ai project knowledge / chat outputs, never copied into the actual git repo where local Claude Code looks for them. Fix: create docs/audit/ in the real repo and put both files there (see chat for the concrete next prompt) before running any further Claude Code sessions that reference them by path.
