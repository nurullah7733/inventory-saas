import { db } from "@/prisma/db.ts";
import { withAuth } from "@/lib/api/guard.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import type { AuthContext } from "@/lib/auth/context.ts";

export const GET = withAuth(async (_request: Request, auth: AuthContext) => {
  const tenant = auth.user.tenantId
    ? await db.orm.public.Tenant.select(
        "id",
        "name",
        "description",
        "logoUrl",
        "email",
        "phone",
        "address",
        "vatPercentage",
        "lowStockThreshold",
        "currencySymbol",
        "invoiceType",
        "subscriptionPlan",
        "subscriptionStatus",
        "trialEndsAt",
        "subscriptionEndsAt",
      )
        .where({ id: auth.user.tenantId })
        .first()
    : null;

  const profile = await db.orm.public.User.select(
    "id",
    "name",
    "email",
    "role",
    "pinHash",
    "lastLoginAt",
    "createdAt",
  )
    .where({ id: auth.user.id })
    .first();

  return apiSuccess({
    user: {
      id: auth.user.id,
      name: profile?.name ?? auth.user.name,
      email: profile?.email ?? auth.user.email,
      role: auth.user.role,
      tenantId: auth.user.tenantId,
      // Only whether a PIN exists — never the hash, and never the PIN.
      pinEnabled: (profile?.pinHash ?? null) !== null,
      lastLoginAt: profile?.lastLoginAt ?? null,
      createdAt: profile?.createdAt ?? null,
    },
    tenant,
  });
});
