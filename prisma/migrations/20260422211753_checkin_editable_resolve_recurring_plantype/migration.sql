/*
  Warnings:

  - Added the required column `updatedAt` to the `CheckIn` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable: add resolvedAt nullable, updatedAt with default for existing rows
ALTER TABLE "CheckIn" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "CheckIn" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "CheckIn" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RecurringSession" ADD COLUMN "planningType" "SessionPlanningType" NOT NULL DEFAULT 'fixed';
