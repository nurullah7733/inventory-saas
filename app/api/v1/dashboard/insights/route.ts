import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { insightsFilterSchema } from "@/lib/dashboard/insights-types.ts";
import { getDashboardInsights } from "@/lib/dashboard/insights-service.ts";
import { canViewFinance } from "@/lib/dashboard/permissions.ts";
import { dashboardDay } from "@/lib/dashboard/types.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = insightsFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const today = dashboardDay(), period = { from: parsed.data.from ?? `${today.slice(0, 7)}-01`, to: parsed.data.to ?? today };
  if (period.to > today) return apiError("VALIDATION_ERROR", "Choose dates up to today in Asia/Dhaka.", 422);
  if ((parsed.data.section === "finance" || parsed.data.section === "dues") && !canViewFinance(auth.user.role)) return apiError("FORBIDDEN", "Manager access required.", 403);
  const response = apiSuccess(await getDashboardInsights(auth, period, parsed.data.section));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
