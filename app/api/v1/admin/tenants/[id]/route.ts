import { withPlatformAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { tenantIdSchema } from "@/lib/admin/types.ts";
import { tenantDetail } from "@/lib/admin/service.ts";
export const GET = withPlatformAuth<{ params: Promise<{ id: string }> }>(async (_request, auth, context) => {
  const parsed = tenantIdSchema.safeParse((await context.params).id);
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess(await tenantDetail(auth, parsed.data));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
