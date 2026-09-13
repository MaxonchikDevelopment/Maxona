-- Enable RLS (consistent with other tables) on the tables added by the
-- Review & Plan Overhaul WeekSummary/PlannedFixedSession migration.
ALTER TABLE "WeekSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlannedFixedSession" ENABLE ROW LEVEL SECURITY;
