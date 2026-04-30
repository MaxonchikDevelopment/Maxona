import { NextResponse } from "next/server";
import { buildOAuthUrl } from "@/lib/strava/client";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET() {
  const state = crypto.randomUUID();
  const redirectUri = `${appUrl()}/api/strava/callback`;
  const url = buildOAuthUrl(redirectUri, state);
  const response = NextResponse.redirect(url);
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes — enough to complete the OAuth flow
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
