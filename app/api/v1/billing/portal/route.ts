import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { consume } from "@/lib/api/rate-limit.ts";
import { createPortal } from "@/lib/billing/service.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { z } from "zod";
export const POST = withTenantAuth(async (request, auth) => {
  const limit = consume(`billing-portal:${auth.tenantId}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return apiError("RATE_LIMITED", "Please wait before opening billing management again.", 429);
  const body = await readTenantSafeJsonBody(request); if (!body.ok) return body.response;
  const parsed = z.object({}).strict().safeParse(body.value); if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await createPortal(auth));
}, { roles: ["shop_owner"], verifySession: true });
