import { NextResponse } from "next/server";
import { syncStravaActivities } from "@/lib/strava/sync";

const USER_ID = "user_maxon";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";

  try {
    const result = await syncStravaActivities(USER_ID, force);

    if (result.notConnected) {
      return NextResponse.json({ error: "Not connected to Strava" }, { status: 401 });
    }
    if (result.throttled) {
      return NextResponse.json({ throttled: true, message: "Synced recently — skipped" });
    }

    return NextResponse.json({ created: result.created, skipped: result.skipped });
  } catch (err) {
    console.error("[strava/sync]", err);
    return NextResponse.json({ error: "Strava fetch failed" }, { status: 502 });
  }
}
