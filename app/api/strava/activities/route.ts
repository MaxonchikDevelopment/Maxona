import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scoreCandidate, labelForScore } from "@/lib/strava/suggest";

const USER_ID = "user_maxon";

// Returns synced Strava activities.
// ?sessionDate=YYYY-MM-DD  — filter to ±2 days around that date
// ?excludeSessionId=...    — exclude activities already linked to that session
// ?sessionDurationMin=N    — planned session duration for scoring
// ?sessionNotes=...        — session notes for sport-type inference
// ?sessionSlot=morning|... — preferred slot for time-of-day scoring
// When session context is present, returns scored+sorted results with suggestionLabel.
export async function GET(request: Request) {
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
    from.setUTCDate(from.getUTCDate() - 2);
    const to = new Date(base);
    to.setUTCDate(to.getUTCDate() + 3); // exclusive upper bound
    dateFilter = { gte: from, lte: to };
  }

  // Exclude activities already linked to the current session (already attached)
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
      userId: USER_ID,
      ...(dateFilter ? { startDate: dateFilter } : {}),
      ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
    },
    orderBy: { startDate: "desc" },
    take: 50,
  });

  // Hard-filter activities already linked to OTHER sessions — they're claimed
  const linkedToOther = await prisma.sessionStravaActivityLink.findMany({
    where: {
      stravaActivityId: { in: activities.map((a) => a.id) },
      ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
    },
    select: { stravaActivityId: true },
  });
  const linkedToOtherIds = new Set(linkedToOther.map((l) => l.stravaActivityId));
  const filteredActivities = activities.filter((a) => !linkedToOtherIds.has(a.id));

  // Score when session context is available
  const shouldScore = !!(sessionDate && sessionSlot);
  if (!shouldScore) {
    return NextResponse.json(filteredActivities);
  }

  // (linkedElsewhereIds is now empty since we hard-filtered above — kept for scoring API compat)
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
