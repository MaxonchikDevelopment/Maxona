-- CreateTable
CREATE TABLE "DailyReadiness" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "feelScore" INTEGER NOT NULL,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL,
    "coachAdvice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReadiness_userId_date_key" ON "DailyReadiness"("userId", "date");

-- AddForeignKey
ALTER TABLE "DailyReadiness" ADD CONSTRAINT "DailyReadiness_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
