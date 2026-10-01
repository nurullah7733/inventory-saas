import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  CATEGORY_STATUSES,
  categorySchema,
  type CategoryStatus,
} from "@/lib/finance/categories.ts";
import {
  findCategoryNameClash,
  listCategories,
  toCategoryResponse,
} from "@/lib/finance/category-queries.ts";
import {
  isUniqueViolation,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

function duplicateName(name: string) {
  return apiError(
    "CONFLICT",
    `A category named "${name}" already exists.`,
    409,
    { name: ["This name is already in use."] },
  );
}

/**
 * `?status=active` is what the expense form's category dropdown asks for;
 * the Categories screen asks for `all` (the default) to show archived ones.
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const raw = new URL(request.url).searchParams.get("status") ?? "all";
    if (!(CATEGORY_STATUSES as readonly string[]).includes(raw)) {
      return apiError(
        "VALIDATION_ERROR",
        "status must be one of: all, active, archived.",
        422,
        { status: ["Use all, active or archived."] },
      );
    }

    const categories = await listCategories(auth.scope, raw as CategoryStatus);
    return apiSuccess({ categories });
  },
);

export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = categorySchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);

    const { name } = parsed.data;
    const clash = await findCategoryNameClash(auth.scope, name);
    if (clash) return duplicateName(clash.name);

    let created;
    try {
      created = await auth.scope.ExpenseCategory.select(
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
      action: "expense_category.create",
      entityType: "expense_category",
      entityId: created.id,
      metadata: { name: created.name },
    });

    return apiSuccess({ category: toCategoryResponse(created, 0) }, 201);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
