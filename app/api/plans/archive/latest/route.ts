import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveExecutionSummary } from "@/lib/execution-summary";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId, status: "active" },
    orderBy: { startsAt: "desc" },
  });

  const refDate = activePlan
    ? activePlan.startsAt
    : new Date(new Date().toISOString().split("T")[0] + "T00:00:00Z");

  const archivedPlan = await prisma.trainingPlan.findFirst({
    where: {
      userId,
      status: "archived",
      startsAt: { lt: refDate },
      endsAt: { lt: refDate },
    },
    orderBy: { startsAt: "desc" },
  });

  if (!archivedPlan) return NextResponse.json(null);

  let rawSessions = await prisma.trainingSession.findMany({
    where: { planId: archivedPlan.id },
    include: {
      checkIn: true,
      stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
  });

  if (rawSessions.length === 0) {
    rawSessions = await prisma.trainingSession.findMany({
      where: {
        userId,
        AND: [
          { scheduledDate: { gte: archivedPlan.startsAt } },
          { scheduledDate: { lte: archivedPlan.endsAt } },
          { scheduledDate: { lt: refDate } },
        ],
        plan: { status: { not: "draft" } },
      },
      include: {
        checkIn: true,
        stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
    });
  }

  const seenKeys = new Set<string>();
  const deduped = rawSessions.filter((s) => {
    const key = `${s.scheduledDate.toISOString().split("T")[0]}|${s.notes ?? ""}|${s.durationMin}|${s.intensity}|${s.status}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const byDate = new Map<string, typeof deduped>();
  for (const s of deduped) {
    const key = s.scheduledDate.toISOString().split("T")[0];
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(s);
  }

  const selected: (typeof deduped)[number][] = [];
  for (const [, daySessions] of byDate) {
    if (selected.length >= 14) break;
    const nonPlanned = daySessions.filter((s) => s.status !== "planned");
    const toAdd = nonPlanned.length > 0 ? nonPlanned : [daySessions[0]];
    selected.push(...toAdd.slice(0, 2));
  }

  const sessions = selected.map((s) => {
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
