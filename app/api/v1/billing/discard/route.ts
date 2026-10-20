import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { consume } from "@/lib/api/rate-limit.ts";
import { discardCheckout } from "@/lib/billing/service.ts";
import { paymentSchema } from "@/lib/billing/types.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

export const POST = withTenantAuth(async (request, auth) => {
  if (!consume(`bkash-discard:${auth.tenantId}`, { limit: 10, windowSeconds: 60 }).allowed)
    return apiError("RATE_LIMITED", "Please wait before trying again.", 429);
  const body = await readTenantSafeJsonBody(request); if (!body.ok) return body.response;
  const parsed = paymentSchema.safeParse(body.value); if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await discardCheckout(auth.tenantId, parsed.data.paymentId, auth.user.id));
}, { roles: ["shop_owner"], verifySession: true });
