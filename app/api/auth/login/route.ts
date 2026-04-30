import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// Per-instance brute-force guard (resets on cold start — sufficient for single-user MVP)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

function getIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

// Must match expectedSessionToken() in middleware.ts (same HMAC inputs).
function sessionToken(): string {
  return createHmac("sha256", process.env.AUTH_PASSWORD ?? "")
    .update("maxona-session-v1")
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const ip = getIp(request);
  const now = Date.now();

  const entry = loginAttempts.get(ip);
  if (entry) {
    if (now < entry.resetAt && entry.count >= LOGIN_MAX_ATTEMPTS) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    if (now >= entry.resetAt) {
      loginAttempts.delete(ip);
    }
  }

  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (!password || password !== process.env.AUTH_PASSWORD) {
    const current = loginAttempts.get(ip) ?? { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, { count: current.count + 1, resetAt: current.resetAt });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  loginAttempts.delete(ip);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("maxona_auth", sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
