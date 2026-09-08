import { db } from "@/prisma/db.ts";
import {
  AUTH_RATE_LIMITS,
  clientIp,
  consume,
  reset,
} from "@/lib/api/rate-limit.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import { withPublicRoute } from "@/lib/api/guard.ts";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password.ts";
import {
  buildAuthSessionPayload,
  readClientContext,
} from "@/lib/auth/payload.ts";
import { isUserRole } from "@/lib/auth/roles.ts";
import { loginSchema } from "@/lib/auth/schemas.ts";
import { issueSession } from "@/lib/auth/session.ts";

export const POST = withPublicRoute(async (request: Request) => {
  const ip = clientIp(request.headers);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = loginSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);

  const { email, password, deviceId } = parsed.data;

  // Two buckets, because either alone has a hole. Per-IP stops one attacker
  // spraying many accounts; per-email stops a distributed attempt (botnet,
  // shared NAT) from grinding one account with a fresh IP each request.
  const ipLimit = consume(`login:ip:${ip}`, AUTH_RATE_LIMITS.login);
  const emailLimit = consume(`login:email:${email}`, AUTH_RATE_LIMITS.login);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfter = Math.max(ipLimit.retryAfter, emailLimit.retryAfter);
    return apiError(
      "RATE_LIMITED",
      "Too many login attempts. Please try again later.",
      429,
      { _: [`Retry after ${retryAfter} seconds.`] },
    );
  }

  const user = await db.orm.public.User.select(
    "id",
    "tenantId",
    "name",
    "email",
    "passwordHash",
    "pinHash",
    "role",
    "isActive",
  )
    .where({ email })
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

  // Compare against a fixed hash when the email is unknown, so a miss costs
  // the same ~250ms as a hit. Returning early here instead would let an
  // attacker enumerate registered emails by response time alone.
  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    // One message for both cases — "no such email" would confirm which
    // addresses have accounts.
    return apiError(
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
      401,
    );
  }

  // Checked only AFTER the password verifies: answering "this account is
  // disabled" to an unauthenticated guess would leak that the email exists.
  if (!user.isActive) {
    return apiError(
      "ACCOUNT_DISABLED",
      "This account has been deactivated. Contact your shop owner.",
      403,
    );
  }
  if (user.tenant && !user.tenant.isActive) {
    return apiError(
      "TENANT_SUSPENDED",
      "This workspace is suspended. Contact support to reactivate it.",
      403,
    );
  }
  if (!isUserRole(user.role)) {
    console.error(
      `[auth] user ${user.id} has an unrecognised role: ${user.role}`,
    );
    return apiError(
      "INTERNAL_ERROR",
      "Something went wrong. Please try again.",
      500,
    );
  }

  // Clear the counters so a user who mistyped twice before succeeding is not
  // left near the limit for the rest of the window.
  reset(`login:ip:${ip}`);
  reset(`login:email:${email}`);

  const client = readClientContext(request);
  const session = await issueSession({
    userId: user.id,
    tenantId: user.tenantId,
    deviceId: deviceId ?? null,
    ...client,
  });

  await db.orm.public.User.where({ id: user.id }).update({
    lastLoginAt: new Date().toISOString(),
  });

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
