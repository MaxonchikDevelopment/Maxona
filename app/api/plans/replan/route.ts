import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    // Always provide a reason so the LLM knows this is a replan and writes changeExplanation
    const reason: string = body.reason || "manual replan";
    const plan = await generateWeeklyPlan(reason);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Replan failed:", error);
    return NextResponse.json({ error: "Replan failed" }, { status: 500 });
  }
}
