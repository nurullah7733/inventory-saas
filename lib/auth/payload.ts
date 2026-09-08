import { signAccessToken } from "./jwt.ts";
import type { UserRole } from "./roles.ts";
import type { IssuedSession } from "./session.ts";

/**
 * The one response shape every authentication path returns — signup, login,
 * refresh and PIN unlock.
 *
 * Keeping them identical means a mobile client writes a single "store the
 * session" routine and reuses it for all four, instead of four decoders that
 * drift apart.
 */

export interface AuthUserPayload {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  /** Whether this account has a device PIN configured — drives the toggle in
   *  Settings > Profile and tells a mobile client whether to offer PIN unlock
   *  on next launch. The PIN itself is never sent. */
  pinEnabled: boolean;
}

export interface AuthTenantPayload {
  id: string;
  name: string;
  currencySymbol: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

export interface AuthSessionPayload {
  user: AuthUserPayload;
  /** Null for a platform-level super_admin. */
  tenant: AuthTenantPayload | null;
  tokens: {
    accessToken: string;
    /** Seconds until `accessToken` expires, so a client can schedule a refresh
     *  instead of decoding the JWT or waiting for a 401. */
    expiresIn: number;
    tokenType: "Bearer";
    refreshToken: string;
    refreshExpiresAt: string;
  };
}

export async function buildAuthSessionPayload(input: {
  user: AuthUserPayload;
  tenant: AuthTenantPayload | null;
  session: IssuedSession;
}): Promise<AuthSessionPayload> {
  const { token, expiresIn } = await signAccessToken({
    userId: input.user.id,
    tenantId: input.user.tenantId,
    role: input.user.role,
    sessionId: input.session.sessionId,
  });

  return {
    user: input.user,
    tenant: input.tenant,
    tokens: {
      accessToken: token,
      expiresIn,
      tokenType: "Bearer",
      refreshToken: input.session.refreshToken,
      refreshExpiresAt: input.session.expiresAt,
    },
  };
}

/** Client hints recorded on the session row, for the "logged-in devices" list.
 *  Never used for authorisation — all three are client-controlled. */
export function readClientContext(request: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  return {
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null,
  };
}
