import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import { billingSummary } from "@/lib/billing/service.ts";
export const GET = withTenantAuth(async (_request, auth) => {
  const response = apiSuccess({ billing: await billingSummary(auth) });
  response.headers.set("Cache-Control", "private, no-store"); return response;
});
