import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import {
  parseDateParam,
  parseEnumParam,
  parseIntParam,
  parsePagination,
} from "@/lib/api/query-params.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import { addDays } from "@/lib/dates.ts";
import { listNearExpiry } from "@/lib/inventory/stock-queries.ts";

/**
 * Products expiring within `days` of `asOf` — and everything already expired —
 * soonest first, each with `daysLeft` (negative once expired).
 *
 *   ?days=          window, 0–365, default 30
 *   ?asOf=          YYYY-MM-DD, default today in UTC. Clients should send
 *                   their own local date: only they know when the shop's day
 *                   starts, and a shop in Dhaka is six hours ahead of UTC.
 *   ?includeEmpty=  true to include products with no stock left
 *   ?search=        name or SKU
 *   ?page=&pageSize=
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const days = parseIntParam(params, "days", { min: 0, max: 365 });
    if (!days.ok) return days.response;
    const asOfParam = parseDateParam(params, "asOf");
    if (!asOfParam.ok) return asOfParam.response;
    const includeEmpty = parseEnumParam(params, "includeEmpty", ["true", "false"] as const, "false");
    if (!includeEmpty.ok) return includeEmpty.response;
    const page = parsePagination(params, 50);
    if (!page.ok) return page.response;

    const window = days.value ?? 30;
    const asOf = asOfParam.value ?? new Date().toISOString().slice(0, 10);
    const search = (params.get("search") ?? "").trim().slice(0, 100);

    const result = await listNearExpiry(
      auth.scope,
      {
        asOf,
        cutoff: addDays(asOf, window),
        search,
        includeEmpty: includeEmpty.value === "true",
      },
      page.value,
    );

    return apiSuccess({
      asOf,
      days: window,
      products: result.products,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);
