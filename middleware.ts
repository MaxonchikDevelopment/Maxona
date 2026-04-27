import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "maxona_auth";
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/strava/webhook"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie?.value === process.env.AUTH_PASSWORD) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
