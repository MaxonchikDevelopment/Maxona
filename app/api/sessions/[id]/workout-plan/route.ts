import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWorkoutPlan } from "@/lib/ai/workout-plan";
import { deriveExecutionSummary } from "@/lib/execution-summary";

const USER_ID = "user_maxon";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const plan = await prisma.sessionWorkoutPlan.findUnique({ where: { sessionId: id } });
  return NextResponse.json(plan ?? null);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
    include: {
      checkIn: true,
      stravaLinks: { include: { activity: true }, orderBy: { isPrimary: "desc" } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [trainingProfile, hybridProfile, recentSessions] = await Promise.all([
    prisma.userTrainingProfile.findUnique({ where: { userId: USER_ID } }),
    prisma.hybridRaceProfile.findUnique({ where: { userId: USER_ID } }),
    prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        scheduledDate: { lt: session.scheduledDate },
        status: { in: ["done", "skipped"] },
      },
      include: { checkIn: true },
      orderBy: { scheduledDate: "desc" },
      take: 5,
    }),
  ]);

  // Build Strava execution summary if activities are attached
  const stravaExecution = session.stravaLinks.length > 0
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

  const readinessContext = session.checkIn
    ? {
        feelScore: session.checkIn.feelScore,
        notes: session.checkIn.notes,
        category:
          session.checkIn.feelScore >= 4 ? "ok" : "fatigue",
      }
    : null;

  const result = await generateWorkoutPlan({
    session: {
      id: session.id,
      scheduledDate: session.scheduledDate.toISOString().split("T")[0],
      durationMin: session.durationMin,
      intensity: session.intensity,
      notes: session.notes,
      preferredSlot: session.preferredSlot,
    },
    trainingProfile: trainingProfile
      ? {
          restingHr: trainingProfile.restingHr,
          maxHr: trainingProfile.maxHr,
          easyHrMin: trainingProfile.easyHrMin,
          easyHrMax: trainingProfile.easyHrMax,
          tempoHrMin: trainingProfile.tempoHrMin,
          tempoHrMax: trainingProfile.tempoHrMax,
          thresholdHr: trainingProfile.thresholdHr,
          zoneMethod: trainingProfile.zoneMethod,
        }
      : null,
    hybridProfile: hybridProfile
      ? {
          defaultFormat: hybridProfile.defaultFormat,
          includesRunningDefault: hybridProfile.includesRunningDefault,
          stationWorkSec: hybridProfile.stationWorkSec,
          stationRestSec: hybridProfile.stationRestSec,
          defaultRounds: hybridProfile.defaultRounds,
          notes: hybridProfile.notes,
        }
      : null,
    readinessContext,
    recentSignals: recentSessions.map((s) => ({
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity,
      feelScore: s.checkIn?.feelScore,
      notes: s.notes,
    })),
    stravaExecution: stravaExecution
      ? {
          actualMovingMin: stravaExecution.actualMovingMin,
          actualDistanceKm: stravaExecution.actualDistanceKm,
          avgHR: stravaExecution.avgHR,
          maxHR: stravaExecution.maxHR,
          qualityLabel: stravaExecution.qualityLabel,
        }
      : null,
  });

  const saved = await prisma.sessionWorkoutPlan.upsert({
    where: { sessionId: id },
    create: {
      sessionId: id,
      userId: USER_ID,
      planType: result.planType,
      goal: result.goal,
      target: result.target,
      blocks: result.blocks as object[],
      rules: result.rules,
      alternatives: result.alternatives ?? undefined,
      summary: result.summary,
    },
    update: {
      planType: result.planType,
      goal: result.goal,
      target: result.target,
      blocks: result.blocks as object[],
      rules: result.rules,
      alternatives: result.alternatives ?? undefined,
      summary: result.summary,
      generatedAt: new Date(),
    },
  });

  return NextResponse.json(saved, { status: 201 });
}
