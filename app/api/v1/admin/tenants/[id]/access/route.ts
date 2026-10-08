import { withPlatformAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { consume } from "@/lib/api/rate-limit.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { tenantIdSchema, accessSchema } from "@/lib/admin/types.ts";
import { setTenantAccess } from "@/lib/admin/service.ts";
export const PATCH = withPlatformAuth<{ params: Promise<{ id: string }> }>(async (request, auth, context) => {
  if (!consume(`admin-access:${auth.user.id}`, { limit: 30, windowSeconds: 60 }).allowed)
    return apiError("RATE_LIMITED", "Please wait before changing more workspaces.", 429);
  const id = tenantIdSchema.safeParse((await context.params).id);
  if (!id.success) return validationError(id.error);
  const body = await readTenantSafeJsonBody(request); if (!body.ok) return body.response;
  const parsed = accessSchema.safeParse(body.value); if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await setTenantAccess(auth, id.data, parsed.data));
}, { verifySession: true });
