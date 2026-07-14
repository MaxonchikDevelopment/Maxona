import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scoreCandidate, labelForScore } from "@/lib/strava/suggest";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import { ACTIVITY_MATCH_WINDOW_DAYS } from "@/lib/strava/constants";

// Returns synced Strava activities.
// ?sessionDate=YYYY-MM-DD  — filter to ±ACTIVITY_MATCH_WINDOW_DAYS days around that date
// ?excludeSessionId=...    — exclude activities already linked to that session
// ?sessionDurationMin=N    — planned session duration for scoring
// ?sessionNotes=...        — session notes for sport-type inference
// ?sessionSlot=morning|... — preferred slot for time-of-day scoring
// When session context is present, returns scored+sorted results with suggestionLabel.
export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionDate = searchParams.get("sessionDate");
  const excludeSessionId = searchParams.get("excludeSessionId");
  const sessionDurationMin = searchParams.get("sessionDurationMin");
  const sessionNotes = searchParams.get("sessionNotes");
  const sessionSlot = searchParams.get("sessionSlot");

  let dateFilter: { gte?: Date; lte?: Date } | undefined;
  if (sessionDate) {
    const [y, m, d] = sessionDate.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    const from = new Date(base);
    from.setUTCDate(from.getUTCDate() - ACTIVITY_MATCH_WINDOW_DAYS);
    // Upper bound is N+1 days at 00:00 UTC (not N), so day+N is fully covered —
    // an activity any time on day+N is still < 00:00 of day+N+1.
    const to = new Date(base);
    to.setUTCDate(to.getUTCDate() + ACTIVITY_MATCH_WINDOW_DAYS + 1);
    dateFilter = { gte: from, lte: to };
  }

  let excludedIds: string[] = [];
  if (excludeSessionId) {
    const links = await prisma.sessionStravaActivityLink.findMany({
      where: { sessionId: excludeSessionId },
      select: { stravaActivityId: true },
    });
    excludedIds = links.map((l) => l.stravaActivityId);
  }

  const activities = await prisma.stravaActivity.findMany({
    where: {
      userId,
      ...(dateFilter ? { startDate: dateFilter } : {}),
      ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
    },
    orderBy: { startDate: "desc" },
    take: 50,
  });

  const linkedToOther = await prisma.sessionStravaActivityLink.findMany({
    where: {
      stravaActivityId: { in: activities.map((a) => a.id) },
      ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
    },
    select: { stravaActivityId: true },
  });
  const linkedToOtherIds = new Set(linkedToOther.map((l) => l.stravaActivityId));
  const filteredActivities = activities.filter((a) => !linkedToOtherIds.has(a.id));

  const shouldScore = !!(sessionDate && sessionSlot);
  if (!shouldScore) {
    return NextResponse.json(filteredActivities);
  }

  const linkedElsewhereIds = new Set<string>();

  const session = {
    scheduledDate: sessionDate!,
    durationMin: sessionDurationMin ? parseInt(sessionDurationMin, 10) : 0,
    notes: sessionNotes ?? null,
    preferredSlot: sessionSlot!,
  };

  const scored = filteredActivities
    .map((a) => ({
      ...a,
      score: scoreCandidate(
        session,
        { sportType: a.sportType, startDate: a.startDate, movingTime: a.movingTime },
        linkedElsewhereIds.has(a.id)
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .map((a) => ({ ...a, suggestionLabel: labelForScore(a.score) }));

  return NextResponse.json(scored);
}
