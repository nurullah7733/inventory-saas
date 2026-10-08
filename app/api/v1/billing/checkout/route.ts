import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { consume } from "@/lib/api/rate-limit.ts";
import { createCheckout } from "@/lib/billing/service.ts";
import { checkoutSchema } from "@/lib/billing/types.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
export const POST = withTenantAuth(async (request, auth) => {
  const limit = consume(`billing-checkout:${auth.tenantId}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return apiError("RATE_LIMITED", "Please wait before starting another checkout.", 429);
  const body = await readTenantSafeJsonBody(request); if (!body.ok) return body.response;
  const parsed = checkoutSchema.safeParse(body.value); if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await createCheckout(auth, parsed.data.plan));
}, { roles: ["shop_owner"], verifySession: true });
