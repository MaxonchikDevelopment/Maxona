import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";
import { checkCooldown } from "@/lib/rate-limit";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed, retryAfterSec } = checkCooldown("plans:generate", 30_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Plan generation is on cooldown. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  try {
    const plan = await generateWeeklyPlan(userId);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Plan generation failed:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
