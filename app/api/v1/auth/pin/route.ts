import { db } from "@/prisma/db.ts";
import { withAuth } from "@/lib/api/guard.ts";
import {
  apiError,
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import type { AuthContext } from "@/lib/auth/context.ts";
import { hashPin, verifyPassword } from "@/lib/auth/password.ts";
import { disablePinSchema, enablePinSchema } from "@/lib/auth/schemas.ts";

export const PUT = withAuth(
  async (request: Request, auth: AuthContext) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = enablePinSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);

    const user = await db.orm.public.User.select("id", "passwordHash")
      .where({ id: auth.user.id })
      .first();
    if (!user)
      return apiError("UNAUTHENTICATED", "Invalid or expired session.", 401);

    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return apiError(
        "INVALID_CREDENTIALS",
        "Your current password is incorrect.",
        401,
      );
    }

    await db.orm.public.User.where({ id: auth.user.id }).update({
      pinHash: await hashPin(parsed.data.pin),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    });

    return apiSuccess({ pinEnabled: true });
  },
  { verifySession: true },
);

export const DELETE = withAuth(
  async (request: Request, auth: AuthContext) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = disablePinSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);

    const user = await db.orm.public.User.select("id", "passwordHash")
      .where({ id: auth.user.id })
      .first();
    if (!user)
      return apiError("UNAUTHENTICATED", "Invalid or expired session.", 401);

    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return apiError(
        "INVALID_CREDENTIALS",
        "Your current password is incorrect.",
        401,
      );
    }

    await db.orm.public.User.where({ id: auth.user.id }).update({
      pinHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    });

    return apiSuccess({ pinEnabled: false });
  },
  { verifySession: true },
);
