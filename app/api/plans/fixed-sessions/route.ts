import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { TimeSlot, SessionIntensity, SessionModality } from "@prisma/client";

const SLOTS: TimeSlot[] = ["morning", "daytime", "afternoon", "evening"];
const INTENSITIES: SessionIntensity[] = ["easy", "moderate", "hard"];
const MODALITIES: SessionModality[] = ["hyrox", "running", "cycling", "swimming"];

function nextWeekRange(timezone: string): { start: Date; end: Date } {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayUtc = new Date(Date.UTC(y, m - 1, d));
  const dow = todayUtc.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(todayUtc);
  monday.setUTCDate(todayUtc.getUTCDate() - daysFromMonday);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  const nextSunday = new Date(nextMonday);
  nextSunday.setUTCDate(nextMonday.getUTCDate() + 6);
  return { start: nextMonday, end: nextSunday };
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { start, end } = nextWeekRange(user.timezone);

  const rows = await prisma.plannedFixedSession.findMany({
    where: { userId, scheduledDate: { gte: start, lte: end } },
    orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
  });

  return NextResponse.json({
    weekStart: start.toISOString().split("T")[0],
    sessions: rows.map((r) => ({
      id: r.id,
      scheduledDate: r.scheduledDate.toISOString().split("T")[0],
      preferredSlot: r.preferredSlot,
      durationMin: r.durationMin,
      intensity: r.intensity,
      modality: r.modality,
      notes: r.notes,
    })),
  });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { start, end } = nextWeekRange(user.timezone);

  const body = await request.json();
  const { dayOffset, preferredSlot, durationMin, intensity, modality, notes } = body ?? {};

  const offset = Number(dayOffset);
  if (!Number.isInteger(offset) || offset < 0 || offset > 6) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }
  if (!SLOTS.includes(preferredSlot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }
  if (!INTENSITIES.includes(intensity)) {
    return NextResponse.json({ error: "Invalid intensity" }, { status: 400 });
  }
  if (!MODALITIES.includes(modality)) {
    return NextResponse.json({ error: "Invalid modality" }, { status: 400 });
  }
  const dur = Number(durationMin);
  if (!Number.isFinite(dur) || dur < 10 || dur > 360) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }

  const scheduledDate = new Date(start);
  scheduledDate.setUTCDate(start.getUTCDate() + offset);
  if (scheduledDate > end) {
    return NextResponse.json({ error: "Date outside next week" }, { status: 400 });
  }

  const created = await prisma.plannedFixedSession.create({
    data: {
      userId,
      scheduledDate,
      preferredSlot,
      durationMin: Math.round(dur),
      intensity,
      modality,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    },
  });

  return NextResponse.json({
    id: created.id,
    scheduledDate: created.scheduledDate.toISOString().split("T")[0],
    preferredSlot: created.preferredSlot,
    durationMin: created.durationMin,
    intensity: created.intensity,
    modality: created.modality,
    notes: created.notes,
  });
}

export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Scope delete to the owner so one user cannot remove another's row.
  const result = await prisma.plannedFixedSession.deleteMany({ where: { id, userId } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
