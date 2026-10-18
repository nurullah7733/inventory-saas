import type { NextResponse } from "next/server";
import { refreshTokenTtlSeconds } from "../env.ts";

/** HttpOnly refresh-token mirror retained for the existing auth cookie lifecycle.
 * Pages and layouts do not read it; API authentication remains bearer-based.
 */
export const SESSION_COOKIE = "refresh_token";

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** Mirror a newly issued/rotated refresh token for the existing cookie lifecycle. */
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
