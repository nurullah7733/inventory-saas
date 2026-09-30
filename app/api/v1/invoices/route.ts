import { withTenantAuth } from "@/lib/api/guard.ts";
import { parseEnumParam, parseInstantParam, parsePagination } from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { listInvoices } from "@/lib/sales/queries.ts";
import { invoiceSchema } from "@/lib/sales/schemas.ts";
import { saveInvoice } from "@/lib/sales/service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const params = new URL(request.url).searchParams;
  const page = parsePagination(params);
  if (!page.ok) return page.response;
  const status = parseEnumParam(params, "status", ["draft", "completed"] as const, "completed");
  if (!status.ok) return status.response;
  const from = parseInstantParam(params, "from");
  if (!from.ok) return from.response;
  const to = parseInstantParam(params, "to");
  if (!to.ok) return to.response;
  if (from.value && to.value && from.value >= to.value) return apiError("VALIDATION_ERROR", "End date must follow start date.", 422);
  const search = (params.get("search") ?? "").trim();
  if (search.length > 160) return apiError("VALIDATION_ERROR", "Search is too long.", 422);
  const result = await listInvoices(auth.scope, { status: status.value, search, from: from.value, to: to.value }, page.value);
  return apiSuccess({ ...result, page: page.value.page, pageSize: page.value.pageSize });
});

export const POST = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = invoiceSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess({ invoice: await saveInvoice(auth.scope, auth.user.id, parsed.data) }, 201);
});
