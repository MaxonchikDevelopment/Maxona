-- CreateTable
CREATE TABLE "SessionWorkoutPlan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "target" TEXT,
    "blocks" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "alternatives" JSONB,
    "summary" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionWorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrainingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restingHr" INTEGER,
    "maxHr" INTEGER,
    "easyHrMin" INTEGER,
    "easyHrMax" INTEGER,
    "tempoHrMin" INTEGER,
    "tempoHrMax" INTEGER,
    "thresholdHr" INTEGER,
    "zoneMethod" TEXT NOT NULL DEFAULT 'estimated',
    "zonesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrainingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HybridRaceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultFormat" TEXT NOT NULL DEFAULT 'station_circuit',
    "includesRunningDefault" BOOLEAN NOT NULL DEFAULT false,
    "stationWorkSec" INTEGER NOT NULL DEFAULT 60,
    "stationRestSec" INTEGER NOT NULL DEFAULT 20,
    "defaultRounds" INTEGER NOT NULL DEFAULT 3,
    "availableEquipmentJson" JSONB,
    "stationBenchmarksJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HybridRaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionWorkoutPlan_sessionId_key" ON "SessionWorkoutPlan"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTrainingProfile_userId_key" ON "UserTrainingProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HybridRaceProfile_userId_key" ON "HybridRaceProfile"("userId");

-- AddForeignKey
ALTER TABLE "SessionWorkoutPlan" ADD CONSTRAINT "SessionWorkoutPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionWorkoutPlan" ADD CONSTRAINT "SessionWorkoutPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrainingProfile" ADD CONSTRAINT "UserTrainingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HybridRaceProfile" ADD CONSTRAINT "HybridRaceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
