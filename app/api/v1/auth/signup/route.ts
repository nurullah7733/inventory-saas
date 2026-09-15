import { rlsDb } from "@/lib/db/rls.ts";
import { numeric } from "@/lib/numeric.ts";
import { AUTH_RATE_LIMITS, clientIp, consume } from "@/lib/api/rate-limit.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import { withPublicRoute } from "@/lib/api/guard.ts";
import { hashPassword } from "@/lib/auth/password.ts";
import {
  buildAuthSessionPayload,
  readClientContext,
} from "@/lib/auth/payload.ts";
import { signupSchema } from "@/lib/auth/schemas.ts";
import { issueSession } from "@/lib/auth/session.ts";

const TRIAL_DAYS = 14;

function isUniqueViolation(error: unknown): boolean {
  return JSON.stringify(error ?? "").includes("23505");
}

export const POST = withPublicRoute(async (request: Request) => {
  // Rate-limited by IP: signup is the endpoint an abuser hits to mass-create
  // trial workspaces.
  const limit = consume(
    `signup:${clientIp(request.headers)}`,
    AUTH_RATE_LIMITS.signup,
  );
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many signup attempts. Please try again later.",
      429,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = signupSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);

  const { businessName, name, email, password, phone, deviceId } = parsed.data;

  const existing = await rlsDb().orm.public.User.select("id")
    .where({ email })
    .first();
  if (existing) {
    return apiError(
      "EMAIL_TAKEN",
      "An account with this email already exists.",
      409,
    );
  }

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const trialEndsAt = new Date(
    now + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // `withPublicRoute` already opened one transaction for this request (the
  // RLS session), and tenant + owner + subscription ride it: the three rows
  // commit as a unit, so a failure cannot leave a half-built shop behind.
  const tx = rlsDb();

  let created;
  try {
    const tenant = await tx.orm.public.Tenant.select(
      "id",
      "name",
      "currencySymbol",
      "subscriptionPlan",
      "subscriptionStatus",
      "trialEndsAt",
    ).create({
      name: businessName,
      email,
      phone: phone ?? null,
      // Numeric columns carry no database default in this contract (see the
      // note at the top of contract.prisma), so the API supplies them.
      vatPercentage: numeric("0.00"),
      trialEndsAt,
    });

    const user = await tx.orm.public.User.select(
      "id",
      "name",
      "email",
      "role",
      "tenantId",
    ).create({
      tenantId: tenant.id,
      name,
      email,
      passwordHash,

      role: "shop_owner",
    });

    await tx.orm.public.Subscription.create({
      tenantId: tenant.id,
      plan: "trial",
      status: "trial",
      amount: numeric("0.00"),
      startedAt: new Date(now).toISOString(),
      endsAt: trialEndsAt,
    });

    created = { tenant, user };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError(
        "EMAIL_TAKEN",
        "An account with this email already exists.",
        409,
      );
    }
    throw error;
  }

  const client = readClientContext(request);
  const session = await issueSession({
    userId: created.user.id,
    tenantId: created.tenant.id,
    deviceId: deviceId ?? null,
    ...client,
  });

  const payload = await buildAuthSessionPayload({
    user: {
      id: created.user.id,
      name: created.user.name,
      email: created.user.email,
      role: "shop_owner",
      tenantId: created.tenant.id,
      pinEnabled: false,
    },
    tenant: {
      id: created.tenant.id,
      name: created.tenant.name,
      currencySymbol: created.tenant.currencySymbol,
      subscriptionPlan: created.tenant.subscriptionPlan,
      subscriptionStatus: created.tenant.subscriptionStatus,
      trialEndsAt: created.tenant.trialEndsAt,
    },
    session,
  });

  return apiSuccess(payload, 201);
});
