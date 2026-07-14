import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import { computeWeekSummary } from "@/lib/week-summary";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.trainingPlan.findFirst({
    where: { userId, status: "active" },
    include: {
      sessions: {
        include: {
          checkIn: true,
          stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
      },
    },
  });

  if (!plan) return NextResponse.json(null);

  const readinessRecords = await prisma.dailyReadiness.findMany({
    where: { userId, date: { gte: plan.startsAt, lte: plan.endsAt } },
  });

  return NextResponse.json(computeWeekSummary(plan, plan.sessions, readinessRecords));
}
