import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DayOfWeek, TimeSlot, SessionIntensity } from "@prisma/client";

const USER_ID = "user_maxon";

export async function GET() {
  const sessions = await prisma.recurringSession.findMany({
    where: { userId: USER_ID, isActive: true },
    orderBy: { dayOfWeek: "asc" },
  });
  return NextResponse.json(sessions);
}

export async function POST(request: Request) {
  const { dayOfWeek, preferredSlot, durationMin, intensity, notes } = await request.json();
  if (!dayOfWeek || !preferredSlot || !durationMin) {
    return NextResponse.json({ error: "dayOfWeek, preferredSlot, durationMin required" }, { status: 400 });
  }
  const session = await prisma.recurringSession.create({
    data: {
      userId: USER_ID,
      dayOfWeek: dayOfWeek as DayOfWeek,
      preferredSlot: preferredSlot as TimeSlot,
      durationMin: Number(durationMin),
      intensity: (intensity ?? "moderate") as SessionIntensity,
      notes: notes?.trim() || null,
    },
  });
  return NextResponse.json(session, { status: 201 });
}
