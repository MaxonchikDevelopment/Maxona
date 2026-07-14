import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import { generateReplaceSuggestions } from "@/lib/ai/replace-advice";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({ where: { id, userId } });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [readiness, recentSessions] = await Promise.all([
    prisma.dailyReadiness.findUnique({
      where: { userId_date: { userId, date: session.scheduledDate } },
    }),
    prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { lt: session.scheduledDate }, status: { in: ["done", "skipped"] } },
      include: { checkIn: true },
      orderBy: { scheduledDate: "desc" },
      take: 5,
    }),
  ]);

  const alternatives = await generateReplaceSuggestions({
    plannedSession: { intensity: session.intensity, durationMin: session.durationMin, notes: session.notes },
    readiness: readiness
      ? { feelScore: readiness.feelScore, category: readiness.category, notes: readiness.notes }
      : null,
    recentSessions: recentSessions.map((s) => ({
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity,
      notes: s.notes,
      feelScore: s.checkIn?.feelScore,
    })),
  });

  return NextResponse.json({ alternatives });
}
