import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  BRAND_STATUSES,
  brandSchema,
  type BrandStatus,
} from "@/lib/inventory/brands.ts";
import {
  findBrandNameClash,
  listBrands,
  toBrandResponse,
} from "@/lib/inventory/brand-queries.ts";
import {
  isUniqueViolation,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A brand named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const raw = new URL(request.url).searchParams.get("status") ?? "all";
    if (!(BRAND_STATUSES as readonly string[]).includes(raw)) {
      return apiError(
        "VALIDATION_ERROR",
        "status must be one of: all, active, archived.",
        422,
        { status: ["Use all, active or archived."] },
      );
    }

    const brands = await listBrands(auth.scope, raw as BrandStatus);
    return apiSuccess({ brands });
  },
);

export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = brandSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const { name } = parsed.data;

    const clash = await findBrandNameClash(auth.scope, name);
    if (clash) return duplicateName(clash.name);

    let created;
    try {
      created = await auth.scope.Brand.select(
        "id",
        "name",
        "isActive",
        "createdAt",
        "updatedAt",
      ).create(auth.scope.own({ name }));
    } catch (error) {
      if (isUniqueViolation(error)) return duplicateName(name);
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "brand.create",
      entityType: "brand",
      entityId: created.id,
      metadata: { name: created.name },
    });

    return apiSuccess({ brand: toBrandResponse(created, 0) }, 201);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
