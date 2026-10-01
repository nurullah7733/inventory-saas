import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { paymentSchema, financeListSchema } from "@/lib/finance/schemas.ts";
import { list, save } from "@/lib/finance/payment-service.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";

export const GET = withTenantAuth(async (request, auth) => {
  const parsed = financeListSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await list(auth, parsed.data));
});
export const POST = withTenantAuth(
  async (request, auth) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = paymentSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    return apiSuccess(await save(auth, parsed.data), 201);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
