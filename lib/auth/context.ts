import { db } from "../../prisma/db.ts";
import {
  InvalidTokenError,
  readBearerToken,
  verifyAccessToken,
} from "./jwt.ts";
import { isUserRole, type UserRole } from "./roles.ts";

export interface AuthUser {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthTenant {
  id: string;
  name: string;
  isActive: boolean;
  subscriptionPlan: "trial" | "basic" | "pro";
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
}

export interface AuthContext {
  user: AuthUser;
  /** Null only for a platform-level super_admin. */
  tenant: AuthTenant | null;
  /** Refresh session this access token was minted from. */
  sessionId: string;
}

export interface TenantAuthContext extends AuthContext {
  tenantId: string;
  tenant: AuthTenant;
}

export type AuthFailure =
  | { reason: "missing_token" }
  | { reason: "invalid_token" }
  | { reason: "user_not_found" }
  | { reason: "user_disabled" }
  | { reason: "tenant_mismatch" }
  | { reason: "tenant_missing" }
  | { reason: "tenant_suspended" }
  | { reason: "session_revoked" };

export type AuthResult =
  { ok: true; context: AuthContext } | { ok: false; failure: AuthFailure };

export interface AuthenticateOptions {
  verifySession?: boolean;
}

export async function authenticate(
  request: Request,
  options: AuthenticateOptions = {},
): Promise<AuthResult> {
  const token = readBearerToken(request.headers);
  if (!token) return { ok: false, failure: { reason: "missing_token" } };

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      return { ok: false, failure: { reason: "invalid_token" } };
    }
    throw error;
  }

  const row = await db.orm.public.User.select(
    "id",
    "tenantId",
    "name",
    "email",
    "role",
    "isActive",
  )
    .where({ id: claims.sub })
    .include("tenant", (tenant) =>
      tenant.select(
        "id",
        "name",
        "isActive",
        "subscriptionPlan",
        "subscriptionStatus",
        "trialEndsAt",
        "subscriptionEndsAt",
      ),
    )
    .first();

  if (!row) return { ok: false, failure: { reason: "user_not_found" } };
  if (!row.isActive) return { ok: false, failure: { reason: "user_disabled" } };

  // The role on the row wins over the role in the token: a demotion must take
  // effect on the next request, not on the next token refresh.
  if (!isUserRole(row.role))
    return { ok: false, failure: { reason: "invalid_token" } };

  // Tenancy in the token must still match tenancy in the database. A mismatch
  // means the token was minted under a different tenancy (or tampered with in
  // a way that survived signing) — fail closed rather than pick a side.
  if ((claims.tid ?? null) !== (row.tenantId ?? null)) {
    return { ok: false, failure: { reason: "tenant_mismatch" } };
  }

  if (options.verifySession) {
    const session = await db.orm.public.RefreshSession.select(
      "id",
      "revokedAt",
      "expiresAt",
    )
      .where({ id: claims.sid })
      .first();
    const live =
      session &&
      session.revokedAt === null &&
      Date.parse(session.expiresAt) > Date.now();
    if (!live) return { ok: false, failure: { reason: "session_revoked" } };
  }

  const tenant = row.tenant
    ? ({
        id: row.tenant.id,
        name: row.tenant.name,
        isActive: row.tenant.isActive,
        subscriptionPlan: row.tenant.subscriptionPlan,
        subscriptionStatus: row.tenant.subscriptionStatus,
        trialEndsAt: row.tenant.trialEndsAt,
        subscriptionEndsAt: row.tenant.subscriptionEndsAt,
      } satisfies AuthTenant)
    : null;

  // A suspended tenant locks out its whole staff, including the owner. The
  // super_admin who suspended it is unaffected — they have no tenant row.
  if (tenant && !tenant.isActive) {
    return { ok: false, failure: { reason: "tenant_suspended" } };
  }

  return {
    ok: true,
    context: {
      user: {
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        email: row.email,
        role: row.role,
      },
      tenant,
      sessionId: claims.sid,
    },
  };
}

/**
 * Narrow a context to a guaranteed tenant scope.
 *
 * A super_admin has no tenant of their own, so they are refused here rather
 * than silently handed someone else's data. Platform-level access to a
 * specific tenant is a separate, explicitly audited path (the Super Admin
 * panel), not an implicit consequence of outranking everyone.
 */
export function requireTenantContext(
  context: AuthContext,
):
  | { ok: true; context: TenantAuthContext }
  | { ok: false; failure: AuthFailure } {
  if (!context.tenant || !context.user.tenantId) {
    return { ok: false, failure: { reason: "tenant_missing" } };
  }
  return {
    ok: true,
    context: {
      ...context,
      tenantId: context.user.tenantId,
      tenant: context.tenant,
    },
  };
}
