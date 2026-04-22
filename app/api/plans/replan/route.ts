import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const plan = await generateWeeklyPlan(body.reason);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Replan failed:", error);
    return NextResponse.json({ error: "Replan failed" }, { status: 500 });
  }
}
