import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";
import { purchaseReturnSchema } from "@/lib/inventory/purchase-returns.ts";
import { purchaseReturnFilters } from "@/lib/inventory/purchase-return-filters.ts";
import { createPurchaseReturn, listPurchaseReturns } from "@/lib/inventory/purchase-return-service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = purchaseReturnFilters(request); if (!parsed.ok) return parsed.response;
  const response = apiSuccess({ ...await listPurchaseReturns(auth.scope, parsed.filter, parsed.page), page: parsed.page.page, pageSize: parsed.page.pageSize });
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
export const POST = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request); if (!body.ok) return body.response;
  const parsed = purchaseReturnSchema.safeParse(body.value); if (!parsed.success) return validationError(parsed.error);
  const result = await createPurchaseReturn(auth.scope, auth.user.id, parsed.data);
  return apiSuccess(result, result.replayed ? 200 : 201);
}, { roles: MASTER_DATA_WRITE_ROLES, verifySession: true });
