import { parseInstantParam, parsePagination, parseUuidParam } from "../api/query-params.ts";
import { apiError } from "../api/response.ts";

export function purchaseReturnFilters(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["productId", "supplierId", "from", "to", "page", "pageSize"].includes(key)))
    return { ok: false as const, response: apiError("VALIDATION_ERROR", "Unknown filter parameter.", 422) };
  const productId = parseUuidParam(params, "productId"); if (!productId.ok) return productId;
  const supplierId = parseUuidParam(params, "supplierId"); if (!supplierId.ok) return supplierId;
  const from = parseInstantParam(params, "from"); if (!from.ok) return from;
  const to = parseInstantParam(params, "to"); if (!to.ok) return to;
  if (from.value && to.value && Date.parse(from.value) >= Date.parse(to.value))
    return { ok: false as const, response: apiError("VALIDATION_ERROR", "End time must follow start time.", 422) };
  const page = parsePagination(params); if (!page.ok) return page;
  return { ok: true as const, filter: { productId: productId.value, supplierId: supplierId.value, from: from.value, to: to.value }, page: page.value };
}
