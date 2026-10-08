import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { dashboardDay, dashboardFilterSchema } from "@/lib/dashboard/types.ts";
import { getDashboardSummary } from "@/lib/dashboard/service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = dashboardFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const now = new Date(), today = dashboardDay(now);
  const period = { from: parsed.data.from ?? `${today.slice(0, 7)}-01`, to: parsed.data.to ?? today };
  if (period.to > today) return apiError("VALIDATION_ERROR", "Choose dates up to today in Asia/Dhaka.", 422);
  const response = apiSuccess({ summary: await getDashboardSummary(auth, period, now) });
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
