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
