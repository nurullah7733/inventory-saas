import { rlsDb } from "@/lib/db/rls.ts";
import { AUTH_RATE_LIMITS, clientIp, consume } from "@/lib/api/rate-limit.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import { withPublicRoute } from "@/lib/api/guard.ts";
import {
  buildAuthSessionPayload,
  readClientContext,
} from "@/lib/auth/payload.ts";
import { isUserRole } from "@/lib/auth/roles.ts";
import { refreshSchema } from "@/lib/auth/schemas.ts";
import {
  findActiveSession,
  revokeAllUserSessions,
  rotateSession,
} from "@/lib/auth/session.ts";
import { hashRefreshToken } from "@/lib/auth/tokens.ts";

export const POST = withPublicRoute(async (request: Request) => {
  const limit = consume(
    `refresh:${clientIp(request.headers)}`,
    AUTH_RATE_LIMITS.refresh,
  );
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many refresh attempts. Please slow down.",
      429,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = refreshSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);

  const lookup = await findActiveSession(parsed.data.refreshToken);
  if (!lookup.ok) {
    if (lookup.reason === "revoked") {
      const compromised = await rlsDb().orm.public.RefreshSession.select("userId")
        .where({ tokenHash: hashRefreshToken(parsed.data.refreshToken) })
        .first();
      if (compromised) {
        console.warn(
          `[auth] refresh token reuse detected for user ${compromised.userId}; revoking all sessions`,
        );
        await revokeAllUserSessions(compromised.userId);
      }
    }
    // One opaque message for expired / revoked / unknown alike.
    return apiError(
      "UNAUTHENTICATED",
      "Session expired. Please sign in again.",
      401,
    );
  }

  const user = await rlsDb().orm.public.User.select(
    "id",
    "tenantId",
    "name",
    "email",
    "pinHash",
    "role",
    "isActive",
  )
    .where({ id: lookup.session.userId })
    .include("tenant", (tenant) =>
      tenant.select(
        "id",
        "name",
        "currencySymbol",
        "isActive",
        "subscriptionPlan",
        "subscriptionStatus",
        "trialEndsAt",
      ),
    )
    .first();

  if (!user || !user.isActive || !isUserRole(user.role)) {
    return apiError(
      "UNAUTHENTICATED",
      "Session expired. Please sign in again.",
      401,
    );
  }
  if (user.tenant && !user.tenant.isActive) {
    return apiError("TENANT_SUSPENDED", "This workspace is suspended.", 403);
  }

  if ((lookup.session.tenantId ?? null) !== (user.tenantId ?? null)) {
    return apiError(
      "UNAUTHENTICATED",
      "Session expired. Please sign in again.",
      401,
    );
  }

  const client = readClientContext(request);
  const session = await rotateSession(lookup.session, client);

  const payload = await buildAuthSessionPayload({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      pinEnabled: user.pinHash !== null,
    },
    tenant: user.tenant
      ? {
          id: user.tenant.id,
          name: user.tenant.name,
          currencySymbol: user.tenant.currencySymbol,
          subscriptionPlan: user.tenant.subscriptionPlan,
          subscriptionStatus: user.tenant.subscriptionStatus,
          trialEndsAt: user.tenant.trialEndsAt,
        }
      : null,
    session,
  });

  return apiSuccess(payload);
});
