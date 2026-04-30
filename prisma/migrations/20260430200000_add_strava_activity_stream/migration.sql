-- CreateTable
CREATE TABLE "StravaActivityStream" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "time" JSONB,
    "heartrate" JSONB,
    "distance" JSONB,
    "velocitySmooth" JSONB,
    "altitude" JSONB,
    "cadence" JSONB,
    "watts" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaActivityStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaActivityStream_stravaActivityId_key" ON "StravaActivityStream"("stravaActivityId");

-- CreateIndex
CREATE INDEX "StravaActivityStream_userId_idx" ON "StravaActivityStream"("userId");

-- AddForeignKey
ALTER TABLE "StravaActivityStream" ADD CONSTRAINT "StravaActivityStream_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaActivityStream" ADD CONSTRAINT "StravaActivityStream_stravaActivityId_fkey" FOREIGN KEY ("stravaActivityId") REFERENCES "StravaActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable Row Level Security (no permissive policies — anon/authenticated roles denied by default)
ALTER TABLE "StravaActivityStream" ENABLE ROW LEVEL SECURITY;
