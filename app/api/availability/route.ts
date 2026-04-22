import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DayOfWeek } from "@prisma/client";

const USER_ID = "user_maxon";

export async function GET() {
  const windows = await prisma.availabilityWindow.findMany({
    where: { userId: USER_ID },
    orderBy: [{ dayOfWeek: "asc" }, { timeStartMin: "asc" }],
  });
  return NextResponse.json(windows);
}

export async function POST(request: Request) {
  const { dayOfWeek, timeStartMin, timeEndMin } = await request.json();
  if (!dayOfWeek || timeStartMin == null || timeEndMin == null) {
    return NextResponse.json({ error: "dayOfWeek, timeStartMin, timeEndMin required" }, { status: 400 });
  }
  const window = await prisma.availabilityWindow.create({
    data: { userId: USER_ID, dayOfWeek: dayOfWeek as DayOfWeek, timeStartMin, timeEndMin },
  });
  return NextResponse.json(window, { status: 201 });
}
