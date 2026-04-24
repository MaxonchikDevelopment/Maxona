import { NextResponse } from "next/server";
import { getValidAccessToken, fetchRecentActivities } from "@/lib/strava/client";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function POST() {
  const token = await getValidAccessToken(USER_ID);
  if (!token) {
    return NextResponse.json({ error: "Not connected to Strava" }, { status: 401 });
  }

  // Fetch up to 60 most recent activities (2 pages of 30)
  let activities;
  try {
    activities = await fetchRecentActivities(token, undefined, 60);
  } catch (err) {
    console.error("[strava/sync]", err);
    return NextResponse.json({ error: "Strava fetch failed" }, { status: 502 });
  }

  let created = 0;
  let skipped = 0;

  for (const a of activities) {
    const stravaActivityId = String(a.id);
    const existing = await prisma.stravaActivity.findUnique({ where: { stravaActivityId } });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.stravaActivity.create({
      data: {
        userId: USER_ID,
        stravaActivityId,
        stravaAthleteId: String(a.athlete.id),
        name: a.name,
        sportType: a.sport_type ?? a.type,
        startDate: new Date(a.start_date),
        distance: a.distance ?? 0,
        movingTime: a.moving_time ?? 0,
        elapsedTime: a.elapsed_time ?? 0,
        totalElevationGain: a.total_elevation_gain ?? 0,
        averageHeartrate: a.average_heartrate ?? null,
        maxHeartrate: a.max_heartrate ?? null,
        averageSpeed: a.average_speed ?? 0,
        maxSpeed: a.max_speed ?? 0,
        calories: a.calories ?? null,
        description: a.description ?? null,
        rawJson: a as object,
      },
    });
    created++;
  }

  return NextResponse.json({ created, skipped });
}
