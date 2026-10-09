import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { isUuid } from "@/lib/inventory/master-data.ts";
import { staffPatchSchema } from "@/lib/people/users.ts";
import { updateStaff } from "@/lib/people/user-service.ts";

export const PATCH = withTenantAuth<{ params: Promise<{ id: string }> }>(async (request, auth, context) => {
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("VALIDATION_ERROR", "Invalid user ID.", 422);
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = staffPatchSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await updateStaff(auth, id, parsed.data));
}, { roles: ["shop_owner"], verifySession: true });
