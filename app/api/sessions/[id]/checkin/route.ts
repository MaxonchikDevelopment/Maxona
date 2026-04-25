import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCoachAdvice } from "@/lib/ai/coach-advice";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import type { WorkoutAnalytics, StravaSessionMetrics } from "@/lib/ai/coach-advice";
import { getValidAccessToken, fetchActivityDetail } from "@/lib/strava/client";
import type { StravaSplitMetric } from "@/lib/strava/client";

const USER_ID = "user_maxon";

function computePaceCV(splits: StravaSplitMetric[]): number | null {
  const complete = splits.filter((s) => s.distance >= 800 && s.moving_time > 0);
  if (complete.length < 3) return null;
  const paces = complete.map((s) => s.moving_time / (s.distance / 1000));
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  if (mean === 0) return null;
  const variance = paces.reduce((s, p) => s + (p - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

async function fetchStravaMetrics(sessionId: string, plannedDurationMin: number): Promise<StravaSessionMetrics | undefined> {
  const links = await prisma.sessionStravaActivityLink.findMany({
    where: { sessionId },
    include: { activity: true },
    orderBy: { isPrimary: "desc" },
  });
  if (links.length === 0) return undefined;

  // Try to enrich rawJson with split data from the Strava detail endpoint (non-fatal)
  const token = await getValidAccessToken(USER_ID).catch(() => null);

  const enriched = await Promise.all(
    links.map(async (l) => {
      const a = l.activity;
      const rawObj = a.rawJson as Record<string, unknown> | null;
      if (rawObj && Array.isArray(rawObj.splits_metric)) return { a, detail: rawObj };
      if (!token) return { a, detail: rawObj };
      try {
        const detail = await fetchActivityDetail(token, a.stravaActivityId);
        await prisma.stravaActivity.update({
          where: { id: a.id },
          data: { rawJson: detail as object },
        });
        return { a, detail: detail as unknown as Record<string, unknown> };
      } catch {
        return { a, detail: rawObj };
      }
    })
  );

  const acts = enriched.map((e) => e.a);

  // HR reliability filter (sensor noise / watch glitch)
  const hrs = acts
    .filter((a) => a.averageHeartrate != null && a.averageHeartrate >= 50 && a.averageHeartrate <= 220)
    .map((a) => a.averageHeartrate!);
  const maxHrs = acts
    .filter((a) => a.maxHeartrate != null && a.maxHeartrate >= 50 && a.maxHeartrate <= 220)
    .map((a) => a.maxHeartrate!);
  const speeds = acts.filter((a) => a.averageSpeed > 0).map((a) => a.averageSpeed);

  const totalMovingTime = acts.reduce((s, a) => s + a.movingTime, 0);
  const totalElapsedTime = acts.reduce((s, a) => s + a.elapsedTime, 0);
  const totalDistance = acts.reduce((s, a) => s + a.distance, 0);
  const totalElevationGain = acts.reduce((s, a) => s + a.totalElevationGain, 0);

  const pauseTime = Math.max(0, totalElapsedTime - totalMovingTime);
  const pauseRatio = totalElapsedTime > 0 ? pauseTime / totalElapsedTime : 0;
  const elevationPerKm = totalDistance > 0 ? totalElevationGain / (totalDistance / 1000) : null;
  const actualVsPlannedDurationDeltaMin = plannedDurationMin > 0
    ? (totalMovingTime / 60) - plannedDurationMin
    : null;

  // Pace CV from the primary (first-ordered) activity splits only
  const primaryDetail = enriched[0]?.detail;
  const splitsRaw = primaryDetail?.splits_metric;
  const paceConsistencyCV = Array.isArray(splitsRaw)
    ? computePaceCV(splitsRaw as StravaSplitMetric[])
    : null;

  // Suffer score: sum across all attached activities
  const sufferScores = enriched
    .map((e) => (e.detail as Record<string, unknown> | null)?.suffer_score)
    .filter((s): s is number => typeof s === "number" && s > 0);
  const sufferScore = sufferScores.length > 0 ? sufferScores.reduce((a, b) => a + b, 0) : null;

  return {
    activityCount: acts.length,
    sportMix: [...new Set(acts.map((a) => a.sportType))],
    totalDistance,
    totalMovingTime,
    totalElapsedTime,
    totalElevationGain,
    pauseTime,
    pauseRatio,
    avgHeartrateMean: hrs.length > 0 ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null,
    maxHeartrateMax: maxHrs.length > 0 ? Math.max(...maxHrs) : null,
    averageSpeedMean: speeds.length > 0 ? speeds.reduce((s, v) => s + v, 0) / speeds.length : null,
    elevationPerKm,
    actualVsPlannedDurationDeltaMin,
    paceConsistencyCV,
    sufferScore,
    splitSession: acts.length > 1,
  };
}

function weekStartFromDate(date: Date): Date {
  const dow = date.getUTCDay(); // 0=Sun, 1=Mon
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - daysFromMonday);
  return result;
}

async function buildCheckInContext(
  sessionId: string,
  session: { scheduledDate: Date; intensity: string; durationMin: number; notes: string | null },
  feelScore: number,
  notes: string | null
): Promise<{
  recentContext: Array<{ date: string; intensity: string; notes: string | null; feelScore?: number; category?: string }>;
  analytics: WorkoutAnalytics;
}> {
  const weekStart = weekStartFromDate(session.scheduledDate);

  const [thisWeekDoneSessions, nextPlannedSession] = await Promise.all([
    prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        plan: { status: "active" },
        scheduledDate: { gte: weekStart },
        status: { in: ["done", "skipped"] },
        id: { not: sessionId },
      },
      include: { checkIn: true },
      orderBy: { scheduledDate: "desc" },
    }),
    prisma.trainingSession.findFirst({
      where: {
        userId: USER_ID,
        plan: { status: "active" },
        status: "planned",
        scheduledDate: { gt: session.scheduledDate },
      },
      orderBy: { scheduledDate: "asc" },
    }),
  ]);

  const recentContext = thisWeekDoneSessions.slice(0, 6).map((s) => ({
    date: s.scheduledDate.toISOString().split("T")[0],
    intensity: s.intensity as string,
    notes: s.notes,
    feelScore: s.checkIn?.feelScore,
    category: s.checkIn
      ? categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes)
      : undefined,
  }));

  const hardSessionsThisWeek =
    thisWeekDoneSessions.filter((s) => s.intensity === "hard").length +
    (session.intensity === "hard" ? 1 : 0);
  const minutesDoneThisWeek =
    thisWeekDoneSessions.reduce((sum, s) => sum + s.durationMin, 0) + session.durationMin;

  // Most recently completed session before current (by scheduledDate)
  const lastDone = [...thisWeekDoneSessions].sort(
    (a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime()
  )[0];
  const backToBackHardRisk =
    session.intensity === "hard" && lastDone?.intensity === "hard";

  const category = categorizeCheckIn(feelScore, notes);
  const badCIs = thisWeekDoneSessions.filter(
    (s) =>
      s.checkIn &&
      !s.checkIn.resolvedAt &&
      categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes) !== "ok"
  );
  const hasInjury =
    badCIs.some((s) => categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes) === "injury") ||
    category === "injury";
  const hasFatigue =
    !hasInjury &&
    (badCIs.some(
      (s) => categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes) === "fatigue"
    ) ||
      category === "fatigue");
  const plannerMode = hasInjury
    ? ("protecting" as const)
    : hasFatigue
    ? ("reducing" as const)
    : ("maintaining" as const);

  const allNotes = [...thisWeekDoneSessions.map((s) => s.notes), session.notes];
  const isLongRunWeek = allNotes.some((n) => (n ?? "").toLowerCase().includes("long run"));
  const isHyroxHeavyWeek =
    allNotes.filter((n) => (n ?? "").toLowerCase().startsWith("hyrox")).length >= 2;

  return {
    recentContext,
    analytics: {
      hardSessionsThisWeek,
      minutesDoneThisWeek,
      backToBackHardRisk,
      nextPlannedSession: nextPlannedSession
        ? {
            date: nextPlannedSession.scheduledDate.toISOString().split("T")[0],
            intensity: nextPlannedSession.intensity,
            notes: nextPlannedSession.notes,
          }
        : null,
      plannerMode,
      isLongRunWeek,
      isHyroxHeavyWeek,
    },
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { feelScore, notes } = await request.json();

  if (typeof feelScore !== "number" || feelScore < 1 || feelScore > 6) {
    return NextResponse.json({ error: "feelScore must be 1–6" }, { status: 400 });
  }

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [checkIn] = await prisma.$transaction([
    prisma.checkIn.upsert({
      where: { sessionId: id },
      create: {
        sessionId: id,
        userId: USER_ID,
        occurredAt: new Date(),
        feelScore,
        notes: notes?.trim() || null,
      },
      update: {
        feelScore,
        notes: notes?.trim() || null,
        occurredAt: new Date(),
      },
    }),
    prisma.trainingSession.update({
      where: { id },
      data: { status: "done" },
    }),
  ]);

  // Generate coach advice (non-blocking)
  {
    const category = categorizeCheckIn(feelScore, notes?.trim() || null);
    const [{ recentContext, analytics }, stravaMetrics] = await Promise.all([
      buildCheckInContext(id, session, feelScore, notes?.trim() || null),
      fetchStravaMetrics(id, session.durationMin),
    ]);

    const coachAdvice = await generateCoachAdvice({
      feelScore,
      notes: notes?.trim() || null,
      sessionIntensity: session.intensity,
      sessionDurationMin: session.durationMin,
      sessionNotes: session.notes,
      category,
      recentContext,
      analytics: stravaMetrics ? { ...analytics, stravaMetrics } : analytics,
    });

    if (coachAdvice) {
      const updated = await prisma.checkIn.update({
        where: { id: checkIn.id },
        data: { coachAdvice },
      });
      return NextResponse.json(updated, { status: 201 });
    } else {
      console.warn(
        `[checkin] coach advice returned null for session ${id} (feelScore=${feelScore}, category=${category})`
      );
    }
  }

  return NextResponse.json(checkIn, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
    include: { checkIn: true },
  });
  if (!session?.checkIn) {
    return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  }

  const existing = session.checkIn;
  const data: Record<string, unknown> = {};

  if (typeof body.feelScore === "number") {
    if (body.feelScore < 1 || body.feelScore > 6) {
      return NextResponse.json({ error: "feelScore must be 1–6" }, { status: 400 });
    }
    data.feelScore = body.feelScore;
  }

  if ("notes" in body) {
    data.notes = body.notes?.trim() || null;
  }

  if (body.resolved === true) {
    data.resolvedAt = new Date();
  } else if (body.resolved === false) {
    data.resolvedAt = null;
  }

  const isScoreOrNotesEdit = typeof body.feelScore === "number" || "notes" in body;

  if (isScoreOrNotesEdit) {
    const newFeelScore = typeof body.feelScore === "number" ? body.feelScore : existing.feelScore;
    const newNotes = "notes" in body ? (body.notes?.trim() || null) : existing.notes;

    // Auto-unresolve only applies to low feel scores
    if (newFeelScore <= 3 && existing.resolvedAt && body.resolved !== true) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[checkin] auto-unresolving ${existing.id} — feelScore=${newFeelScore} is still low`);
      }
      data.resolvedAt = null;
    }

    const category = categorizeCheckIn(newFeelScore, newNotes);
    const [{ recentContext, analytics }, stravaMetrics] = await Promise.all([
      buildCheckInContext(id, session, newFeelScore, newNotes),
      fetchStravaMetrics(id, session.durationMin),
    ]);

    const coachAdvice = await generateCoachAdvice({
      feelScore: newFeelScore,
      notes: newNotes,
      sessionIntensity: session.intensity,
      sessionDurationMin: session.durationMin,
      sessionNotes: session.notes,
      category,
      recentContext,
      analytics: stravaMetrics ? { ...analytics, stravaMetrics } : analytics,
    });

    data.coachAdvice = coachAdvice ?? null;
  }

  const updated = await prisma.checkIn.update({
    where: { id: existing.id },
    data,
  });

  return NextResponse.json(updated);
}
