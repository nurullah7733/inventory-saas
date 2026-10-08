import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import { purchaseReturnFilters } from "@/lib/inventory/purchase-return-filters.ts";
import { listPurchaseReceipts } from "@/lib/inventory/purchase-return-service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = purchaseReturnFilters(request); if (!parsed.ok) return parsed.response;
  const response = apiSuccess({ ...await listPurchaseReceipts(auth.scope, parsed.filter, parsed.page), page: parsed.page.page, pageSize: parsed.page.pageSize });
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
