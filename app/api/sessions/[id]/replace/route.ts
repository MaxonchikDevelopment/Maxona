import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import { generateReplaceSanityCheck } from "@/lib/ai/replace-advice";
import { buildReplacedNotes } from "@/lib/replace-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { description, reason } = await request.json();

  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (description.length > 300) {
    return NextResponse.json({ error: "description too long (max 300 chars)" }, { status: 400 });
  }
  if (typeof reason === "string" && reason.length > 300) {
    return NextResponse.json({ error: "reason too long (max 300 chars)" }, { status: 400 });
  }

  const session = await prisma.trainingSession.findFirst({ where: { id, userId } });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.status !== "planned") {
    return NextResponse.json({ id: session.id, status: session.status, notes: session.notes });
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

  const trimmedDescription = description.trim();
  const trimmedReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;

  const aiResponse = await generateReplaceSanityCheck({
    plannedSession: { intensity: session.intensity, durationMin: session.durationMin, notes: session.notes },
    replacementDescription: trimmedDescription,
    reason: trimmedReason,
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

  const notes = buildReplacedNotes({ description: trimmedDescription, reason: trimmedReason, aiNote: aiResponse });

  const updated = await prisma.trainingSession.update({
    where: { id },
    data: { status: "skipped", notes },
    select: { id: true, status: true, notes: true },
  });

  return NextResponse.json({ ...updated, aiResponse });
}
