# Maxona — CLAUDE.md

## Project Summary

Personal adaptive sports assistant. Single-user MVP-0. Combines training planning,
recovery awareness, and life constraints (household, schedule, dog) into a weekly
training plan generated and adjusted by an LLM.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS + shadcn/ui, Prisma ORM,
Supabase (PostgreSQL), TanStack Query, Anthropic Claude API, deployed on Vercel.

## MVP-0 Scope

- Middleware password auth (env var + httpOnly cookie) — temporary, not production
- Single seeded User in DB
- Manual schedule constraints via ScheduleEvent (CRUD UI + API implemented)
- Goal creation and soft-delete; multiple active goals supported simultaneously
- Goal fields: title, description, discipline, targetDate, priority
- AI-generated weekly training plan (ClaudeAdapter only)
- Manual check-in after sessions
- Manual replan trigger (no cron)
- Editable Settings: training constraints, availability windows, schedule blocks,
  fixed recurring sessions — all have live CRUD UI
- Mobile-first layout with bottom nav
- Pages: Today view, Week view, Goals, Settings

## Explicitly Out of Scope (MVP-0)

- Google Calendar / Strava / Garmin integrations
- OpenAI or any second AI provider
- Vercel Cron / automated nightly replan
- PWA / service worker
- Multi-user or proper auth (OAuth, JWT)
- Nutrition tracking
- Wife schedule sync (manual ScheduleEvent only)
- Notifications / push
- Per-session goal attribution
- Editable check-ins after the fact
- Weekly review / coach summary layer

## Architecture Decisions (Accepted — Do Not Revisit Without Explicit Request)

- **User table** with userId on every related model — not a singleton pattern
- **AIAdapter interface** in `lib/ai/adapter.ts`; only `ClaudeAdapter` implemented in MVP-0
- **Rules Engine + LLM hybrid**: deterministic rules run first, LLM for reasoning
- **ScheduleEvent** replaces BlockedDay — unified table for all temporal blocks
  (kind: blocked | household | calendar_busy | travel;
   source: manual | google_calendar | wife_schedule | derived)
- **AvailabilityWindow** stores `timeStartMin / timeEndMin` as `Int` (0–1439 minutes)
  with optional `validFrom / validUntil` for seasonal windows
- **User.timezone** is IANA string (e.g. "Europe/Warsaw"); all datetimes stored UTC
- **TrainingPlan is user-level**, not goal-owned. One active plan per user at a time.
  Versioned via `revision: Int`, `parentPlanId: String?`, `replanReason: String?`,
  `changeExplanation: String?` (Claude is instructed to populate this on replan)
- **TrainingPlanGoal** join model snapshots which goals were active at generation/replan time
- **TrainingSession** scheduled by `scheduledDate: DateTime @db.Date` + `preferredSlot: TimeSlot`
  (not minute-precise); `planningType: fixed | preferred | generated`
- **RecurringSession** model stores user-defined weekly fixed sessions (e.g. HYROX group class).
  Orchestrator converts them to concrete dates each week and passes them to the planner as
  `fixedSessions`; system prompt instructs Claude to include them with `planningType: fixed`
- **Prisma enums** for all fixed value sets (no bare String for types/statuses)
- **Soft delete on Goal** via `deletedAt: DateTime?`
- **User.constraints** JSON — current keys: `maxContinuousTrainingMinutes` (int),
  `weeklyTrainingHoursTarget` (int, optional), `allowedModalities` (string[], optional)

## Domain Model Overview

    User
      AvailabilityWindow    (recurring time slots by day-of-week; CRUD via UI)
      ScheduleEvent         (one-off temporal blocks: manual, household, travel; CRUD via UI)
      RecurringSession      (weekly fixed sessions, e.g. HYROX class; CRUD via UI)
      Goal                  (soft-deletable; discipline, targetDate, priority fields)
      TrainingPlan          (user-level weekly plan; one active at a time)
        TrainingPlanGoal    (join: snapshot of active goals at generation time)
        TrainingSession     (scheduled by date + slot; fixed | preferred | generated)
      CheckIn               (always linked to a TrainingSession)

## MVP-0 Planning Model

- Main output: one coherent plan covering the next 7 days
- Morning UX: user sees the ready updated plan
- Planner receives all active Goals (with discipline/targetDate/priority) and decides weekly focus
- Focus explanation stored in `TrainingPlan.focusSummary` (brief, plan-level)
- No per-goal deep diff or structured attribution in MVP-0

### Planner inputs (assembled in orchestrator, sent to Claude)

1. `thisWeekCheckIns` — current-week check-ins; system prompt tells Claude to treat these as
   the highest-priority signal before scheduling anything
