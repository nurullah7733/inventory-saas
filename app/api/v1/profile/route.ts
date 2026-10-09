import { withAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { profilePatchSchema } from "@/lib/profile/schema.ts";
import { readProfile, updateProfile } from "@/lib/profile/service.ts";

export const GET = withAuth(async (_request, auth) => {
  const response = apiSuccess(await readProfile(auth));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
export const PATCH = withAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = profilePatchSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await updateProfile(auth, parsed.data, new URL(request.url).origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
