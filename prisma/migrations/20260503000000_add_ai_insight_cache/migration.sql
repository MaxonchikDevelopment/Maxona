-- CreateTable
CREATE TABLE "AiInsightCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInsightCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInsightCache_userId_kind_idx" ON "AiInsightCache"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsightCache_userId_kind_scopeKey_key" ON "AiInsightCache"("userId", "kind", "scopeKey");

-- AddForeignKey
ALTER TABLE "AiInsightCache" ADD CONSTRAINT "AiInsightCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS (consistent with other tables)
ALTER TABLE "AiInsightCache" ENABLE ROW LEVEL SECURITY;
