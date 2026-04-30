import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "maxona_auth";
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/strava/webhook"];

// Derives a fixed session token from the auth password using HMAC-SHA256.
// Storing the derived token instead of the raw password means a stolen cookie
// cannot be trivially reversed to recover the password.
async function expectedSessionToken(): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_PASSWORD ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("maxona-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie) {
    const token = await expectedSessionToken();
    if (cookie.value === token) {
      return NextResponse.next();
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
