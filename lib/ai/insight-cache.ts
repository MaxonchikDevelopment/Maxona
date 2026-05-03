import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";

export function hashInputs(data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

export async function getCachedInsight<T>(params: {
  userId: string;
  kind: string;
  scopeKey: string;
  inputHash: string;
}): Promise<T | null> {
  try {
    const cached = await prisma.aiInsightCache.findUnique({
      where: {
        userId_kind_scopeKey: {
          userId: params.userId,
          kind: params.kind,
          scopeKey: params.scopeKey,
        },
      },
    });
    if (!cached) {
      if (process.env.NODE_ENV !== "production")
        console.log(`[cache] ${params.kind} miss (no record) scope=${params.scopeKey}`);
      return null;
    }
    if (cached.inputHash !== params.inputHash) {
      if (process.env.NODE_ENV !== "production")
        console.log(`[cache] ${params.kind} miss (hash mismatch) scope=${params.scopeKey} stored=${cached.inputHash.slice(0,8)} want=${params.inputHash.slice(0,8)}`);
      return null;
    }
    if (process.env.NODE_ENV !== "production")
      console.log(`[cache] ${params.kind} hit scope=${params.scopeKey}`);
    return cached.payload as T;
  } catch {
    return null;
  }
}

export async function setCachedInsight(params: {
  userId: string;
  kind: string;
  scopeKey: string;
  inputHash: string;
  payload: unknown;
}): Promise<void> {
  try {
    await prisma.aiInsightCache.upsert({
      where: {
        userId_kind_scopeKey: {
          userId: params.userId,
          kind: params.kind,
          scopeKey: params.scopeKey,
        },
      },
      create: {
        userId: params.userId,
        kind: params.kind,
        scopeKey: params.scopeKey,
        inputHash: params.inputHash,
        payload: params.payload as Prisma.InputJsonValue,
      },
      update: {
        inputHash: params.inputHash,
        payload: params.payload as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[insight-cache] write failed:", err);
    }
  }
}
