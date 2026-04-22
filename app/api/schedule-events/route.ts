import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ScheduleEventKind } from "@prisma/client";

const USER_ID = "user_maxon";

export async function GET() {
  const events = await prisma.scheduleEvent.findMany({
    where: { userId: USER_ID },
    orderBy: { startsAt: "asc" },
  });
  return NextResponse.json(events);
}

export async function POST(request: Request) {
  const { startsAt, endsAt, kind, note } = await request.json();
  if (!startsAt || !endsAt || !kind) {
    return NextResponse.json({ error: "startsAt, endsAt, kind required" }, { status: 400 });
  }
  const event = await prisma.scheduleEvent.create({
    data: {
      userId: USER_ID,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      kind: kind as ScheduleEventKind,
      source: "manual",
      note: note?.trim() || null,
    },
  });
  return NextResponse.json(event, { status: 201 });
}
