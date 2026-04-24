import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/strava/client";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${appUrl()}/settings?strava=denied`);
  }

  try {
    const redirectUri = `${appUrl()}/api/strava/callback`;
    const tokens = await exchangeCode(code, redirectUri);

    if (!tokens.athlete) {
      throw new Error("No athlete in token response");
    }

    await prisma.stravaConnection.upsert({
      where: { userId: USER_ID },
      create: {
        userId: USER_ID,
        stravaAthleteId: String(tokens.athlete.id),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
        scope: "activity:read_all",
      },
      update: {
        stravaAthleteId: String(tokens.athlete.id),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
        scope: "activity:read_all",
      },
    });

    return NextResponse.redirect(`${appUrl()}/settings?strava=connected`);
  } catch (err) {
    console.error("[strava/callback]", err);
    return NextResponse.redirect(`${appUrl()}/settings?strava=error`);
  }
}
