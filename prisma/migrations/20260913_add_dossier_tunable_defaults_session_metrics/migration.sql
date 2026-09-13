-- AlterTable
ALTER TABLE "SessionWorkoutPlan" ADD COLUMN     "evaluationMode" TEXT,
ADD COLUMN     "rationale" TEXT;

-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "blockLabel" TEXT,
ADD COLUMN     "blockPhase" TEXT;

-- AlterTable
ALTER TABLE "WeekSummary" ADD COLUMN     "narrativeMd" TEXT;

-- CreateTable
CREATE TABLE "AthleteDossier" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "facts" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthleteDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TunableDefaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hrDisciplinePct" DOUBLE PRECISION,
    "efStopThresholdPct" DOUBLE PRECISION,
    "jumpRatioCeiling" DOUBLE PRECISION,
    "safetyPattern" JSONB,
    "rationale" TEXT NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TunableDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionMetrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "movingTimeSec" INTEGER NOT NULL,
    "elapsedTimeSec" INTEGER NOT NULL,
    "pauses" JSONB NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "avgHr" DOUBLE PRECISION,
    "efWhole" DOUBLE PRECISION,
    "efFirstHalf" DOUBLE PRECISION,
    "efSecondHalf" DOUBLE PRECISION,
    "decouplingPct" DOUBLE PRECISION,
    "decouplingValid" BOOLEAN NOT NULL DEFAULT false,
    "zoneShare" JSONB,
    "cadenceSpm" DOUBLE PRECISION,
    "powerAvg" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AthleteDossier_userId_key" ON "AthleteDossier"("userId");

-- CreateIndex
CREATE INDEX "TunableDefaults_userId_revisedAt_idx" ON "TunableDefaults"("userId", "revisedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMetrics_sessionId_key" ON "SessionMetrics"("sessionId");

-- AddForeignKey
ALTER TABLE "AthleteDossier" ADD CONSTRAINT "AthleteDossier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunableDefaults" ADD CONSTRAINT "TunableDefaults_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMetrics" ADD CONSTRAINT "SessionMetrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

