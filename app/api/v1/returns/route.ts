import { withTenantAuth } from "@/lib/api/guard.ts";
import { parsePagination } from "@/lib/api/query-params.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { listReturns } from "@/lib/sales/queries.ts";
import { returnSchema } from "@/lib/sales/schemas.ts";
import { createReturn } from "@/lib/sales/service.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const page = parsePagination(new URL(request.url).searchParams);
  if (!page.ok) return page.response;
  return apiSuccess({ ...await listReturns(auth.scope, page.value), page: page.value.page, pageSize: page.value.pageSize });
});
export const POST = withTenantAuth(async (request, auth) => {
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = returnSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess({ return: await createReturn(auth.scope, auth.user.id, parsed.data) }, 201);
});
