import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { importStravaActivityForUser } from "@/lib/strava/import-activity";

// Strava webhook subscription verification (GET)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token");

  if (mode !== "subscribe" || !challenge) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "";
  if (!expected || verifyToken !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ "hub.challenge": challenge });
}

// Strava webhook event receiver (POST)
// Strava expects a 200 within ~2 seconds — we process synchronously and return 200 regardless.
// Upserts are idempotent so duplicate deliveries (Strava retries) are safe.
//
// Note: subscription_id validation is not implemented because we do not persist the
// subscription ID at OAuth time. Athlete-ID-to-connection matching provides equivalent
// guard against cross-user injection.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const objectType = String(body.object_type ?? "");
  const objectId = String(body.object_id ?? "");
  const aspectType = String(body.aspect_type ?? "");
  const ownerId = String(body.owner_id ?? "");
  const eventTimeSec =
    typeof body.event_time === "number" ? body.event_time : Math.floor(Date.now() / 1000);

  // Persist event record — non-fatal if it fails
  try {
    await prisma.stravaWebhookEvent.create({
      data: {
        objectType,
        objectId,
        aspectType,
        ownerId,
        eventTime: new Date(eventTimeSec * 1000),
        raw: body as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("[strava/webhook] event save failed:", err);
  }

  // Only process activity events with a known owner
  if (objectType === "activity" && objectId && ownerId) {
    // Resolve our userId from Strava's athlete ID.
    // This is the primary guard: we only act on events from athletes we recognise.
    const conn = await prisma.stravaConnection.findFirst({
      where: { stravaAthleteId: ownerId },
      select: { userId: true },
    });

    if (!conn) {
      // Unknown athlete — could be a test event or a stale subscription; ignore safely
      console.log(`[strava/webhook] no connection for athlete ${ownerId} — ignoring`);
    } else if (aspectType === "create" || aspectType === "update") {
      // For create: import the new activity.
      // For update: re-fetch so title/type/privacy changes are reflected locally.
      const result = await importStravaActivityForUser({
        userId: conn.userId,
        stravaActivityId: objectId,
        stravaAthleteId: ownerId,
      });
      if (!result.ok) {
        // Log but do not surface — Strava must receive 200 to stop retrying
        console.error(`[strava/webhook] import failed (${aspectType}):`, result.reason);
      }
    } else if (aspectType === "delete") {
      // We intentionally do not delete locally: the activity may be linked to a session.
      // The user can detach it manually if desired.
      console.log(
        `[strava/webhook] delete event for activity ${objectId} — not removing locally`
      );
    }
  }

  return NextResponse.json({ ok: true });
}
