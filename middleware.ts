import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/strava/webhook"];

// Legacy validator for old maxona_auth cookies issued before Phase A.
// Remove once all sessions have naturally expired (30 days after Phase A deploy).
async function isLegacyTokenValid(token: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_PASSWORD ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("maxona-session-v1"));
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return token === expected;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // New signed session cookie (Phase A+)
  const sessionCookie = request.cookies.get(SESSION_COOKIE);
  if (sessionCookie) {
    const result = await verifySessionToken(sessionCookie.value);
    if (result) return NextResponse.next();
  }

  // Legacy cookie fallback — supports existing sessions until they expire
  const legacyCookie = request.cookies.get("maxona_auth");
  if (legacyCookie && (await isLegacyTokenValid(legacyCookie.value))) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
