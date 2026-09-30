import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { isUuid } from "@/lib/inventory/master-data.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { getInvoice } from "@/lib/sales/queries.ts";
import { invoiceSchema } from "@/lib/sales/schemas.ts";
import { saveInvoice } from "@/lib/sales/service.ts";

type Context = { params: Promise<{ id: string }> };
export const GET = withTenantAuth<Context>(async (_request, auth, context) => {
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("NOT_FOUND", "Invoice not found.", 404);
  const invoice = await getInvoice(auth.scope, id);
  return invoice ? apiSuccess({ invoice }) : apiError("NOT_FOUND", "Invoice not found.", 404);
});

/** Replace a draft's cart, optionally completing it in the same transaction. */
export const PUT = withTenantAuth<Context>(async (request, auth, context) => {
  const { id } = await context.params;
  if (!isUuid(id)) return apiError("NOT_FOUND", "Invoice not found.", 404);
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = invoiceSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess({ invoice: await saveInvoice(auth.scope, auth.user.id, parsed.data, id) });
});
