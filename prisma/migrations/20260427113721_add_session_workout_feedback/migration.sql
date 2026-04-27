-- CreateTable
CREATE TABLE "SessionWorkoutFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adherenceLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "bullets" JSONB NOT NULL,
    "nextAdjustment" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionWorkoutFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionWorkoutFeedback_sessionId_key" ON "SessionWorkoutFeedback"("sessionId");

-- AddForeignKey
ALTER TABLE "SessionWorkoutFeedback" ADD CONSTRAINT "SessionWorkoutFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionWorkoutFeedback" ADD CONSTRAINT "SessionWorkoutFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
