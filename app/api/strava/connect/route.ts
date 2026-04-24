import { NextResponse } from "next/server";
import { buildOAuthUrl } from "@/lib/strava/client";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET() {
  const redirectUri = `${appUrl()}/api/strava/callback`;
  const url = buildOAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
