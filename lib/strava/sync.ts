import { prisma } from "@/lib/prisma";
import { getValidAccessToken, fetchRecentActivities } from "@/lib/strava/client";
import { mapActivityToDb } from "@/lib/strava/import-activity";

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

  const activities = await fetchRecentActivities(token, undefined, 60);

  let created = 0;
  let skipped = 0;

  for (const a of activities) {
    const stravaActivityId = String(a.id);
    const existing = await prisma.stravaActivity.findUnique({ where: { stravaActivityId } });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.stravaActivity.create({ data: mapActivityToDb(userId, a) });
    created++;
  }

  await prisma.stravaConnection.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return { created, skipped, throttled: false, notConnected: false };
}
