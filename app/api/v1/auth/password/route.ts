import { db } from "@/prisma/db.ts";
import { AUTH_RATE_LIMITS, consume } from "@/lib/api/rate-limit.ts";
import { withAuth } from "@/lib/api/guard.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import type { AuthContext } from "@/lib/auth/context.ts";
import { hashPassword, verifyPassword } from "@/lib/auth/password.ts";
import {
  buildAuthSessionPayload,
  readClientContext,
} from "@/lib/auth/payload.ts";
import { changePasswordSchema } from "@/lib/auth/schemas.ts";
import { issueSession, revokeAllUserSessions } from "@/lib/auth/session.ts";

export const PUT = withAuth(
  async (request: Request, auth: AuthContext) => {
    const limit = consume(
      `password:${auth.user.id}`,
      AUTH_RATE_LIMITS.changePassword,
    );
    if (!limit.allowed) {
      return apiError(
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
        429,
      );
    }

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = changePasswordSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);

    const user = await db.orm.public.User.select(
      "id",
      "tenantId",
      "name",
      "email",
      "role",
      "passwordHash",
      "pinHash",
    )
      .where({ id: auth.user.id })
      .first();
    if (!user)
      return apiError("UNAUTHENTICATED", "Invalid or expired session.", 401);

    if (
      !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))
    ) {
      return apiError(
        "INVALID_CREDENTIALS",
        "Your current password is incorrect.",
        401,
      );
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.orm.public.User.where({ id: user.id }).update({ passwordHash });

    if (!parsed.data.revokeOtherSessions) {
      return apiSuccess({
        passwordChanged: true,
        sessionsRevoked: false,
        tokens: null,
      });
    }

    await revokeAllUserSessions(user.id);

    const client = readClientContext(request);
    const session = await issueSession({
      userId: user.id,
      tenantId: user.tenantId,
      deviceId: null,
      ...client,
    });

    const tenant = user.tenantId
      ? await db.orm.public.Tenant.select(
          "id",
          "name",
          "currencySymbol",
          "subscriptionPlan",
          "subscriptionStatus",
          "trialEndsAt",
        )
          .where({ id: user.tenantId })
          .first()
      : null;

    const payload = await buildAuthSessionPayload({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: auth.user.role,
        tenantId: user.tenantId,
        pinEnabled: user.pinHash !== null,
      },
      tenant,
      session,
    });

    return apiSuccess({
      passwordChanged: true,
      sessionsRevoked: true,
      tokens: payload.tokens,
    });
  },
  { verifySession: true },
);
