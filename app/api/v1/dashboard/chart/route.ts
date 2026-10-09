import { z } from "zod";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { dashboardDay, dashboardFilterSchema } from "@/lib/dashboard/types.ts";
import { getSalesChart } from "@/lib/dashboard/insights-service.ts";

const schema = dashboardFilterSchema.safeExtend({ window: z.enum(["selected", "7d", "30d", "12m"]).default("selected") });
export const GET = withTenantAuth(async (request, auth) => {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const today = dashboardDay(), period = { from: parsed.data.from ?? `${today.slice(0, 7)}-01`, to: parsed.data.to ?? today };
  if (period.to > today) return apiError("VALIDATION_ERROR", "Choose dates up to today in Asia/Dhaka.", 422);
  const response = apiSuccess(await getSalesChart(auth, period, parsed.data.window));
  response.headers.set("Cache-Control", "private, no-store"); return response;
}, { verifySession: true });
