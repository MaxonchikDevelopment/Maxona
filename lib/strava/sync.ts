import { prisma } from "@/lib/prisma";
import { getValidAccessToken, fetchRecentActivities } from "@/lib/strava/client";

const THROTTLE_MS = 60 * 60 * 1000; // 60 minutes

export type SyncResult = {
  created: number;
  skipped: number;
  throttled: boolean;
  notConnected: boolean;
};

export async function syncStravaActivities(
  userId: string,
  force = false
): Promise<SyncResult> {
  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!conn) return { created: 0, skipped: 0, throttled: false, notConnected: true };

  if (!force && conn.lastSyncedAt) {
    const elapsed = Date.now() - conn.lastSyncedAt.getTime();
    if (elapsed < THROTTLE_MS) {
      return { created: 0, skipped: 0, throttled: true, notConnected: false };
    }
  }

  const token = await getValidAccessToken(userId);
  if (!token) return { created: 0, skipped: 0, throttled: false, notConnected: true };

  let activities;
  try {
    activities = await fetchRecentActivities(token, undefined, 60);
  } catch (err) {
    throw err;
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
        userId,
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

  await prisma.stravaConnection.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return { created, skipped, throttled: false, notConnected: false };
}
