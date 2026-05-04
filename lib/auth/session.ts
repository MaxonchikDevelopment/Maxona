// Pure Web Crypto — no Node.js builtins. Safe in Edge Runtime, Node.js, and server components.
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "maxona_session";
const SESSION_DURATION_SEC = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  userId: string;
  iat: number;
  exp: number;
}

function toBase64Url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  // Falls back to AUTH_PASSWORD so existing deployments work without SESSION_SECRET set.
  // Set SESSION_SECRET explicitly before adding more users.
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_PASSWORD ?? "";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { userId, iat: now, exp: now + SESSION_DURATION_SEC };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64Url(sig)}`;
}

export async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const key = await hmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!valid) return null;
    const payload: SessionPayload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadB64)),
    );
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

// For API route handlers — reads the session cookie from the incoming request.
export async function getSessionUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await verifySessionToken(token))?.userId ?? null;
}

// For API route handlers — returns userId or throws if no valid session.
export async function requireSessionUserIdFromRequest(request: NextRequest): Promise<string> {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

// For server components/pages — reads maxona_session from Next.js cookie store.
export async function getSessionUserIdFromCookies(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await verifySessionToken(token))?.userId ?? null;
}

// For server pages — redirects to /login if no valid session.
export async function requireSessionUserIdFromCookies(): Promise<string> {
  const userId = await getSessionUserIdFromCookies();
  if (!userId) redirect("/login");
  return userId;
}
