import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

const VALID_INTENSITIES = ["easy", "moderate", "hard"] as const;
const VALID_SLOTS = ["morning", "daytime", "afternoon", "evening"] as const;
const VALID_MODALITIES = ["running", "cycling", "swimming", "hyrox", "strength", "other"] as const;

type Modality = (typeof VALID_MODALITIES)[number];

function modalityLabel(m: Modality): string {
  if (m === "hyrox") return "HYROX";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { date, modality, durationMin, intensity, preferredSlot, notes } = body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!VALID_MODALITIES.includes(modality)) {
    return NextResponse.json({ error: "invalid modality" }, { status: 400 });
  }
  if (typeof durationMin !== "number" || durationMin < 1) {
    return NextResponse.json({ error: "durationMin must be a positive number" }, { status: 400 });
  }
  if (!VALID_INTENSITIES.includes(intensity)) {
    return NextResponse.json({ error: "invalid intensity" }, { status: 400 });
  }
  if (!VALID_SLOTS.includes(preferredSlot)) {
    return NextResponse.json({ error: "invalid preferredSlot" }, { status: 400 });
  }

  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
  });
  if (!activePlan) {
    return NextResponse.json({ error: "No active plan" }, { status: 404 });
  }

  const label = modalityLabel(modality as Modality);
  const sessionNotes = notes?.trim() ? `${label}: ${notes.trim()}` : label;

  const [y, m, d] = (date as string).split("-").map(Number);
  const scheduledDate = new Date(Date.UTC(y, m - 1, d));

  const session = await prisma.trainingSession.create({
    data: {
      planId: activePlan.id,
      userId: USER_ID,
      scheduledDate,
      preferredSlot,
      planningType: "manual",
      status: "planned",
      durationMin: Math.round(durationMin),
      intensity,
      notes: sessionNotes,
    },
  });

  return NextResponse.json(session, { status: 201 });
}
