import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCoachAdvice } from "@/lib/ai/coach-advice";
import { categorizeCheckIn } from "@/lib/checkin-utils";

const USER_ID = "user_maxon";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { feelScore, notes } = await request.json();

  if (typeof feelScore !== "number" || feelScore < 1 || feelScore > 6) {
    return NextResponse.json({ error: "feelScore must be 1–6" }, { status: 400 });
  }

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [checkIn] = await prisma.$transaction([
    prisma.checkIn.upsert({
      where: { sessionId: id },
      create: {
        sessionId: id,
        userId: USER_ID,
        occurredAt: new Date(),
        feelScore,
        notes: notes?.trim() || null,
      },
      update: {
        feelScore,
        notes: notes?.trim() || null,
        occurredAt: new Date(),
      },
    }),
    prisma.trainingSession.update({
      where: { id },
      data: { status: "done" },
    }),
  ]);

  // Generate coach advice for all feel scores (non-blocking)
  {
    const category = categorizeCheckIn(feelScore, notes?.trim() || null);

    // Gather recent sessions from active plan for context
    const recentSessions = await prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        id: { not: id },
        plan: { status: "active" },
        status: { in: ["done", "skipped"] },
      },
      include: { checkIn: true },
      orderBy: { scheduledDate: "desc" },
      take: 7,
    });

    const recentContext = recentSessions.map((s) => ({
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity as string,
      notes: s.notes,
      feelScore: s.checkIn?.feelScore,
      category: s.checkIn
        ? categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes)
        : undefined,
    }));

    const coachAdvice = await generateCoachAdvice({
      feelScore,
      notes: notes?.trim() || null,
      sessionIntensity: session.intensity,
      sessionDurationMin: session.durationMin,
      sessionNotes: session.notes,
      category,
      recentContext,
    });

    if (coachAdvice) {
      const updated = await prisma.checkIn.update({
        where: { id: checkIn.id },
        data: { coachAdvice },
      });
      return NextResponse.json(updated, { status: 201 });
    } else {
      console.warn(
        `[checkin] coach advice returned null for session ${id} (feelScore=${feelScore}, category=${category})`
      );
    }
  }

  return NextResponse.json(checkIn, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
    include: { checkIn: true },
  });
  if (!session?.checkIn) {
    return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  }

  const existing = session.checkIn;
  const data: Record<string, unknown> = {};

  if (typeof body.feelScore === "number") {
    if (body.feelScore < 1 || body.feelScore > 6) {
      return NextResponse.json({ error: "feelScore must be 1–6" }, { status: 400 });
    }
    data.feelScore = body.feelScore;
  }

  if ("notes" in body) {
    data.notes = body.notes?.trim() || null;
  }

  if (body.resolved === true) {
    data.resolvedAt = new Date();
  } else if (body.resolved === false) {
    data.resolvedAt = null;
  }

  const isScoreOrNotesEdit = typeof body.feelScore === "number" || "notes" in body;

  if (isScoreOrNotesEdit) {
    const newFeelScore = typeof body.feelScore === "number" ? body.feelScore : existing.feelScore;
    const newNotes = "notes" in body ? (body.notes?.trim() || null) : existing.notes;

    // Auto-unresolve only applies to low feel scores
    if (newFeelScore <= 3 && existing.resolvedAt && body.resolved !== true) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[checkin] auto-unresolving ${existing.id} — feelScore=${newFeelScore} is still low`);
      }
      data.resolvedAt = null;
    }

    const category = categorizeCheckIn(newFeelScore, newNotes);
    const recentSessions = await prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        id: { not: id },
        plan: { status: "active" },
        status: { in: ["done", "skipped"] },
      },
      include: { checkIn: true },
      orderBy: { scheduledDate: "desc" },
      take: 7,
    });

    const recentContext = recentSessions.map((s) => ({
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity as string,
      notes: s.notes,
      feelScore: s.checkIn?.feelScore,
      category: s.checkIn
        ? categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes)
        : undefined,
    }));

    const coachAdvice = await generateCoachAdvice({
      feelScore: newFeelScore,
      notes: newNotes,
      sessionIntensity: session.intensity,
      sessionDurationMin: session.durationMin,
      sessionNotes: session.notes,
      category,
      recentContext,
    });

    data.coachAdvice = coachAdvice ?? null;
  }

  const updated = await prisma.checkIn.update({
    where: { id: existing.id },
    data,
  });

  return NextResponse.json(updated);
}
