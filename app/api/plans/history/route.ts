import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

type SignalsJson = {
  lowReadinessDays?: number;
  fatigueDays?: number;
  injuryDays?: number;
  unresolvedIssues?: number;
  mainLimiter?: string | null;
};

type KeySessionJson = {
  date: string;
  label: string;
  intensity: string;
  status: string;
  feelScore: number | null;
  quality: string | null;
};

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.weekSummary.findMany({
    where: { userId },
    orderBy: { weekStart: "desc" },
    take: 12,
  });

  return NextResponse.json({
    weeks: rows.map((w) => {
      const signals = (w.signals ?? {}) as SignalsJson;
      return {
        weekStart: w.weekStart.toISOString().split("T")[0],
        weekEnd: w.weekEnd.toISOString().split("T")[0],
        planned: w.planned,
        done: w.done,
        skipped: w.skipped,
        plannedDurationMin: w.plannedDurationMin,
        actualMovingMin: w.actualMovingMin,
        adherenceByCount: w.adherenceByCount,
        hardPlanned: w.hardPlanned,
        hardDone: w.hardDone,
        avgFeelScore: w.avgFeelScore,
        mainLimiter: signals.mainLimiter ?? null,
        carryForward: w.carryForward,
        keySessions: (w.keySessions ?? []) as KeySessionJson[],
        narrative: w.narrative,
      };
    }),
  });
}
