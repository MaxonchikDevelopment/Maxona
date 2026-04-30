import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";
import { checkCooldown } from "@/lib/rate-limit";

export async function POST() {
  const { allowed, retryAfterSec } = checkCooldown("plans:generate", 30_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Plan generation is on cooldown. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  try {
    const plan = await generateWeeklyPlan();
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Plan generation failed:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
