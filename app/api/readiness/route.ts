import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { categorizeCheckIn, inferTagsFromNotes, READINESS_TAGS } from "@/lib/checkin-utils";
import { generateReadinessCoachAdvice } from "@/lib/ai/coach-advice";
import type { ReadinessTag } from "@/lib/checkin-utils";

const USER_ID = "user_maxon";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const record = await prisma.dailyReadiness.findUnique({
    where: { userId_date: { userId: USER_ID, date: new Date(date + "T00:00:00Z") } },
  });

  return NextResponse.json(record ?? null);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { date, feelScore, notes, tags: userTags } = body;

  if (!date || typeof feelScore !== "number" || feelScore < 1 || feelScore > 6) {
    return NextResponse.json(
      { error: "date and feelScore (1–6) required" },
      { status: 400 }
    );
  }

  if (typeof notes === "string" && notes.length > 2000) {
    return NextResponse.json({ error: "notes too long (max 2000 chars)" }, { status: 400 });
  }

  const trimmedNotes = notes?.trim() || null;
  const inferredTags = inferTagsFromNotes(trimmedNotes);
  const providedTags: ReadinessTag[] = Array.isArray(userTags)
    ? userTags.filter((t: string) => (READINESS_TAGS as readonly string[]).includes(t))
    : [];
  const tags = [...new Set([...providedTags, ...inferredTags])];
  const category = categorizeCheckIn(feelScore, trimmedNotes);

  const record = await prisma.dailyReadiness.upsert({
    where: { userId_date: { userId: USER_ID, date: new Date(date + "T00:00:00Z") } },
    create: {
      userId: USER_ID,
      date: new Date(date + "T00:00:00Z"),
      feelScore,
      notes: trimmedNotes,
      tags,
      category,
    },
    update: {
      feelScore,
      notes: trimmedNotes,
      tags,
      category,
    },
  });

  // Silent neutral entry — no signal worth coaching on
  const isSilentNeutral = feelScore === 4 && !trimmedNotes && tags.length === 0;
  const coachAdvice = isSilentNeutral
    ? null
    : await generateReadinessCoachAdvice({ feelScore, notes: trimmedNotes, tags, category });

  const updated = await prisma.dailyReadiness.update({
    where: { id: record.id },
    data: { coachAdvice },
  });
  return NextResponse.json(updated, { status: 201 });
}
