import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isUniqueViolation,
  isUuid,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import { planLimitReached, skuTaken } from "@/lib/inventory/product-errors.ts";
import {
  findProduct,
  findSkuClash,
  planProductUsage,
  validateProductRefs,
} from "@/lib/inventory/product-queries.ts";
import {
  productPatchSchema,
  type ProductResponse,
} from "@/lib/inventory/products.ts";
import { numeric } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = "This product does not exist.";

async function readId(context: RouteParams): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

/**
 * The product flattened to the shape a PATCH body uses, for the audit diff.
 * `attributes` is compared as JSON — `changedFields` compares with String(),
 * and every object stringifies to "[object Object]".
 */
function editableSnapshot(product: ProductResponse): Record<string, unknown> {
  return {
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    categoryId: product.category?.id ?? null,
    unitId: product.unit?.id ?? null,
    colorId: product.color?.id ?? null,
    sizeId: product.size?.id ?? null,
    weightId: product.weight?.id ?? null,
    expiryDate: product.expiryDate,
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    attributes: product.attributes === null ? null : JSON.stringify(product.attributes),
    imageUrl: product.imageUrl,
    isDeleted: product.isDeleted,
  };
}

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const product = await findProduct(auth.scope, id);
    if (!product) return apiError("NOT_FOUND", NOT_FOUND, 404);

    return apiSuccess({ product });
  },
);

/**
 * Edit any field, or restore a deleted product with `{ "isDeleted": false }`.
 * `stockQty` is not editable here — stock only moves through Add Stock,
 * Wastage and (later) sales, so the movement ledger always explains it.
 */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = productPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    const current = await findProduct(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const restoring = current.isDeleted && patch.isDeleted === false;
    const otherFields = Object.keys(patch).filter((key) => key !== "isDeleted");
    if (current.isDeleted && otherFields.length > 0 && !restoring) {
      return apiError(
        "CONFLICT",
        "This product is deleted. Restore it before editing.",
        409,
      );
    }

    const before = editableSnapshot(current);
    const diff = changedFields(before, {
      ...patch,
      ...(patch.attributes === undefined
        ? {}
        : { attributes: patch.attributes === null ? null : JSON.stringify(patch.attributes) }),
    });
    if (diff.changed.length === 0) {
      return apiSuccess({ product: current, changed: [] });
    }

    const refErrors = await validateProductRefs(auth.scope, patch, {
      previousCategoryId: current.category?.id ?? null,
    });
    if (refErrors) {
      return apiError("VALIDATION_ERROR", "The submitted data is invalid.", 422, refErrors);
    }

    if (restoring) {
      const usage = await planProductUsage(auth.scope, auth.db);
      if (usage.used >= usage.max) return planLimitReached(usage.max);
    }

    if (patch.sku !== undefined && patch.sku !== current.sku) {
      const clash = await findSkuClash(auth.scope, patch.sku, id);
      if (clash) return skuTaken(patch.sku, clash);
    }

    const { costPrice, sellPrice, ...rest } = patch;
    try {
      await auth.scope.Product.where({ id }).update({
        ...rest,
        ...(costPrice === undefined ? {} : { costPrice: numeric<10, 2>(costPrice) }),
        ...(sellPrice === undefined ? {} : { sellPrice: numeric<10, 2>(sellPrice) }),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return apiError("CONFLICT", "This SKU is already in use.", 409, {
          sku: ["This SKU is already in use."],
        });
      }
      throw error;
    }

    const updated = await findProduct(auth.scope, id);
    if (!updated) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const onlyRestore = restoring && diff.changed.length === 1;
    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: onlyRestore ? "product.restore" : "product.update",
      entityType: "product",
      entityId: id,
      metadata: { changed: diff.changed, before: diff.before, after: diff.after },
    });

    return apiSuccess({ product: updated, changed: diff.changed });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);

/**
 * SOFT delete — `is_deleted = true`, never a row removal. Sales, stock
 * movements and wastage keep pointing at the product (their foreign keys are
 * ON DELETE RESTRICT), so history and reports stay complete; the product just
 * disappears from the product list, pickers and alerts. Restore with PATCH.
 */
export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const current = await findProduct(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    if (current.isDeleted) {
      return apiSuccess({ deleted: { id, name: current.name }, changed: false });
    }

    await auth.scope.Product.where({ id }).update({ isDeleted: true });

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "product.delete",
      entityType: "product",
      entityId: id,
      metadata: { name: current.name, sku: current.sku, stockQty: current.stockQty },
    });

    return apiSuccess({ deleted: { id, name: current.name }, changed: true });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
