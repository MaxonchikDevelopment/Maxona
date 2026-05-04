import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { ScheduleEventKind } from "@prisma/client";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const events = await prisma.scheduleEvent.findMany({
    where: { userId },
    orderBy: { startsAt: "asc" },
  });
  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { startsAt, endsAt, kind, note } = await request.json();
  if (!startsAt || !endsAt || !kind) {
    return NextResponse.json({ error: "startsAt, endsAt, kind required" }, { status: 400 });
  }
  const event = await prisma.scheduleEvent.create({
    data: {
      userId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      kind: kind as ScheduleEventKind,
      source: "manual",
      note: note?.trim() || null,
    },
  });
  return NextResponse.json(event, { status: 201 });
}
