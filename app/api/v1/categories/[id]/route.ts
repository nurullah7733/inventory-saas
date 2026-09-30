import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { categoryPatchSchema } from "@/lib/inventory/categories.ts";
import {
  countProductsInCategory,
  findCategory,
  findCategoryNameClash,
  toCategoryResponse,
} from "@/lib/inventory/category-queries.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  isUuid,
  MASTER_DATA_WRITE_ROLES,
  productsPhrase,
} from "@/lib/inventory/master-data.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = "This category does not exist.";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A category named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

function inUse(count: number) {
  return apiError(
    "CONFLICT",
    `Cannot delete: ${productsPhrase(count)} still use this category. Move or remove them first, or archive the category instead.`,
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

    const row = await findCategory(auth.scope, id);
    if (!row) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInCategory(auth.scope, id);
    return apiSuccess({ category: toCategoryResponse(row, productCount) });
  },
);

/** Rename, change the image, or archive / restore (`isActive`). */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = categoryPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    const current = await findCategory(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInCategory(auth.scope, id);

    const diff = changedFields(
      {
        name: current.name,
        imageUrl: current.imageUrl,
        isActive: current.isActive,
      },
      patch,
    );
    if (diff.changed.length === 0) {
      return apiSuccess({
        category: toCategoryResponse(current, productCount),
        changed: [],
      });
    }

    if (patch.name !== undefined && patch.name !== current.name) {
      const clash = await findCategoryNameClash(auth.scope, patch.name, id);
      if (clash) return duplicateName(clash.name);
    }

    let updated;
    try {
      updated = await auth.scope.Category.where({ id })
        .select("id", "name", "imageUrl", "isActive", "createdAt", "updatedAt")
        .update(patch);
    } catch (error) {
      if (isUniqueViolation(error)) return duplicateName(patch.name ?? "");
      throw error;
    }
    if (!updated) return apiError("NOT_FOUND", NOT_FOUND, 404);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "category.update",
      entityType: "category",
      entityId: id,
      metadata: {
        changed: diff.changed,
        before: diff.before,
        after: diff.after,
      },
    });

    return apiSuccess({
      category: toCategoryResponse(updated, productCount),
      changed: diff.changed,
    });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);

/**
 * Hard delete only while the category is empty — the brief's rule. A category
 * with products gets a specific count back and the suggestion to archive it,
 * which hides it from the product form without breaking any product.
 */
export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const current = await findCategory(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInCategory(auth.scope, id);
    if (productCount > 0) return inUse(productCount);

    try {
      await auth.scope.Category.where({ id }).delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) return inUse(Math.max(1, productCount));
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "category.delete",
      entityType: "category",
      entityId: id,
      metadata: { name: current.name },
    });

    return apiSuccess({ deleted: { id, name: current.name } });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
