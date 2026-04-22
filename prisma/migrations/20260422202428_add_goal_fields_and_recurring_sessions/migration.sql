-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "priority" INTEGER,
ADD COLUMN     "targetDate" DATE;

-- CreateTable
CREATE TABLE "RecurringSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "preferredSlot" "TimeSlot" NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "intensity" "SessionIntensity" NOT NULL DEFAULT 'moderate',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RecurringSession" ADD CONSTRAINT "RecurringSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