2. `fixedSessions` — derived from RecurringSession rows; system prompt instructs Claude to
   include them unchanged with `planningType: fixed`
3. `currentWeekDoneSessions` — already-completed/skipped sessions; carried into the new plan
   unchanged by orchestrator code (not Claude's decision)
4. `availabilityWindows` — user-defined recurring time slots
5. `scheduleEvents` — one-off blocks for the week
6. `recentCheckIns` — previous-week check-ins (baseline load signal)
7. `user.constraints` — `maxContinuousTrainingMinutes`, `weeklyTrainingHoursTarget`,
   `allowedModalities`
8. `goals` — active goals with discipline, targetDate, priority

### Replan semantics

- Done/skipped sessions are carried into the new plan unchanged — enforced in orchestrator code
- The system prompt instructs Claude to avoid hard sessions for 2 days after an injury-flagged
  check-in, and to reduce remaining volume when multiple low feel scores appear this week;
  these are prompt-level guidelines, not enforced by the rules engine

## MVP-0 Rules Engine

Four deterministic rules, applied before any LLM call:

- `NoWorkoutOnConflictingScheduleEventRule`
- `NoWorkoutOutsideAvailabilityRule`
- `MinRestBetweenHardSessionsRule` — 48 h minimum between hard sessions
- `MaxWeeklyVolumeIncreaseRule` — max +10% week-over-week

Wednesday office behavior is represented via a seeded `AvailabilityWindow` row
(reduced slots for `DayOfWeek.wed`), not as a separate rule.

## Key Constraints to Respect in Planning Logic

- Dog cannot be alone > 4 h → `maxContinuousTrainingMinutes: 240`
- Wife's variable weekly schedule blocks certain windows → ScheduleEvent (manual in MVP-0)
- Joint family time must not be consumed by training → respect household ScheduleEvents
- Wednesday = office day → seeded AvailabilityWindow with reduced slots

## Current Bottleneck (next session focus)

Infrastructure and planning loop are solid. The next gap is **personalization and feedback quality**:

- No editable check-ins — user cannot correct or annotate a past check-in
- No weekly review / coach summary — no surface that reflects on past-week load or trend
- Athlete profile is shallow — no resting HR, HRV, injury history, race calendar
- Goals lack milestone structure — no sub-goals or progress markers
- No way to mark a session as "not done because of X" with a structured reason

## Extensibility Points (Designed In, Not Implemented)

- `AIAdapter` interface → add OpenAIAdapter later without touching orchestrator
- `ScheduleEvent.source` enum → add `google_calendar` without schema change
- `AvailabilityWindow.validFrom/validUntil` → seasonal schedule changes
- `User.constraints` JSON → extend without migration for new soft constraints
- `TrainingSession.planningType` → fixed sessions survive replans without changes
- `RecurringSession.isActive` → soft-disable without deletion

## Working Rules

- Use short answers by default
- Prefer bullets over long prose
- Avoid repeating already accepted context
- Separate planning, schema, and implementation into distinct steps
- Be concise; no over-engineering
- Plan first, code second
- Do not add integrations unless explicitly requested
- Do not add comments unless the WHY is non-obvious
- Use Prisma enums, not bare String fields for fixed value sets
- Mobile-first: test on 375 px viewport first

## Session Workflow

- For any non-trivial task: propose a short plan first, wait for approval
- Do not generate code without explicit go-ahead
- Keep answers short unless more detail is requested
- When schema changes are needed: show diff first, confirm, then migrate
- After a successful implementation pass: create a git commit
- Do not assume a GitHub remote exists; never push blindly
- If a push is needed and no remote is configured, report the exact setup commands
  (`git remote add origin <url>` and `git push -u origin main`) instead of running them

## Deployment Checklist (pre-hosting)

Before deploying to production:
- Rotate all secrets: ANTHROPIC_API_KEY, AUTH_PASSWORD, STRAVA_CLIENT_SECRET
- Set NEXT_PUBLIC_APP_URL to the deployed domain
- Update the Strava app callback URL in Strava developer settings
- Use production secret management (env vars injected by the host, not committed files)
- Tokens are DB-only — never put Strava access/refresh tokens in env vars
- env should contain only: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
  STRAVA_WEBHOOK_VERIFY_TOKEN, NEXT_PUBLIC_APP_URL, DATABASE_URL,
  DIRECT_URL, ANTHROPIC_API_KEY, AUTH_PASSWORD
- `lastSyncedAt` throttles Strava sync to ≤ 1×/hour; a hosted cron route
  `/api/cron/strava-sync` can call `syncStravaActivities(userId)` directly
