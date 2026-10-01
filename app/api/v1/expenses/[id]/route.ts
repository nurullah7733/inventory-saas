import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, apiError, validationError } from "@/lib/api/response.ts";
import { expensePatchSchema } from "@/lib/finance/schemas.ts";
import { find, save, remove } from "@/lib/finance/expense-service.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import {
  isUuid,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";

type Context = { params: Promise<{ id: string }> };
export const GET = withTenantAuth<Context>(async (_request, auth, context) => {
  const { id } = await context.params;
  const row = isUuid(id) ? await find(auth, id) : null;
  return row
    ? apiSuccess({ expense: row })
    : apiError("NOT_FOUND", "Record not found.", 404);
});
export const PATCH = withTenantAuth<Context>(
  async (request, auth, context) => {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError("NOT_FOUND", "Record not found.", 404);
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = expensePatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    return apiSuccess(await save(auth, parsed.data, id));
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
export const DELETE = withTenantAuth<Context>(
  async (_request, auth, context) => {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError("NOT_FOUND", "Record not found.", 404);
    return apiSuccess(await remove(auth, id));
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
