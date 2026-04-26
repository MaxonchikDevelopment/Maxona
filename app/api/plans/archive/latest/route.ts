import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveExecutionSummary } from "@/lib/execution-summary";

const USER_ID = "user_maxon";

export async function GET() {
  // Use the active plan's startsAt as upper bound so we never return a future-week draft
  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    orderBy: { startsAt: "desc" },
  });

  // If no active plan, fall back to today as the reference point
  const refDate = activePlan
    ? activePlan.startsAt
    : new Date(new Date().toISOString().split("T")[0] + "T00:00:00Z");

  const archivedPlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "archived", startsAt: { lt: refDate } },
    orderBy: { startsAt: "desc" },
  });

  if (!archivedPlan) return NextResponse.json(null);

  // Done sessions may have been moved to newer plans on rollover — query by date range.
  // Deduplicate aggressively to handle repeated draft generations creating ghost sessions.
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

  // Per date: prefer done/skipped over planned, max 2 per day
  const byDate = new Map<string, typeof weekSessions>();
  for (const s of weekSessions) {
    const key = s.scheduledDate.toISOString().split("T")[0];
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(s);
  }

  const deduped: (typeof weekSessions)[number][] = [];
  for (const [, daySessions] of byDate) {
    const nonPlanned = daySessions.filter((s) => s.status !== "planned");
    const toAdd = nonPlanned.length > 0 ? nonPlanned : [daySessions[0]];
    deduped.push(...toAdd.slice(0, 2));
  }

  const sessions = deduped.map((s) => {
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
