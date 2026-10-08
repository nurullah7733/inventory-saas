import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { getReport } from "@/lib/reports/service.ts";
import { REPORT_KINDS, reportFilterSchema, type ReportKind } from "@/lib/reports/types.ts";

export const GET = withTenantAuth<{ params: Promise<{ kind: string }> }>(async (request, auth, context) => {
  const { kind } = await context.params;
  if (!REPORT_KINDS.includes(kind as ReportKind)) return apiError("NOT_FOUND", "Report not found.", 404);
  const parsed = reportFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const response = apiSuccess({ report: await getReport(auth, kind as ReportKind, parsed.data) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
