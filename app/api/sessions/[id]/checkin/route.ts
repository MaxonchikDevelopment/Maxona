import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { feelScore, notes } = await request.json();

  if (typeof feelScore !== "number" || feelScore < 1 || feelScore > 5) {
    return NextResponse.json({ error: "feelScore must be 1–5" }, { status: 400 });
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

  const data: Record<string, unknown> = {};

  if (typeof body.feelScore === "number") {
    if (body.feelScore < 1 || body.feelScore > 5) {
      return NextResponse.json({ error: "feelScore must be 1–5" }, { status: 400 });
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

  const updated = await prisma.checkIn.update({
    where: { id: session.checkIn.id },
    data,
  });

  return NextResponse.json(updated);
}
