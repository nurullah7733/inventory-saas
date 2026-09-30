import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  isUuid,
  MASTER_DATA_WRITE_ROLES,
  productsPhrase,
} from "@/lib/inventory/master-data.ts";
import {
  countProductsUsing,
  findVariantNameClash,
  findVariantOption,
  VARIANT_ENTITY,
  variantCollection,
} from "@/lib/inventory/variant-queries.ts";
import {
  isVariantKind,
  VARIANT_KIND_LABELS,
  variantOptionSchema,
  type VariantKind,
} from "@/lib/inventory/variants.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

interface RouteParams {
  params: Promise<{ kind: string; id: string }>;
}

/**
 * Resolve the path to a kind and an option id, or the 404 to send instead.
 * An id belonging to another shop is a 404 as well: the scope (and RLS below
 * it) simply never finds it, so its existence is not confirmed either.
 */
async function resolveTarget(context: RouteParams) {
  const { kind, id } = await context.params;
  if (!isVariantKind(kind)) {
    return {
      ok: false as const,
      response: apiError(
        "NOT_FOUND",
        "Unknown variant list. Use colors, sizes, weights or units.",
        404,
      ),
    };
  }
  if (!isUuid(id)) return { ok: false as const, response: notFound(kind) };
  return { ok: true as const, kind, id };
}

function notFound(kind: VariantKind) {
  return apiError(
    "NOT_FOUND",
    `This ${VARIANT_KIND_LABELS[kind].singular.toLowerCase()} does not exist.`,
    404,
  );
}

function duplicateName(kind: VariantKind, name: string) {
  return apiError(
    "CONFLICT",
    `A ${VARIANT_KIND_LABELS[kind].singular.toLowerCase()} named "${name}" already exists.`,
    409,
    { name: ["This name is already in the list."] },
  );
}

function inUse(kind: VariantKind, count: number) {
  const label = VARIANT_KIND_LABELS[kind].singular.toLowerCase();
  return apiError(
    "CONFLICT",
    `Cannot delete: ${productsPhrase(count)} still use this ${label}. Change those products to another ${label} first.`,
    409,
  );
}

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const target = await resolveTarget(context);
    if (!target.ok) return target.response;

    const row = await findVariantOption(auth.scope, target.kind, target.id);
    if (!row) return notFound(target.kind);

    const productCount = await countProductsUsing(
      auth.scope,
      target.kind,
      target.id,
    );
    return apiSuccess({ option: { ...row, productCount } });
  },
);

/** Rename. Products reference the option by id, so they follow the rename. */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const target = await resolveTarget(context);
    if (!target.ok) return target.response;
    const { kind, id } = target;

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = variantOptionSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const { name } = parsed.data;

    const current = await findVariantOption(auth.scope, kind, id);
    if (!current) return notFound(kind);

    const productCount = await countProductsUsing(auth.scope, kind, id);

    if (current.name === name) {
      return apiSuccess({ option: { ...current, productCount }, changed: [] });
    }

    // A case-only rename ("black" → "Black") clashes with nothing but itself.
    const clash = await findVariantNameClash(auth.scope, kind, name, id);
    if (clash) return duplicateName(kind, clash.name);

    let updated;
    try {
      updated = await variantCollection(auth.scope, kind)
        .where({ id })
        .select("id", "name", "createdAt")
        .update({ name });
    } catch (error) {
      if (isUniqueViolation(error)) return duplicateName(kind, name);
      throw error;
    }
    if (!updated) return notFound(kind);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: `${VARIANT_ENTITY[kind]}.update`,
      entityType: VARIANT_ENTITY[kind],
      entityId: id,
      metadata: {
        changed: ["name"],
        before: { name: current.name },
        after: { name: updated.name },
      },
    });

    return apiSuccess({
      option: { ...updated, productCount },
      changed: ["name"],
    });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);

/**
 * Hard delete, allowed only while no product points at the option — the
 * brief's referential-integrity rule. The count gives a specific message;
 * the `ON DELETE RESTRICT` foreign key is the real guarantee behind it.
 */
export const DELETE = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const target = await resolveTarget(context);
    if (!target.ok) return target.response;
    const { kind, id } = target;

    const current = await findVariantOption(auth.scope, kind, id);
    if (!current) return notFound(kind);

    const productCount = await countProductsUsing(auth.scope, kind, id);
    if (productCount > 0) return inUse(kind, productCount);

    try {
      await variantCollection(auth.scope, kind).where({ id }).delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return inUse(kind, Math.max(1, productCount));
      }
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: `${VARIANT_ENTITY[kind]}.delete`,
      entityType: VARIANT_ENTITY[kind],
      entityId: id,
      metadata: { name: current.name },
    });

    return apiSuccess({ deleted: { id, name: current.name } });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
