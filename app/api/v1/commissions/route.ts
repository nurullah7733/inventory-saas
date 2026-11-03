import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { commissionFilter, commissionPolicy } from "@/lib/commissions/schemas.ts";
import { commissionReport, saveCommissionPolicy } from "@/lib/commissions/service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = commissionFilter.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await commissionReport(auth.scope, auth.user, parsed.data));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}, { verifySession: true });

export const PUT = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = commissionPolicy.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await saveCommissionPolicy(auth.scope, auth.user, parsed.data));
}, { roles: ["shop_owner"], verifySession: true });
