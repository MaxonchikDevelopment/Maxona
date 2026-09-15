import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const revisions = await prisma.tunableDefaults.findMany({
    where: { userId },
    orderBy: { revisedAt: "desc" },
    take: 100,
    select: {
      id: true,
      hrDisciplinePct: true,
      efStopThresholdPct: true,
      jumpRatioCeiling: true,
      safetyPattern: true,
      rationale: true,
      revisedAt: true,
    },
  });

  return NextResponse.json({ revisions });
}
