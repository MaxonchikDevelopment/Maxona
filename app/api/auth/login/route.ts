import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// In-memory brute-force guard (resets on cold start — acceptable for private beta)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

function getIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
  secure: process.env.NODE_ENV === "production",
};

export async function POST(request: NextRequest) {
  const ip = getIp(request);
  const now = Date.now();

  const entry = loginAttempts.get(ip);
  if (entry) {
    if (now < entry.resetAt && entry.count >= LOGIN_MAX_ATTEMPTS) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    if (now >= entry.resetAt) loginAttempts.delete(ip);
  }

  function recordFail() {
    const cur = loginAttempts.get(ip) ?? { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, { count: cur.count + 1, resetAt: cur.resetAt });
  }

  const body = await request.json().catch(() => ({}));
  const { login, password } = body;

  if (typeof login !== "string" || typeof password !== "string" || !login || !password) {
    recordFail();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let user: {
    id: string;
    name: string;
    passwordHash: string | null;
    isActive: boolean;
    preferredLanguage: string;
  } | null = null;

  try {
    user = await prisma.user.findUnique({
      where: { login },
      select: { id: true, name: true, passwordHash: true, isActive: true, preferredLanguage: true },
    });
  } catch {
    recordFail();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user || !user.isActive || !user.passwordHash) {
    recordFail();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const passwordValid = await compare(password, user.passwordHash);
  if (!passwordValid) {
    recordFail();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  loginAttempts.delete(ip);

  const token = await createSessionToken(user.id);
  const response = NextResponse.json({
    ok: true,
    name: user.name,
    preferredLanguage: user.preferredLanguage,
  });
  response.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  // Clear legacy single-password cookie on successful new-style login
  response.cookies.delete("maxona_auth");
  return response;
}
