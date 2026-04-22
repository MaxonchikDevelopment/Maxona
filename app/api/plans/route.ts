import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";

export async function POST() {
  try {
    const plan = await generateWeeklyPlan();
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Plan generation failed:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
