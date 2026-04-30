import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/strava/client";
import { fetchActivityStreams } from "@/lib/strava/streams";

const USER_ID = "user_maxon";

type Params = { params: Promise<{ activityId: string }> };

// activityId = internal StravaActivity.id (cuid)

export async function GET(_request: Request, { params }: Params) {
  const { activityId } = await params;

  const activity = await prisma.stravaActivity.findFirst({
    where: { id: activityId, userId: USER_ID },
    select: { id: true, stream: true },
  });
  if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!activity.stream) return NextResponse.json({ hasStream: false });

  const s = activity.stream;
  return NextResponse.json({
    hasStream: true,
    fetchedAt: s.fetchedAt,
    time: s.time,
    heartrate: s.heartrate,
    distance: s.distance,
    velocitySmooth: s.velocitySmooth,
    altitude: s.altitude,
    cadence: s.cadence,
    watts: s.watts,
  });
}

export async function POST(_request: Request, { params }: Params) {
  const { activityId } = await params;

  const activity = await prisma.stravaActivity.findFirst({
    where: { id: activityId, userId: USER_ID },
    select: { id: true, stravaActivityId: true },
  });
  if (!activity) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = await getValidAccessToken(USER_ID);
  if (!token) return NextResponse.json({ error: "Strava not connected" }, { status: 401 });

  const streams = await fetchActivityStreams(activity.stravaActivityId, token);
  if (!streams) {
    return NextResponse.json({ ok: false, reason: "No stream data returned by Strava" });
  }

  const hasHeartrate = streams.heartrate.length > 0;
  const points = streams.time.length;

  await prisma.stravaActivityStream.upsert({
    where: { stravaActivityId: activityId },
    create: {
      userId: USER_ID,
      stravaActivityId: activityId,
      time: streams.time,
      heartrate: streams.heartrate,
      distance: streams.distance,
      velocitySmooth: streams.velocitySmooth,
      altitude: streams.altitude,
      cadence: streams.cadence ?? Prisma.DbNull,
      watts: streams.watts ?? Prisma.DbNull,
      fetchedAt: new Date(),
    },
    update: {
      time: streams.time,
      heartrate: streams.heartrate,
      distance: streams.distance,
      velocitySmooth: streams.velocitySmooth,
      altitude: streams.altitude,
      cadence: streams.cadence ?? Prisma.DbNull,
      watts: streams.watts ?? Prisma.DbNull,
      fetchedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, hasHeartrate, points });
}
