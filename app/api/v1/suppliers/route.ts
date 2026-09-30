import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { parseEnumParam } from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";
import {
  findSupplierNameClash,
  listSuppliers,
  SUPPLIER_COLUMNS,
  toSupplierResponse,
} from "@/lib/inventory/supplier-queries.ts";
import { SUPPLIER_STATUSES, supplierSchema } from "@/lib/inventory/suppliers.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A supplier named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

/**
 * `?status=active` is what the Add Stock supplier dropdown asks for; the
 * Suppliers screen asks for `all` (the default). `?search=` matches the name.
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;
    const status = parseEnumParam(params, "status", SUPPLIER_STATUSES, "all");
    if (!status.ok) return status.response;

    const search = (params.get("search") ?? "").trim().slice(0, 120);
    const suppliers = await listSuppliers(auth.scope, status.value, search);
    return apiSuccess({ suppliers });
  },
);

export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = supplierSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;

    const clash = await findSupplierNameClash(auth.scope, data.name);
    if (clash) return duplicateName(clash.name);

    const created = await auth.scope.Supplier.select(...SUPPLIER_COLUMNS).create(
      auth.scope.own(data),
    );

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "supplier.create",
      entityType: "supplier",
      entityId: created.id,
      metadata: { name: created.name, phone: created.phone },
    });

    return apiSuccess(
      {
        supplier: toSupplierResponse(created, { stockEntryCount: 0, paymentCount: 0 }),
      },
      201,
    );
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
