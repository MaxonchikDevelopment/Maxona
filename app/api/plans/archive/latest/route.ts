import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveExecutionSummary } from "@/lib/execution-summary";

const USER_ID = "user_maxon";

export async function GET() {
  const archivedPlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "archived" },
    orderBy: { startsAt: "desc" },
  });

  if (!archivedPlan) return NextResponse.json(null);

  // Fetch all sessions for this week range regardless of current planId —
  // done/skipped sessions are moved to the new plan on rollover, so we query by date range.
  const weekSessions = await prisma.trainingSession.findMany({
    where: {
      userId: USER_ID,
      scheduledDate: { gte: archivedPlan.startsAt, lte: archivedPlan.endsAt },
    },
    include: {
      checkIn: true,
      stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
  });

  const sessions = weekSessions.map((s) => {
    const activities = s.stravaLinks.map((l) => l.activity);
    let execution: {
      actualMovingMin: number;
      actualDistanceKm: number | null;
      paceStr: string | null;
      qualityLabel: string;
      actualSportTypes: string[];
    } | null = null;

    if (activities.length > 0) {
      const summary = deriveExecutionSummary(
        s,
        activities.map((a) => ({
          distance: a.distance,
          movingTime: a.movingTime,
          elapsedTime: a.elapsedTime,
          totalElevationGain: a.totalElevationGain,
          averageSpeed: a.averageSpeed,
          sportType: a.sportType,
          averageHeartrate: a.averageHeartrate ?? null,
          maxHeartrate: a.maxHeartrate ?? null,
        }))
      );
      if (summary) {
        execution = {
          actualMovingMin: summary.actualMovingMin,
          actualDistanceKm: summary.actualDistanceKm,
          paceStr: summary.paceStr,
          qualityLabel: summary.qualityLabel,
          actualSportTypes: activities.map((a) => a.sportType),
        };
      }
    }

    return {
      id: s.id,
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity,
      durationMin: s.durationMin,
      notes: s.notes,
      status: s.status,
      checkIn: s.checkIn ? { feelScore: s.checkIn.feelScore } : null,
      execution,
    };
  });

  const done = sessions.filter((s) => s.status === "done").length;
  const skipped = sessions.filter((s) => s.status === "skipped").length;

  return NextResponse.json({
    planId: archivedPlan.id,
    weekStart: archivedPlan.startsAt.toISOString().split("T")[0],
    weekEnd: archivedPlan.endsAt.toISOString().split("T")[0],
    focusSummary: archivedPlan.focusSummary,
    planned: sessions.length,
    done,
    skipped,
    sessions,
  });
}
