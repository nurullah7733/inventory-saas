import { withPlatformAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { tenantListSchema } from "@/lib/admin/types.ts";
import { listTenants } from "@/lib/admin/service.ts";
export const GET = withPlatformAuth(async (request, auth) => {
  const parsed = tenantListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await listTenants(auth, parsed.data));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
