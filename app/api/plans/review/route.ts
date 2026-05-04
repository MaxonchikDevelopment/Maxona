import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateNextWeekDraft } from "@/lib/planner/orchestrator";
import { checkCooldown } from "@/lib/rate-limit";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { WeeklyReview } from "@/lib/ai/adapter";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const draft = await prisma.trainingPlan.findFirst({
    where: { userId, status: "draft" },
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

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed, retryAfterSec } = checkCooldown("plans:review", 30_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Review generation is on cooldown. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  try {
    const body = await request.json();
    const weeklyReview: WeeklyReview | undefined = body.weeklyReview ?? undefined;

    const draft = await generateNextWeekDraft(userId, weeklyReview);

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
