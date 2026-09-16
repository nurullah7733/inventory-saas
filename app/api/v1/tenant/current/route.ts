import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext) => {
    const [tenant, productCount, staffCount] = await Promise.all([
      auth.db.orm.public.Tenant.select(
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
        "maxProducts",
        "maxStaff",
        "createdAt",
      )

        .where({ id: auth.tenantId })
        .first(),

      // `.aggregate(...)` is the read terminal for a count. A bare `.count()`
      // on a collection is the include-reducer descriptor used inside
      // `.include(...)` branches — it is not a promise, so awaiting one hands
      // back the descriptor object rather than a number, and `await` on a
      // non-thenable is not a type error.
      auth.scope.Product.where((p) => p.isDeleted.eq(false)).aggregate(
        (agg) => ({ total: agg.count() }),
      ),
      auth.scope.User.where((u) => u.isActive.eq(true)).aggregate((agg) => ({
        total: agg.count(),
      })),
    ]);

    if (!tenant) {
      // The token verified against a user row whose tenant has since been
      // deleted. Nothing sensible to serve, and nothing to leak.
      return apiError("NOT_FOUND", "This workspace no longer exists.", 404);
    }

    return apiSuccess({
      tenant,
      usage: {
        products: productCount.total,
        maxProducts: tenant.maxProducts,
        staff: staffCount.total,
        maxStaff: tenant.maxStaff,
      },
      viewer: {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      },
    });
  },
);
