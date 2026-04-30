-- Enable RLS on Prisma's internal migration-tracking table.
-- Prisma connects as the superuser role which bypasses RLS, so migration
-- tracking continues to work. This blocks anon/authenticated PostgREST access.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
