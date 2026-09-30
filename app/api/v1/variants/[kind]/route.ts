import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isUniqueViolation,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import {
  findVariantNameClash,
  listVariantOptions,
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
  params: Promise<{ kind: string }>;
}

function unknownKind() {
  return apiError(
    "NOT_FOUND",
    "Unknown variant list. Use colors, sizes, weights or units.",
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

/** Every option in one list, A→Z, with how many products use each. */
export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const { kind } = await context.params;
    if (!isVariantKind(kind)) return unknownKind();

    const options = await listVariantOptions(auth.scope, kind);
    return apiSuccess({ kind, options });
  },
);

export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const { kind } = await context.params;
    if (!isVariantKind(kind)) return unknownKind();

    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = variantOptionSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const { name } = parsed.data;

    const clash = await findVariantNameClash(auth.scope, kind, name);
    if (clash) return duplicateName(kind, clash.name);

    let created;
    try {
      created = await variantCollection(auth.scope, kind)
        .select("id", "name", "createdAt")
        .create(auth.scope.own({ name }));
    } catch (error) {
      if (isUniqueViolation(error)) return duplicateName(kind, name);
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: `${VARIANT_ENTITY[kind]}.create`,
      entityType: VARIANT_ENTITY[kind],
      entityId: created.id,
      metadata: { name: created.name },
    });

    return apiSuccess(
      { option: { ...created, productCount: 0 } },
      201,
    );
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
