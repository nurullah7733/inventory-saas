import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import type { SupplierResponse, SupplierStatus } from "./suppliers.ts";

export const SUPPLIER_COLUMNS = [
  "id",
  "name",
  "phone",
  "address",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function findSupplier(scope: TenantScope, id: string) {
  return scope.Supplier.select(...SUPPLIER_COLUMNS).where({ id }).first();
}

type SupplierRow = NonNullable<Awaited<ReturnType<typeof findSupplier>>>;

export interface SupplierUsage {
  stockEntryCount: number;
  paymentCount: number;
}

export function toSupplierResponse(
  row: SupplierRow,
  usage: SupplierUsage,
): SupplierResponse {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    stockEntryCount: usage.stockEntryCount,
    paymentCount: usage.paymentCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** What still points at one supplier — the rows that block a hard delete. */
export async function supplierUsage(
  scope: TenantScope,
  id: string,
): Promise<SupplierUsage> {
  const [movements, payments] = await Promise.all([
    scope.StockMovement.where({ supplierId: id }).aggregate((agg) => ({
      total: agg.count(),
    })),
    scope.SupplierPayment.where({ supplierId: id }).aggregate((agg) => ({
      total: agg.count(),
    })),
  ]);
  return { stockEntryCount: movements.total, paymentCount: payments.total };
}

export async function listSuppliers(
  scope: TenantScope,
  status: SupplierStatus,
  search: string,
): Promise<SupplierResponse[]> {
  let query = scope.Supplier.select(...SUPPLIER_COLUMNS);
  if (status !== "all") query = query.where({ isActive: status === "active" });
  if (search !== "") {
    query = query.where((s) => s.name.ilike(`%${escapeLike(search)}%`));
  }

  const [rows, movementGroups, paymentGroups] = await Promise.all([
    query.orderBy([(s) => s.name.asc(), (s) => s.id.asc()]).all(),
    scope.StockMovement.where((m) => m.supplierId.isNotNull())
      .groupBy("supplierId")
      .aggregate((agg) => ({ total: agg.count() })),
    scope.SupplierPayment.groupBy("supplierId").aggregate((agg) => ({
      total: agg.count(),
    })),
  ]);

  const movements = new Map<string, number>();
  for (const group of movementGroups) {
    if (group.supplierId) movements.set(group.supplierId, group.total);
  }
  const payments = new Map<string, number>();
  for (const group of paymentGroups) payments.set(group.supplierId, group.total);

  return rows.map((row) =>
    toSupplierResponse(row, {
      stockEntryCount: movements.get(row.id) ?? 0,
      paymentCount: payments.get(row.id) ?? 0,
    }),
  );
}

/** Case-insensitive, like category names: "Rahim Traders" = "rahim traders". */
export function findSupplierNameClash(
  scope: TenantScope,
  name: string,
  exceptId?: string,
) {
  let query = scope.Supplier.where((s) => s.name.ilike(escapeLike(name)));
  if (exceptId) query = query.where((s) => s.id.neq(exceptId));
  return query.select("id", "name").first();
}
