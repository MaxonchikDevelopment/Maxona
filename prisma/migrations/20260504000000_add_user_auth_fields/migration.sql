-- Phase A: add auth fields to User for multi-account support
-- login and passwordHash are nullable so existing rows are not broken.
-- isActive and preferredLanguage have defaults and are safe to add as NOT NULL.

ALTER TABLE "User" ADD COLUMN "login" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- Unique index for login (nullable — SQL standard allows multiple NULLs in a unique index)
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
