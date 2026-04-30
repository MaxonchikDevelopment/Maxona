import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/strava/client";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function clearState(response: NextResponse): NextResponse {
  response.cookies.delete("strava_oauth_state");
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  // Validate OAuth state to prevent CSRF / token injection
  const stateCookie = request.cookies.get("strava_oauth_state")?.value;
  if (!state || !stateCookie || state !== stateCookie) {
    return clearState(NextResponse.redirect(`${appUrl()}/settings?strava=denied`));
  }

  if (error || !code) {
    return clearState(NextResponse.redirect(`${appUrl()}/settings?strava=denied`));
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

    return clearState(NextResponse.redirect(`${appUrl()}/settings?strava=connected`));
  } catch (err) {
    console.error("[strava/callback]", err);
    return clearState(NextResponse.redirect(`${appUrl()}/settings?strava=error`));
  }
}
