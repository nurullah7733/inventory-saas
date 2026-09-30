import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isForeignKeyViolation,
  isUuid,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import {
  findSupplier,
  findSupplierNameClash,
  SUPPLIER_COLUMNS,
  supplierUsage,
  toSupplierResponse,
  type SupplierUsage,
} from "@/lib/inventory/supplier-queries.ts";
import { supplierPatchSchema } from "@/lib/inventory/suppliers.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = "This supplier does not exist.";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A supplier named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

function inUse(usage: SupplierUsage) {
  const parts: string[] = [];
  if (usage.stockEntryCount > 0) {
    const n = usage.stockEntryCount;
    parts.push(`${n} stock ${n === 1 ? "entry" : "entries"}`);
  }
  if (usage.paymentCount > 0) {
    const n = usage.paymentCount;
    parts.push(`${n} payment${n === 1 ? "" : "s"}`);
  }
  const what = parts.length > 0 ? parts.join(" and ") : "purchase history";
  return apiError(
    "CONFLICT",
    `Cannot delete: ${what} still reference this supplier. Mark the supplier inactive instead — their history stays intact.`,
    409,
  );
}

/** A malformed id and another shop's id are both simply "not found". */
async function readId(context: RouteParams): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const row = await findSupplier(auth.scope, id);
    if (!row) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const usage = await supplierUsage(auth.scope, id);
    return apiSuccess({ supplier: toSupplierResponse(row, usage) });
  },
);

/** Edit details, or deactivate / reactivate (`isActive`). */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = supplierPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    const current = await findSupplier(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const usage = await supplierUsage(auth.scope, id);

    const diff = changedFields(
      {
        name: current.name,
        phone: current.phone,
        address: current.address,
        isActive: current.isActive,
      },
      patch,
    );
    if (diff.changed.length === 0) {
      return apiSuccess({ supplier: toSupplierResponse(current, usage), changed: [] });
    }

    if (patch.name !== undefined && patch.name !== current.name) {
      const clash = await findSupplierNameClash(auth.scope, patch.name, id);
      if (clash) return duplicateName(clash.name);
    }

    const updated = await auth.scope.Supplier.where({ id })
      .select(...SUPPLIER_COLUMNS)
      .update(patch);
    if (!updated) return apiError("NOT_FOUND", NOT_FOUND, 404);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "supplier.update",
      entityType: "supplier",
      entityId: id,
      metadata: { changed: diff.changed, before: diff.before, after: diff.after },
    });

    return apiSuccess({
      supplier: toSupplierResponse(updated, usage),
      changed: diff.changed,
    });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);

/**
 * Hard delete only for a supplier nothing references — one added by mistake.
 * Anyone with purchase or payment history gets a 409 that says what is in the
 * way and suggests deactivating instead; the `ON DELETE RESTRICT` foreign keys
 * are the guarantee behind the check.
 */
export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const current = await findSupplier(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const usage = await supplierUsage(auth.scope, id);
    if (usage.stockEntryCount > 0 || usage.paymentCount > 0) return inUse(usage);

    try {
      await auth.scope.Supplier.where({ id }).delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) return inUse(usage);
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "supplier.delete",
      entityType: "supplier",
      entityId: id,
      metadata: { name: current.name },
    });

    return apiSuccess({ deleted: { id, name: current.name } });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
