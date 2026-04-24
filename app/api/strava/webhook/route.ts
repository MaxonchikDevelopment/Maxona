import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Strava expects a 200 fast — save raw event and return immediately
  try {
    const objectType = String(body.object_type ?? "");
    const objectId = String(body.object_id ?? "");
    const aspectType = String(body.aspect_type ?? "");
    const ownerId = String(body.owner_id ?? "");
    const eventTimeSec = typeof body.event_time === "number" ? body.event_time : Math.floor(Date.now() / 1000);

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
    console.error("[strava/webhook] save failed:", err);
    // Still return 200 so Strava doesn't retry
  }

  return NextResponse.json({ ok: true });
}
