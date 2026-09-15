import { rlsDb } from "@/lib/db/rls.ts";
import { AUTH_RATE_LIMITS, clientIp, consume } from "@/lib/api/rate-limit.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import { withPublicRoute } from "@/lib/api/guard.ts";
import { verifyPin } from "@/lib/auth/password.ts";
import {
  buildAuthSessionPayload,
  readClientContext,
} from "@/lib/auth/payload.ts";
import {
  checkPinGate,
  clearPinFailures,
  recordPinFailure,
} from "@/lib/auth/pin.ts";
import { isUserRole } from "@/lib/auth/roles.ts";
import { pinUnlockSchema } from "@/lib/auth/schemas.ts";
import { findActiveSession, rotateSession } from "@/lib/auth/session.ts";

export const POST = withPublicRoute(async (request: Request) => {
  const limit = consume(
    `pin:${clientIp(request.headers)}`,
    AUTH_RATE_LIMITS.pinUnlock,
  );
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many PIN attempts. Please try again later.",
      429,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = pinUnlockSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);

  const lookup = await findActiveSession(parsed.data.refreshToken);
  if (!lookup.ok) {
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
    "role",
    "isActive",
    "pinHash",
    "pinFailedAttempts",
    "pinLockedUntil",
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

  // Gate BEFORE the bcrypt comparison — a locked account should cost an
  // attacker a cheap rejection, not 250ms of our CPU per guess.
  const gate = checkPinGate(user);
  if (gate.status === "not_set") {
    return apiError(
      "PIN_NOT_SET",
      "PIN login is not enabled for this account. Sign in with your password.",
      400,
    );
  }
  if (gate.status === "locked") {
    return apiError(
      "PIN_LOCKED",
      `Too many incorrect PINs. Try again in ${gate.retryAfterSeconds} seconds, or sign in with your password.`,
      429,
      { retryAfterSeconds: [String(gate.retryAfterSeconds)] },
    );
  }

  // Non-null: `checkPinGate` returned "ok", which requires a PIN hash.
  if (!(await verifyPin(parsed.data.pin, user.pinHash!))) {
    const outcome = await recordPinFailure(user.id, user.pinFailedAttempts);
    return apiError(
      outcome.lockedForSeconds > 0 ? "PIN_LOCKED" : "INVALID_CREDENTIALS",
      outcome.lockedForSeconds > 0
        ? `Too many incorrect PINs. Try again in ${outcome.lockedForSeconds} seconds, or sign in with your password.`
        : "Incorrect PIN.",
      outcome.lockedForSeconds > 0 ? 429 : 401,
    );
  }

  await clearPinFailures(user.id);

  // Unlock rotates the session exactly as a refresh does, so a PIN unlock is
  // not a way to keep one refresh token alive indefinitely.
  const client = readClientContext(request);
  const session = await rotateSession(lookup.session, client);

  const payload = await buildAuthSessionPayload({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      pinEnabled: true,
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
