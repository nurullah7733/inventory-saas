import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { staffCreateSchema, staffFilterSchema } from "@/lib/people/users.ts";
import { createStaff, listStaff } from "@/lib/people/user-service.ts";

const options = { roles: ["shop_owner"] as const, verifySession: true };
export const GET = withTenantAuth(async (request, auth) => {
  const parsed = staffFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const result = apiSuccess(await listStaff(auth, parsed.data));
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}, options);
export const POST = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = staffCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await createStaff(auth, parsed.data), 201);
}, options);
