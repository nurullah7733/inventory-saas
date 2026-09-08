import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import {
  accessTokenTtlSeconds,
  jwtAudience,
  jwtIssuer,
  jwtSecret,
} from "../env.ts";
import type { UserRole } from "./roles.ts";

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  // tetend id
  tid: string | null;
  role: UserRole;
  sid: string;
}

const ACCESS_TOKEN_TYPE = "access";

export interface MintAccessTokenInput {
  userId: string;
  tenantId: string | null;
  role: UserRole;
  sessionId: string;
}

export async function signAccessToken(input: MintAccessTokenInput): Promise<{
  token: string;
  expiresIn: number;
}> {
  const expiresIn = accessTokenTtlSeconds();
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    tid: input.tenantId,
    role: input.role,
    sid: input.sessionId,
    typ: ACCESS_TOKEN_TYPE,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuer(jwtIssuer())
    .setAudience(jwtAudience())
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(jwtSecret());

  return { token, expiresIn };
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired access token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwtSecret(), {
      issuer: jwtIssuer(),
      audience: jwtAudience(),
      algorithms: ["HS256"],
    }));
  } catch {
    throw new InvalidTokenError();
  }

  if (payload.typ !== ACCESS_TOKEN_TYPE) {
    throw new InvalidTokenError("Token is not an access token");
  }
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new InvalidTokenError("Token is missing subject or session id");
  }
  if (typeof payload.role !== "string") {
    throw new InvalidTokenError("Token is missing a role");
  }
  if (payload.tid !== null && typeof payload.tid !== "string") {
    throw new InvalidTokenError("Token has a malformed tenant claim");
  }

  return payload as AccessTokenClaims;
}

export function readBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
