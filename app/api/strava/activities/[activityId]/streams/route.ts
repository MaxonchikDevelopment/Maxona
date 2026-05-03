import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/strava/client";
import { fetchActivityStreams, StravaStreamError } from "@/lib/strava/streams";

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
  console.log(`[strava-stream] start activityId=${activityId}`);

  const activity = await prisma.stravaActivity.findFirst({
    where: { id: activityId, userId: USER_ID },
    select: {
      id: true,
      stravaActivityId: true,
      stream: { select: { fetchedAt: true } },
    },
  });
  if (!activity) {
    return NextResponse.json(
      { ok: false, status: "error", message: "Activity not found." },
      { status: 404 }
    );
  }

  if (activity.stream) {
    console.log(`[strava-stream] existing stream found activityId=${activityId}`);
    return NextResponse.json({
      ok: true,
      status: "existing",
      message: "Stream already saved.",
      hasHeartrate: true,
    });
  }

  const token = await getValidAccessToken(USER_ID);
  if (!token) {
    console.log(`[strava-stream] no token activityId=${activityId}`);
    return NextResponse.json(
      { ok: false, status: "error", message: "Strava not connected." },
      { status: 401 }
    );
  }

  console.log(`[strava-stream] fetching from Strava activityId=${activityId}`);

  let streams;
  try {
    streams = await fetchActivityStreams(activity.stravaActivityId, token);
  } catch (err) {
    const isTimeout = (err as Error).name === "AbortError";
    const statusCode = err instanceof StravaStreamError ? err.statusCode : undefined;

    if (isTimeout) {
      console.log(`[strava-stream] timeout activityId=${activityId}`);
      return NextResponse.json(
        { ok: false, status: "error", message: "Strava stream fetch timed out. Try again later." },
        { status: 504 }
      );
    }
    if (statusCode === 401 || statusCode === 403) {
      console.log(`[strava-stream] auth error status=${statusCode} activityId=${activityId}`);
      return NextResponse.json(
        { ok: false, status: "error", message: "Strava authorization expired. Reconnect Strava." },
        { status: 401 }
      );
    }
    if (statusCode === 429) {
      console.log(`[strava-stream] rate limit activityId=${activityId}`);
      return NextResponse.json(
        { ok: false, status: "error", message: "Strava rate limit reached. Try again later." },
        { status: 429 }
      );
    }
    console.log(`[strava-stream] error status=${statusCode ?? "unknown"} activityId=${activityId}`);
    return NextResponse.json(
      { ok: false, status: "error", message: "Failed to fetch stream from Strava." },
      { status: 500 }
    );
  }

  if (!streams || streams.time.length === 0) {
    console.log(`[strava-stream] no stream data activityId=${activityId}`);
    return NextResponse.json({
      ok: true,
      status: "no_stream",
      message: "No detailed stream available for this activity.",
      hasHeartrate: false,
    });
  }

  const hasHeartrate = streams.heartrate.length > 0;
  const sampleCount = streams.time.length;

  if (!hasHeartrate) {
    console.log(`[strava-stream] no heartrate stream activityId=${activityId}`);
  } else {
    console.log(`[strava-stream] success samples=${sampleCount} hasHeartrate=true activityId=${activityId}`);
  }

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

  return NextResponse.json({
    ok: true,
    status: "created",
    message: "Stream saved.",
    hasHeartrate,
    sampleCount,
  });
}
