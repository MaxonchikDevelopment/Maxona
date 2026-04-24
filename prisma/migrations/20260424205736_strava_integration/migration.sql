-- CreateTable
CREATE TABLE "StravaConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaAthleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "stravaAthleteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movingTime" INTEGER NOT NULL DEFAULT 0,
    "elapsedTime" INTEGER NOT NULL DEFAULT 0,
    "totalElevationGain" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageHeartrate" DOUBLE PRECISION,
    "maxHeartrate" DOUBLE PRECISION,
    "averageSpeed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxSpeed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calories" DOUBLE PRECISION,
    "description" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStravaActivityLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionStravaActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaWebhookEvent" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "aspectType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StravaWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_userId_key" ON "StravaConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaActivity_stravaActivityId_key" ON "StravaActivity"("stravaActivityId");

-- CreateIndex
CREATE INDEX "StravaActivity_userId_startDate_idx" ON "StravaActivity"("userId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStravaActivityLink_sessionId_stravaActivityId_key" ON "SessionStravaActivityLink"("sessionId", "stravaActivityId");

-- AddForeignKey
ALTER TABLE "StravaConnection" ADD CONSTRAINT "StravaConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaActivity" ADD CONSTRAINT "StravaActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStravaActivityLink" ADD CONSTRAINT "SessionStravaActivityLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStravaActivityLink" ADD CONSTRAINT "SessionStravaActivityLink_stravaActivityId_fkey" FOREIGN KEY ("stravaActivityId") REFERENCES "StravaActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
