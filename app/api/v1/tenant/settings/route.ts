import { changedFields, recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { numeric } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import {
  businessSettingsPatchSchema,
  type BusinessSettingsResponse,
} from "@/lib/tenant/settings.ts";

const SETTINGS_COLUMNS = [
  "name",
  "description",
  "logoUrl",
  "email",
  "phone",
  "address",
  "vatPercentage",
  "lowStockThreshold",
  "currencySymbol",
  "invoiceType",
  "updatedAt",
] as const;

function readSettings(auth: TenantRequestContext) {
  return auth.db.orm.public.Tenant.select(...SETTINGS_COLUMNS)
    .where({ id: auth.tenantId })
    .first();
}

function toResponse(
  row: NonNullable<Awaited<ReturnType<typeof readSettings>>>,
): BusinessSettingsResponse {
  return {
    name: row.name,
    description: row.description,
    logoUrl: row.logoUrl,
    email: row.email,
    phone: row.phone,
    address: row.address,
    // `Numeric<5, 2>` is a branded string at the type level and a plain string
    // at runtime; every client gets the exact decimal rather than a float.
    vatPercentage: String(row.vatPercentage),
    lowStockThreshold: row.lowStockThreshold,
    currencySymbol: row.currencySymbol,
    invoiceType: row.invoiceType,
    updatedAt: row.updatedAt,
  };
}

const MISSING_TENANT = "This workspace no longer exists.";

export const GET = withTenantAuth(
  async (_request: Request, auth: TenantRequestContext) => {
    const row = await readSettings(auth);
    if (!row) return apiError("NOT_FOUND", MISSING_TENANT, 404);

    return apiSuccess({ settings: toResponse(row) });
  },
);

export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = businessSettingsPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);

    const patch = parsed.data;

    const current = await readSettings(auth);
    if (!current) return apiError("NOT_FOUND", MISSING_TENANT, 404);

    const before = toResponse(current);

    const { vatPercentage, ...rest } = patch;
    const data = {
      ...rest,
      ...(vatPercentage === undefined
        ? {}
        : { vatPercentage: numeric<5, 2>(vatPercentage.toFixed(2)) }),
    };

    const diff = changedFields(
      before as unknown as Record<string, unknown>,
      {
        ...rest,
        ...(vatPercentage === undefined
          ? {}
          : { vatPercentage: vatPercentage.toFixed(2) }),
      } as Record<string, unknown>,
    );

    if (diff.changed.length === 0) {
      return apiSuccess({ settings: before, changed: [] });
    }

    await auth.db.orm.public.Tenant.where({ id: auth.tenantId }).update(data);

    const updated = await readSettings(auth);
    if (!updated) return apiError("NOT_FOUND", MISSING_TENANT, 404);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "tenant.settings.update",
      entityType: "tenant",
      entityId: auth.tenantId,
      metadata: {
        changed: diff.changed,
        before: diff.before,
        after: diff.after,
      },
    });

    return apiSuccess({
      settings: toResponse(updated),
      changed: diff.changed,
    });
  },
  { roles: ["shop_owner"] },
);
