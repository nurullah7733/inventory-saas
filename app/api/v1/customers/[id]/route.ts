import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  isUuid,
} from "@/lib/inventory/master-data.ts";
import {
  CUSTOMER_ADMIN_ROLES,
  customerInUse,
  phoneTaken,
} from "@/lib/people/customer-errors.ts";
import {
  CUSTOMER_COLUMNS,
  customerSaleCount,
  findCustomer,
  findPhoneClash,
  toCustomerResponse,
} from "@/lib/people/customer-queries.ts";
import { customerPatchSchema } from "@/lib/people/customers.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = "This customer does not exist.";

/** A malformed id and another shop's id are both simply "not found". */
async function readId(context: RouteParams): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const row = await findCustomer(auth.scope, id);
    if (!row) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const saleCount = await customerSaleCount(auth.scope, id);
    return apiSuccess({ customer: toCustomerResponse(row, saleCount) });
  },
);

/**
 * Edit name / phone (any role), or deactivate / reactivate with `isActive`
 * (owners and managers only).
 */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = customerPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    if (
      patch.isActive !== undefined &&
      !(CUSTOMER_ADMIN_ROLES as readonly string[]).includes(auth.user.role)
    ) {
      return apiError(
        "FORBIDDEN",
        "Only the shop owner or a manager can deactivate or reactivate a customer.",
        403,
      );
    }

    const current = await findCustomer(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const saleCount = await customerSaleCount(auth.scope, id);

    const diff = changedFields(
      { name: current.name, phone: current.phone, isActive: current.isActive },
      patch,
    );
    if (diff.changed.length === 0) {
      return apiSuccess({
        customer: toCustomerResponse(current, saleCount),
        changed: [],
      });
    }

    if (patch.phone !== undefined && patch.phone !== null && patch.phone !== current.phone) {
      const clash = await findPhoneClash(auth.scope, patch.phone, id);
      if (clash) return phoneTaken(clash);
    }

    let updated;
    try {
      updated = await auth.scope.Customer.where({ id })
        .select(...CUSTOMER_COLUMNS)
        .update(patch);
    } catch (error) {
      if (isUniqueViolation(error)) return phoneTaken(null);
      throw error;
    }
    if (!updated) return apiError("NOT_FOUND", NOT_FOUND, 404);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "customer.update",
      entityType: "customer",
      entityId: id,
      metadata: { changed: diff.changed, before: diff.before, after: diff.after },
    });

    return apiSuccess({
      customer: toCustomerResponse(updated, saleCount),
      changed: diff.changed,
    });
  },
);

/**
 * Hard delete only for a customer no invoice references — one added by
 * mistake. Anyone with invoice history gets a 409 that suggests deactivating
 * instead; the `ON DELETE RESTRICT` foreign key on `sales.customer_id` is the
 * guarantee behind the check.
 */
export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const current = await findCustomer(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const saleCount = await customerSaleCount(auth.scope, id);
    if (saleCount > 0) return customerInUse(saleCount);

    try {
      await auth.scope.Customer.where({ id }).delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) return customerInUse(0);
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "customer.delete",
      entityType: "customer",
      entityId: id,
      metadata: { name: current.name, phone: current.phone },
    });

    return apiSuccess({ deleted: { id, name: current.name } });
  },
  { roles: CUSTOMER_ADMIN_ROLES },
);
