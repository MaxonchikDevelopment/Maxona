-- Enable Row Level Security on all application tables in the public schema.
--
-- Why: The Supabase anon key (published in the JS client) can reach any table
-- that has RLS disabled. Enabling RLS with no permissive policies means the
-- anon and authenticated roles are denied by default.
--
-- Prisma connects via DATABASE_URL as the postgres (superuser/table-owner)
-- role, which bypasses RLS entirely. No application behaviour changes.
--
-- No policies are intentionally added: this app has no Supabase client-side
-- access and the anon/authenticated roles must never read or write app data.

ALTER TABLE "User"                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityWindow"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleEvent"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal"                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringSession"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlan"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlanGoal"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSession"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckIn"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyReadiness"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StravaConnection"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StravaActivity"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionStravaActivityLink"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StravaWebhookEvent"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionWorkoutPlan"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserTrainingProfile"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HybridRaceProfile"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionWorkoutFeedback"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NutritionProfile"           ENABLE ROW LEVEL SECURITY;
