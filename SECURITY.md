# Security Notes — Maxona MVP

## Database Access Model

All database access goes through **Prisma ORM on the server side only**.

- Prisma connects via `DATABASE_URL` / `DIRECT_URL` as the `postgres` role (superuser / table owner).
- No Supabase JavaScript client (`@supabase/supabase-js`) is used anywhere in the application.
- No browser-side database queries. No `anon` key usage. No `authenticated` role usage.
- The Supabase anon key is not present in the frontend bundle.

## Row-Level Security

RLS is **enabled on all 20 application tables** in the `public` schema. The first 19 were enabled
in migration `20260430000000_enable_rls_on_all_tables`; `StravaActivityStream` was added in
`20260430200000_add_strava_activity_stream`.

**Tables protected:**

| Table | RLS |
|---|---|
| `User` | ✓ enabled |
| `AvailabilityWindow` | ✓ enabled |
| `ScheduleEvent` | ✓ enabled |
| `Goal` | ✓ enabled |
| `RecurringSession` | ✓ enabled |
| `TrainingPlan` | ✓ enabled |
| `TrainingPlanGoal` | ✓ enabled |
| `TrainingSession` | ✓ enabled |
| `CheckIn` | ✓ enabled |
| `DailyReadiness` | ✓ enabled |
| `StravaConnection` | ✓ enabled |
| `StravaActivity` | ✓ enabled |
| `SessionStravaActivityLink` | ✓ enabled |
| `StravaWebhookEvent` | ✓ enabled |
| `SessionWorkoutPlan` | ✓ enabled |
| `UserTrainingProfile` | ✓ enabled |
| `HybridRaceProfile` | ✓ enabled |
| `SessionWorkoutFeedback` | ✓ enabled |
| `NutritionProfile` | ✓ enabled |
| `StravaActivityStream` | ✓ enabled |

**No permissive policies are defined.** This is intentional: the `anon` and
`authenticated` Supabase roles must have zero access to application data.

**Prisma is unaffected.** The `postgres` role is a superuser and bypasses RLS.
Enabling RLS without `FORCE ROW LEVEL SECURITY` does not restrict superuser access.

## What This Protects Against

- Direct Supabase REST API or GraphQL queries using the project URL + anon key
  can no longer read, insert, update, or delete any row in any table.
- Even if the anon key leaks, the data remains inaccessible.

## What to Verify in the Supabase Dashboard

1. Go to **Authentication → Policies** (or **Table Editor → [table] → RLS**).
2. Confirm every table listed above shows "RLS enabled".
3. Confirm there are **no policies** on any of these tables.
4. In **Security Advisor**, the `rls_disabled_in_public` warning should be gone.
5. Run a test query in the **SQL Editor** as the `anon` role:
   ```sql
   SET ROLE anon;
   SELECT * FROM "User";
   -- Expected: 0 rows (not an error, but empty — RLS blocks silently)
   ```

## Application Auth

- Cookie-based session auth protected by Next.js middleware.
- Session cookie stores an HMAC-SHA256 derived token, not the raw password.
- All API routes are behind middleware; no public API surface for data endpoints.
- The Strava OAuth callback validates a `state` cookie to prevent CSRF.

## Private Beta User Model

Maxona supports a small number of manually provisioned beta users. There is no public
registration, OAuth, or self-service account creation.

**Password storage:**
- Passwords are hashed with `bcryptjs`, cost factor 12.
- The plain password is never stored, logged, or printed by any script.
- `passwordHash` is never included in any script output or API response.

**User isolation (application layer):**
- Every Prisma query for user-owned data includes a `userId` filter derived from the
  verified session token. This is the primary isolation mechanism.
- A beta user's session cookie contains only their own `userId`; they cannot access
  another user's data through any application route.

**User isolation (database layer):**
- RLS is enabled on all tables (see above) as defense-in-depth against direct
  Supabase API access. This is **not** the main isolation layer for Prisma queries,
  which run as the `postgres` superuser and bypass RLS. RLS protects against the
  Supabase `anon`/`authenticated` roles only.

**Owner-managed provisioning:**
- New accounts are created via `scripts/add-beta-user.ts` by the owner.
- Deactivation via `scripts/deactivate-user.ts` sets `isActive = false`;
  the login route rejects inactive users.
- Data is never deleted on deactivation.

## Supabase Anon/Public Key Policy

- The Supabase anon key **must not** be added to any client component or frontend bundle.
- The Supabase service role key **must not** be used in application code — Prisma handles all DB access.
- If a Supabase client is ever needed in a future feature, it must:
  1. Use the service role key **server-side only**
  2. Have explicit RLS policies scoped to the correct user
  3. Be reviewed for data leakage before deployment
