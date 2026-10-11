import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { brandPatchSchema } from "@/lib/inventory/brands.ts";
import {
  countProductsInBrand,
  findBrand,
  findBrandNameClash,
  toBrandResponse,
} from "@/lib/inventory/brand-queries.ts";
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

const NOT_FOUND = "This brand does not exist.";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A brand named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

function inUse(count: number) {
  return apiError(
    "CONFLICT",
    `Cannot delete: ${productsPhrase(count)} still use this brand. Move or remove them first, or archive the brand instead.`,
    409,
  );
}

async function readId(context: RouteParams): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const row = await findBrand(auth.scope, id);
    if (!row) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInBrand(auth.scope, id);
    return apiSuccess({ brand: toBrandResponse(row, productCount) });
  },
);

export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = brandPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    const current = await findBrand(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInBrand(auth.scope, id);

    const diff = changedFields(
      {
        name: current.name,
        isActive: current.isActive,
      },
      patch,
    );
    if (diff.changed.length === 0) {
      return apiSuccess({
        brand: toBrandResponse(current, productCount),
        changed: [],
      });
    }

    if (patch.name !== undefined && patch.name !== current.name) {
      const clash = await findBrandNameClash(auth.scope, patch.name, id);
      if (clash) return duplicateName(clash.name);
    }

    let updated;
    try {
      updated = await auth.scope.Brand.where({ id })
        .select("id", "name", "isActive", "createdAt", "updatedAt")
        .update(patch);
    } catch (error) {
      if (isUniqueViolation(error)) return duplicateName(patch.name ?? "");
      throw error;
    }
    if (!updated) return apiError("NOT_FOUND", NOT_FOUND, 404);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "brand.update",
      entityType: "brand",
      entityId: id,
      metadata: {
        changed: diff.changed,
        before: diff.before,
        after: diff.after,
      },
    });

    return apiSuccess({
      brand: toBrandResponse(updated, productCount),
      changed: diff.changed,
    });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);

export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const id = await readId(context);
    if (!id) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const current = await findBrand(auth.scope, id);
    if (!current) return apiError("NOT_FOUND", NOT_FOUND, 404);

    const productCount = await countProductsInBrand(auth.scope, id);
    if (productCount > 0) return inUse(productCount);

    try {
      await auth.scope.Brand.where({ id }).delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) return inUse(Math.max(1, productCount));
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "brand.delete",
      entityType: "brand",
      entityId: id,
      metadata: { name: current.name },
    });

    return apiSuccess({ deleted: { id, name: current.name } });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
