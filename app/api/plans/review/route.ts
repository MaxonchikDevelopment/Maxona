import { NextResponse } from "next/server";
import { generateNextWeekDraft } from "@/lib/planner/orchestrator";
import type { WeeklyReview } from "@/lib/ai/adapter";

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
