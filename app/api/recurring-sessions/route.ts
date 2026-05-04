import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { DayOfWeek, TimeSlot, SessionIntensity, SessionPlanningType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await prisma.recurringSession.findMany({
    where: { userId, isActive: true },
    orderBy: { dayOfWeek: "asc" },
  });
  return NextResponse.json(sessions);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { dayOfWeek, preferredSlot, durationMin, intensity, notes, planningType } = await request.json();
  if (!dayOfWeek || !preferredSlot || !durationMin) {
    return NextResponse.json({ error: "dayOfWeek, preferredSlot, durationMin required" }, { status: 400 });
  }
  const session = await prisma.recurringSession.create({
    data: {
      userId,
      dayOfWeek: dayOfWeek as DayOfWeek,
      preferredSlot: preferredSlot as TimeSlot,
      planningType: (planningType ?? "fixed") as SessionPlanningType,
      durationMin: Number(durationMin),
      intensity: (intensity ?? "moderate") as SessionIntensity,
      notes: notes?.trim() || null,
    },
  });
  return NextResponse.json(session, { status: 201 });
}
