import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { auditFilterSchema, listAuditLogs } from "@/lib/audit/query.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = auditFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await listAuditLogs(auth.tenantId, parsed.data));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { roles: ["shop_owner"], verifySession: true });
