import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveExecutionSummary } from "@/lib/execution-summary";

const USER_ID = "user_maxon";

export async function GET() {
  const activePlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    orderBy: { startsAt: "desc" },
  });

  const refDate = activePlan
    ? activePlan.startsAt
    : new Date(new Date().toISOString().split("T")[0] + "T00:00:00Z");

  // Both startsAt AND endsAt must be strictly before the active week start.
  // This prevents a plan starting e.g. 2026-04-19 (with endsAt 2026-04-25)
  // from being returned when the active week is 2026-04-20.
  const archivedPlan = await prisma.trainingPlan.findFirst({
    where: {
      userId: USER_ID,
      status: "archived",
      startsAt: { lt: refDate },
      endsAt: { lt: refDate },
    },
    orderBy: { startsAt: "desc" },
  });

  if (!archivedPlan) return NextResponse.json(null);

  // Prefer sessions belonging to the archived plan directly.
  // Done sessions may have been moved to newer plans on rollover, so we fall
  // back to a date-range query with strict bounds when the plan owns none.
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
        userId: USER_ID,
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

  // Content-based dedup: repeated draft generations create ghost sessions with
  // identical date + notes + duration + intensity + status.
  const seenKeys = new Set<string>();
  const deduped = rawSessions.filter((s) => {
    const key = `${s.scheduledDate.toISOString().split("T")[0]}|${s.notes ?? ""}|${s.durationMin}|${s.intensity}|${s.status}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // Per-day: prefer done/skipped over planned, max 2 per day, hard cap at 14.
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
