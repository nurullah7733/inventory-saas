import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { parseIntParam, parsePagination } from "@/lib/api/query-params.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";
import { listLowStock } from "@/lib/inventory/stock-queries.ts";

/**
 * Products at or below a stock threshold, emptiest first (out-of-stock
 * included). Deleted products never appear.
 *
 *   ?threshold=  defaults to the shop's Business Settings value
 *   ?search=     name or SKU
 *   ?page=&pageSize=
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const threshold = parseIntParam(params, "threshold", { min: 0, max: 1_000_000 });
    if (!threshold.ok) return threshold.response;
    const page = parsePagination(params, 50);
    if (!page.ok) return page.response;

    const tenant = await auth.db.orm.public.Tenant.select("lowStockThreshold")
      .where({ id: auth.tenantId })
      .first();
    if (!tenant) return apiError("NOT_FOUND", "This workspace no longer exists.", 404);

    const resolved = threshold.value ?? tenant.lowStockThreshold;
    const search = (params.get("search") ?? "").trim().slice(0, 100);

    const result = await listLowStock(
      auth.scope,
      { threshold: resolved, search },
      page.value,
    );

    return apiSuccess({
      threshold: resolved,
      defaultThreshold: tenant.lowStockThreshold,
      products: result.products,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);
