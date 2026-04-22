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
- Manual schedule constraints via ScheduleEvent
- Goal creation and soft-delete; multiple active goals supported simultaneously
- AI-generated weekly training plan (ClaudeAdapter only)
- Manual check-in after sessions
- Manual replan trigger (no cron)
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
  Versioned via `revision: Int`, `parentPlanId: String?`, `replanReason: String?`
- **TrainingPlanGoal** join model snapshots which goals were active at generation/replan time
- **TrainingSession** scheduled by `scheduledDate: DateTime @db.Date` + `preferredSlot: TimeSlot`
  (not minute-precise); `planningType: fixed | preferred | generated`
- **Prisma enums** for all fixed value sets (no bare String for types/statuses)
- **Soft delete on Goal** via `deletedAt: DateTime?`
- **User.constraints** JSON includes `maxContinuousTrainingMinutes: number` (dog constraint: 240)

## Domain Model Overview

    User
      AvailabilityWindow    (recurring time slots by day-of-week)
      ScheduleEvent         (one-off temporal blocks: manual, household, travel)
      Goal                  (soft-deletable; multiple active allowed)
      TrainingPlan          (user-level weekly plan; one active at a time)
        TrainingPlanGoal    (join: snapshot of active goals at generation time)
        TrainingSession     (scheduled by date + slot; fixed | preferred | generated)
      CheckIn               (always linked to a TrainingSession)

## MVP-0 Planning Model

- Main output: one coherent plan covering the next 7 days
- Morning UX: user sees the ready updated plan
- Planner receives all active Goals as input and decides weekly training focus
- Focus explanation stored in `TrainingPlan.focusSummary` (brief, plan-level)
- No per-goal deep diff or structured attribution in MVP-0

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

## Extensibility Points (Designed In, Not Implemented)

- `AIAdapter` interface → add OpenAIAdapter later without touching orchestrator
- `ScheduleEvent.source` enum → add `google_calendar` without schema change
- `AvailabilityWindow.validFrom/validUntil` → seasonal schedule changes
- `User.constraints` JSON → extend without migration for new soft constraints
- `TrainingSession.planningType` → fixed sessions survive replans without changes

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
