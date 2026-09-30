import { or } from "@prisma/orm-postgres/orm-client";
import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "../inventory/master-data.ts";
import {
  normalizePhone,
  type CustomerResponse,
  type CustomerStatus,
} from "./customers.ts";

export const CUSTOMER_COLUMNS = [
  "id",
  "name",
  "phone",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function findCustomer(scope: TenantScope, id: string) {
  return scope.Customer.select(...CUSTOMER_COLUMNS).where({ id }).first();
}

type CustomerRow = NonNullable<Awaited<ReturnType<typeof findCustomer>>>;

export function toCustomerResponse(
  row: CustomerRow,
  saleCount: number,
): CustomerResponse {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    isActive: row.isActive,
    saleCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Invoices that point at one customer — the rows that block a hard delete. */
export async function customerSaleCount(
  scope: TenantScope,
  id: string,
): Promise<number> {
  const result = await scope.Sale.where({ customerId: id }).aggregate((agg) => ({
    total: agg.count(),
  }));
  return result.total;
}

export interface CustomerListFilter {
  status: CustomerStatus;
  search: string;
}

/**
 * A shop can have thousands of walk-in customers, so unlike suppliers the
 * list is paged and searched on the server. The search matches the name, or
 * the phone with separators ignored ("01711-000" finds "01711000000").
 */
export async function listCustomers(
  scope: TenantScope,
  filter: CustomerListFilter,
  page: { offset: number; pageSize: number },
): Promise<{ customers: CustomerResponse[]; total: number }> {
  let query = scope.Customer;
  if (filter.status !== "all") {
    query = query.where({ isActive: filter.status === "active" });
  }
  if (filter.search !== "") {
    const namePattern = `%${escapeLike(filter.search)}%`;
    const digits = normalizePhone(filter.search);
    query =
      digits === ""
        ? query.where((c) => c.name.ilike(namePattern))
        : query.where((c) =>
            or(c.name.ilike(namePattern), c.phone.ilike(`%${escapeLike(digits)}%`)),
          );
  }

  const [rows, count] = await Promise.all([
    query
      .select(...CUSTOMER_COLUMNS)
      .orderBy([(c) => c.name.asc(), (c) => c.id.asc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    query.aggregate((agg) => ({ total: agg.count() })),
  ]);

  const ids = rows.map((row) => row.id);
  const sales = new Map<string, number>();
  if (ids.length > 0) {
    const groups = await scope.Sale.where((s) => s.customerId.in(ids))
      .groupBy("customerId")
      .aggregate((agg) => ({ total: agg.count() }));
    for (const group of groups) {
      if (group.customerId) sales.set(group.customerId, group.total);
    }
  }

  return {
    customers: rows.map((row) => toCustomerResponse(row, sales.get(row.id) ?? 0)),
    total: count.total,
  };
}

/** Phones are unique per shop (not globally) — two shops can share a customer. */
export function findPhoneClash(
  scope: TenantScope,
  phone: string,
  exceptId?: string,
) {
  let query = scope.Customer.where({ phone });
  if (exceptId) query = query.where((c) => c.id.neq(exceptId));
  return query.select("id", "name").first();
}
