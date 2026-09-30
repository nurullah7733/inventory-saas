import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { parseEnumParam, parsePagination } from "@/lib/api/query-params.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { isUniqueViolation } from "@/lib/inventory/master-data.ts";
import { phoneTaken } from "@/lib/people/customer-errors.ts";
import {
  CUSTOMER_COLUMNS,
  findPhoneClash,
  listCustomers,
  toCustomerResponse,
} from "@/lib/people/customer-queries.ts";
import { CUSTOMER_STATUSES, customerSchema } from "@/lib/people/customers.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const status = parseEnumParam(params, "status", CUSTOMER_STATUSES, "all");
    if (!status.ok) return status.response;
    const page = parsePagination(params);
    if (!page.ok) return page.response;

    const search = (params.get("search") ?? "").trim().slice(0, 120);

    const result = await listCustomers(
      auth.scope,
      { status: status.value, search },
      page.value,
    );

    return apiSuccess({
      customers: result.customers,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);

/**
 * Every role can add a customer — staff do it at the counter while making an
 * invoice. Deactivating and deleting are for owners and managers.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = customerSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;

    if (data.phone !== null) {
      const clash = await findPhoneClash(auth.scope, data.phone);
      if (clash) return phoneTaken(clash);
    }

    let created;
    try {
      created = await auth.scope.Customer.select(...CUSTOMER_COLUMNS).create(
        auth.scope.own(data),
      );
    } catch (error) {
      // Two requests raced past the check; the unique index caught it.
      if (isUniqueViolation(error)) return phoneTaken(null);
      throw error;
    }

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "customer.create",
      entityType: "customer",
      entityId: created.id,
      metadata: { name: created.name, phone: created.phone },
    });

    return apiSuccess({ customer: toCustomerResponse(created, 0) }, 201);
  },
);
