import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWorkoutFeedback } from "@/lib/ai/workout-feedback";
import { deriveExecutionSummary } from "@/lib/execution-summary";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const feedback = await prisma.sessionWorkoutFeedback.findUnique({
    where: { sessionId: id },
  });
  return NextResponse.json(feedback ?? null);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId },
    include: {
      checkIn: true,
      workoutPlan: true,
      stravaLinks: {
        include: { activity: true },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const executionSummaryRaw =
    session.stravaLinks.length > 0
      ? deriveExecutionSummary(
          { durationMin: session.durationMin, notes: session.notes },
          session.stravaLinks.map((l) => ({
            distance: l.activity.distance,
            movingTime: l.activity.movingTime,
            elapsedTime: l.activity.elapsedTime,
            totalElevationGain: l.activity.totalElevationGain,
            averageSpeed: l.activity.averageSpeed,
            sportType: l.activity.sportType,
            averageHeartrate: l.activity.averageHeartrate,
            maxHeartrate: l.activity.maxHeartrate,
          }))
        )
      : null;

  const executionSummary = executionSummaryRaw
    ? {
        actualMovingMin: executionSummaryRaw.actualMovingMin,
        actualDistanceKm: executionSummaryRaw.actualDistanceKm,
        paceStr: executionSummaryRaw.paceStr,
        qualityLabel: executionSummaryRaw.qualityLabel,
        avgHR: executionSummaryRaw.avgHR,
        splitSession: executionSummaryRaw.splitSession,
        hillsIndicator: executionSummaryRaw.hillsIndicator,
        actualSportTypes: session.stravaLinks.map((l) => l.activity.sportType),
      }
    : null;

  const plan = session.workoutPlan;

  const result = await generateWorkoutFeedback({
    session: {
      durationMin: session.durationMin,
      intensity: session.intensity,
      notes: session.notes,
    },
    workoutPlan: plan
      ? {
          planType: plan.planType,
          goal: plan.goal,
          target: plan.target,
          blocks: plan.blocks as Array<{
            label: string;
            durationMin: number;
            intensity: string;
          }>,
          summary: plan.summary,
        }
      : null,
    checkIn: session.checkIn
      ? {
          feelScore: session.checkIn.feelScore,
          notes: session.checkIn.notes,
        }
      : null,
    executionSummary,
  });

  const saved = await prisma.sessionWorkoutFeedback.upsert({
    where: { sessionId: id },
    create: {
      sessionId: id,
      userId,
      adherenceLabel: result.adherenceLabel,
      summary: result.summary,
      bullets: result.bullets,
      nextAdjustment: result.nextAdjustment,
    },
    update: {
      adherenceLabel: result.adherenceLabel,
      summary: result.summary,
      bullets: result.bullets,
      nextAdjustment: result.nextAdjustment,
      generatedAt: new Date(),
    },
  });

  return NextResponse.json(saved, { status: 201 });
}
