import { withPlatformAuth } from "@/lib/api/guard.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import { platformRevenue } from "@/lib/admin/revenue.ts";
export const GET = withPlatformAuth(async (_request, auth) => {
  const response = apiSuccess(await platformRevenue(auth));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
