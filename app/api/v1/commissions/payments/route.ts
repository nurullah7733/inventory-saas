import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { commissionPayment } from "@/lib/commissions/schemas.ts";
import { recordCommissionPayment } from "@/lib/commissions/service.ts";

export const POST = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = commissionPayment.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await recordCommissionPayment(auth.scope, auth.user, parsed.data));
}, { roles: ["shop_owner"], verifySession: true });
