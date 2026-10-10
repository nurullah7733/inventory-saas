import type { NextResponse } from "next/server";
import { refreshTokenTtlSeconds } from "../env.ts";

/**
 * The web app's Server Components need to know who is asking on the very
 * first paint, but access tokens live only in browser memory — a server
 * render can never read them. These helpers mirror the CURRENT refresh token
 * into an HttpOnly cookie alongside the localStorage copy the client keeps.
 *
 * This is deliberately NOT an API authentication mechanism: every API route
 * keeps authenticating with `Authorization: Bearer`, exactly as mobile
 * clients do, and neither `proxy.ts` nor any guard ever reads this cookie.
 * Only `lib/server/first-paint.ts` reads it, to re-derive a short-lived
 * access token for first-paint fetches.
 */
export const SESSION_COOKIE = "refresh_token";

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** Mirror a newly issued/rotated refresh token so RSC renders can use it. */
export function setSessionCookie(response: NextResponse, refreshToken: string) {
  response.cookies.set(SESSION_COOKIE, refreshToken, {
    ...cookieBase,
    maxAge: refreshTokenTtlSeconds(),
  });
}

/** Drop the mirror when the client signs out. */
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieBase, maxAge: 0 });
}
