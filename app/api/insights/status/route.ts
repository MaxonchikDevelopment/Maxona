import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

// Lightweight poll target for client-side "is the AI insight ready yet" checks.
// Deliberately ignores inputHash — callers only care whether *some* payload now
// exists for this kind+scopeKey; a stale hash still means the page has content
// to show, and the next full navigation will recompute if inputs changed.
const ALLOWED_KINDS = new Set(["daily-nutrition", "weekly-nutrition"]);

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const scopeKey = searchParams.get("scopeKey");
  if (!kind || !scopeKey || !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "valid kind and scopeKey required" }, { status: 400 });
  }

  const cached = await prisma.aiInsightCache.findUnique({
    where: { userId_kind_scopeKey: { userId, kind, scopeKey } },
  });

  return NextResponse.json({ payload: cached?.payload ?? null });
}
