import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { DayOfWeek } from "@prisma/client";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const windows = await prisma.availabilityWindow.findMany({
    where: { userId },
    orderBy: [{ dayOfWeek: "asc" }, { timeStartMin: "asc" }],
  });
  return NextResponse.json(windows);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { dayOfWeek, timeStartMin, timeEndMin } = await request.json();
  if (!dayOfWeek || timeStartMin == null || timeEndMin == null) {
    return NextResponse.json({ error: "dayOfWeek, timeStartMin, timeEndMin required" }, { status: 400 });
  }
  const window = await prisma.availabilityWindow.create({
    data: { userId, dayOfWeek: dayOfWeek as DayOfWeek, timeStartMin, timeEndMin },
  });
  return NextResponse.json(window, { status: 201 });
}
