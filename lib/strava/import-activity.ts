import { prisma } from "@/lib/prisma";
import { getValidAccessToken, fetchActivityDetail } from "@/lib/strava/client";
import type { StravaApiActivity } from "@/lib/strava/client";

export type ActivityDbData = {
  userId: string;
  stravaActivityId: string;
  stravaAthleteId: string;
  name: string;
  sportType: string;
  startDate: Date;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageSpeed: number;
  maxSpeed: number;
  calories: number | null;
  description: string | null;
  rawJson: object;
};

export function mapActivityToDb(userId: string, a: StravaApiActivity): ActivityDbData {
  return {
    userId,
    stravaActivityId: String(a.id),
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
  };
}

export type ImportResult = { ok: boolean; reason?: string; activityId?: string };

export async function importStravaActivityForUser(params: {
  userId: string;
  stravaActivityId: string;
  stravaAthleteId?: string;
}): Promise<ImportResult> {
  const { userId, stravaActivityId, stravaAthleteId } = params;

  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!conn) return { ok: false, reason: "no_connection" };

  // Guard: reject if caller supplied an athlete ID that doesn't match the stored connection.
  // Prevents one athlete's webhook from importing into another user's account.
  if (stravaAthleteId && conn.stravaAthleteId !== stravaAthleteId) {
    return { ok: false, reason: "athlete_mismatch" };
  }

  const token = await getValidAccessToken(userId);
  if (!token) return { ok: false, reason: "no_token" };

  let activity;
  try {
    activity = await fetchActivityDetail(token, stravaActivityId);
  } catch (err) {
    console.error("[import-activity] Strava fetch failed:", err);
    return { ok: false, reason: "fetch_failed" };
  }

  const data = mapActivityToDb(userId, activity);

  try {
    const upserted = await prisma.stravaActivity.upsert({
      where: { stravaActivityId },
      create: data,
      update: {
        name: data.name,
        sportType: data.sportType,
        startDate: data.startDate,
        distance: data.distance,
        movingTime: data.movingTime,
        elapsedTime: data.elapsedTime,
        totalElevationGain: data.totalElevationGain,
        averageHeartrate: data.averageHeartrate,
        maxHeartrate: data.maxHeartrate,
        averageSpeed: data.averageSpeed,
        maxSpeed: data.maxSpeed,
        calories: data.calories,
        description: data.description,
        rawJson: data.rawJson,
      },
    });
    return { ok: true, activityId: upserted.id };
  } catch (err) {
    console.error("[import-activity] upsert failed:", err);
    return { ok: false, reason: "db_error" };
  }
}
