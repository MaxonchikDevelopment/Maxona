-- CreateEnum
CREATE TYPE "SessionModality" AS ENUM ('hyrox', 'running', 'cycling', 'swimming');

-- CreateTable
CREATE TABLE "WeekSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "planned" INTEGER NOT NULL,
    "done" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "plannedDurationMin" INTEGER NOT NULL,
    "actualMovingMin" INTEGER,
    "adherenceByCount" INTEGER NOT NULL,
    "adherenceByDuration" INTEGER,
    "hardPlanned" INTEGER NOT NULL,
    "hardDone" INTEGER NOT NULL,
    "avgFeelScore" DOUBLE PRECISION,
    "executionQuality" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "keySessions" JSONB NOT NULL,
    "carryForward" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recoveryScore" INTEGER,
    "reviewNotes" TEXT,
    "narrative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeekSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedFixedSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "preferredSlot" "TimeSlot" NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "intensity" "SessionIntensity" NOT NULL DEFAULT 'moderate',
    "modality" "SessionModality" NOT NULL,
    "notes" TEXT,
    "consumedByPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedFixedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeekSummary_userId_weekStart_idx" ON "WeekSummary"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeekSummary_userId_weekStart_key" ON "WeekSummary"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "PlannedFixedSession_userId_scheduledDate_idx" ON "PlannedFixedSession"("userId", "scheduledDate");

-- AddForeignKey
ALTER TABLE "WeekSummary" ADD CONSTRAINT "WeekSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedFixedSession" ADD CONSTRAINT "PlannedFixedSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

