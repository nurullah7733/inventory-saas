import { withPlatformAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { assertPlatform } from "@/lib/admin/service.ts";
import { auditFilterSchema, listAuditLogs } from "@/lib/audit/query.ts";

export const GET = withPlatformAuth(async (request, auth) => {
  assertPlatform(auth);
  const parsed = auditFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await listAuditLogs(null, parsed.data));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
