import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

// Returns synced Strava activities.
// ?sessionDate=YYYY-MM-DD  — filter to ±2 days around that date
// ?excludeSessionId=...    — exclude activities already linked to that session
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionDate = searchParams.get("sessionDate");
  const excludeSessionId = searchParams.get("excludeSessionId");

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

  // IDs already linked to this session — we'll exclude them from the picker
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

  return NextResponse.json(activities);
}
