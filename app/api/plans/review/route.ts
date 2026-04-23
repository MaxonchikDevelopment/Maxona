import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateNextWeekDraft } from "@/lib/planner/orchestrator";
import type { WeeklyReview } from "@/lib/ai/adapter";

const USER_ID = "user_maxon";

export async function GET() {
  const draft = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "draft" },
    orderBy: { startsAt: "desc" },
    include: {
      sessions: {
        orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
        select: {
          scheduledDate: true,
          durationMin: true,
          intensity: true,
          notes: true,
          preferredSlot: true,
        },
      },
    },
  });

  if (!draft) return NextResponse.json(null);

  return NextResponse.json({
    planId: draft.id,
    weekStart: draft.startsAt,
    focusSummary: draft.focusSummary,
    sessions: draft.sessions.map((s) => ({
      scheduledDate: s.scheduledDate,
      durationMin: s.durationMin,
      intensity: s.intensity,
      notes: s.notes,
      preferredSlot: s.preferredSlot,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const weeklyReview: WeeklyReview | undefined = body.weeklyReview ?? undefined;

    const draft = await generateNextWeekDraft(weeklyReview);

    return NextResponse.json({
      planId: draft.id,
      weekStart: draft.startsAt,
      focusSummary: draft.focusSummary,
    });
  } catch (err) {
    console.error("[review] generateNextWeekDraft failed:", err);
    return NextResponse.json({ error: "Failed to generate next week draft" }, { status: 500 });
  }
}
