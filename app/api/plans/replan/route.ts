import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";
import type { WeeklyReview } from "@/lib/ai/adapter";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const reason: string = body.reason || "manual replan";
    const weeklyReview: WeeklyReview | undefined = body.weeklyReview;
    const plan = await generateWeeklyPlan(reason, weeklyReview);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Replan failed:", error);
    return NextResponse.json({ error: "Replan failed" }, { status: 500 });
  }
}
