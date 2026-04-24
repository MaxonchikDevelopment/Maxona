const STRAVA_API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname: string; lastname: string };
}

export interface StravaApiActivity {
  id: number;
  athlete: { id: number };
  name: string;
  sport_type: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
  max_speed: number;
  calories?: number;
  description?: string;
}

export function buildOAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "activity:read_all",
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<StravaTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function doRefresh(refreshTokenStr: string): Promise<StravaTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshTokenStr,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const { prisma } = await import("@/lib/prisma");
  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!conn) return null;

  const bufferMs = 5 * 60 * 1000;
  if (conn.expiresAt.getTime() > Date.now() + bufferMs) {
    return conn.accessToken;
  }

  const fresh = await doRefresh(conn.refreshToken);
  await prisma.stravaConnection.update({
    where: { userId },
    data: {
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token,
      expiresAt: new Date(fresh.expires_at * 1000),
    },
  });
  return fresh.access_token;
}

export async function fetchRecentActivities(
  accessToken: string,
  after?: number,
  perPage = 30
): Promise<StravaApiActivity[]> {
  const params = new URLSearchParams({ per_page: String(perPage) });
  if (after !== undefined) params.set("after", String(after));
  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Strava activities fetch failed (${res.status})`);
  }
  return res.json();
}
