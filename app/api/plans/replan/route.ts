import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/planner/orchestrator";
import { checkCooldown } from "@/lib/rate-limit";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { WeeklyReview } from "@/lib/ai/adapter";

const MAX_REASON_LEN = 500;

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed, retryAfterSec } = checkCooldown("plans:replan", 30_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Replan is on cooldown. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  try {
    const body = await request.json().catch(() => ({}));
    const reason: string =
      typeof body.reason === "string"
        ? body.reason.slice(0, MAX_REASON_LEN) || "manual replan"
        : "manual replan";
    const weeklyReview: WeeklyReview | undefined = body.weeklyReview;
    const plan = await generateWeeklyPlan(userId, reason, weeklyReview);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("Replan failed:", error);
    return NextResponse.json({ error: "Replan failed" }, { status: 500 });
  }
}
