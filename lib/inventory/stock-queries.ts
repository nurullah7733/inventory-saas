import { or } from "@prisma/orm-postgres/orm-client";
import { daysBetween } from "../dates.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import type {
  AlertProduct,
  MovementType,
  NearExpiryProduct,
  StockMovementResponse,
  WastageResponse,
} from "./stock.ts";

/**
 * Apply a signed change to a product's stock in ONE statement.
 *
 * `stock_qty = stock_qty + $delta` is evaluated by Postgres against the row it
 * has locked, so two tills recording wastage at the same moment cannot both
 * read 5 and both write 3. The `stock_qty + $delta >= 0` guard makes an
 * over-draw affect zero rows instead of going negative — the caller turns
 * that into a 409. A deleted product matches nothing either.
 *
 * Raw SQL because the ORM's `update` takes values, not expressions. `updated_at`
 * is set by hand: that column's value is normally stamped by the Prisma
 * runtime, which a raw statement bypasses.
 *
 * Returns the new stock quantity, or null when nothing was updated.
 */
export async function applyStockDelta(
  scope: TenantScope,
  productId: string,
  delta: number,
  options: { costPrice?: string } = {},
): Promise<number | null> {
  // Two statements rather than one with a nullable parameter: a raw template
  // binds literals only, so "leave cost_price alone" is spelled by omission.
  const statement =
    options.costPrice === undefined
      ? rawSql`
    UPDATE "public"."products"
       SET "stock_qty" = "stock_qty" + ${delta}::int,
           "updated_at" = now()
     WHERE "id" = ${productId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid
       AND "is_deleted" = false
       AND "stock_qty" + ${delta}::int >= 0
    RETURNING "stock_qty" AS "stockQty"`
      : rawSql`
    UPDATE "public"."products"
       SET "stock_qty" = "stock_qty" + ${delta}::int,
           "cost_price" = ${options.costPrice}::numeric,
           "updated_at" = now()
     WHERE "id" = ${productId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid
       AND "is_deleted" = false
       AND "stock_qty" + ${delta}::int >= 0
    RETURNING "stock_qty" AS "stockQty"`;

  const plan = statement.returnsRow({ stockQty: "pg/int4@1" }).build();
  const rows = await rlsDb().query(plan);
  return rows[0]?.stockQty ?? null;
}

// --- Stock movements --------------------------------------------------------

export function selectMovements(collection: TenantScope["StockMovement"]) {
  return collection
    .select("id", "type", "quantity", "unitCost", "note", "createdAt")
    .include("product", (p) => p.select("id", "name", "sku"))
    .include("supplier", (s) => s.select("id", "name"))
    .include("createdByUser", (u) => u.select("id", "name"));
}

type MovementRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectMovements>["first"]>>
>;

export function toMovementResponse(row: MovementRow): StockMovementResponse {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    unitCost: row.unitCost === null ? null : String(row.unitCost),
    note: row.note,
    product: row.product
      ? { id: row.product.id, name: row.product.name, sku: row.product.sku }
      : null,
    supplier: row.supplier ? { id: row.supplier.id, name: row.supplier.name } : null,
    createdBy: row.createdByUser
      ? { id: row.createdByUser.id, name: row.createdByUser.name }
      : null,
    createdAt: row.createdAt,
  };
}

export interface MovementFilter {
  type: MovementType | "all";
  productId: string | null;
  supplierId: string | null;
  from: string | null;
  to: string | null;
}

export async function listMovements(
  scope: TenantScope,
  filter: MovementFilter,
  page: { offset: number; pageSize: number },
): Promise<{ movements: StockMovementResponse[]; total: number }> {
  let query = scope.StockMovement;
  if (filter.type !== "all") query = query.where({ type: filter.type });
  if (filter.productId) query = query.where({ productId: filter.productId });
  if (filter.supplierId) query = query.where({ supplierId: filter.supplierId });
  if (filter.from) {
    const from = filter.from;
    query = query.where((m) => m.createdAt.gte(from));
  }
  if (filter.to) {
    const to = filter.to;
    query = query.where((m) => m.createdAt.lt(to));
  }

  const [rows, count] = await Promise.all([
    selectMovements(query)
      .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    query.aggregate((agg) => ({ total: agg.count() })),
  ]);

  return { movements: rows.map(toMovementResponse), total: count.total };
}

// --- Wastage ----------------------------------------------------------------

export function selectWastage(collection: TenantScope["Wastage"]) {
  return collection
    .select("id", "quantity", "reason", "lossAmount", "createdAt")
    .include("product", (p) => p.select("id", "name", "sku"))
    .include("createdByUser", (u) => u.select("id", "name"));
}

type WastageRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectWastage>["first"]>>
>;

export function toWastageResponse(row: WastageRow): WastageResponse {
  return {
    id: row.id,
    quantity: row.quantity,
    reason: row.reason,
    lossAmount: String(row.lossAmount),
    product: row.product
      ? { id: row.product.id, name: row.product.name, sku: row.product.sku }
      : null,
    createdBy: row.createdByUser
      ? { id: row.createdByUser.id, name: row.createdByUser.name }
      : null,
    createdAt: row.createdAt,
  };
}

export async function listWastage(
  scope: TenantScope,
  filter: { productId: string | null; from: string | null; to: string | null },
  page: { offset: number; pageSize: number },
): Promise<{ wastage: WastageResponse[]; total: number; totalLoss: string }> {
  let query = scope.Wastage;
  if (filter.productId) query = query.where({ productId: filter.productId });
  if (filter.from) {
    const from = filter.from;
    query = query.where((w) => w.createdAt.gte(from));
  }
  if (filter.to) {
    const to = filter.to;
    query = query.where((w) => w.createdAt.lt(to));
  }

  const [rows, totals] = await Promise.all([
    selectWastage(query)
      .orderBy([(w) => w.createdAt.desc(), (w) => w.id.desc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    query.aggregate((agg) => ({
      total: agg.count(),
      loss: agg.sum("lossAmount"),
    })),
  ]);

  return {
    wastage: rows.map(toWastageResponse),
    total: totals.total,
    // SUM over numeric is an exact decimal string, and NULL over zero rows.
    totalLoss: totals.loss === null ? "0.00" : String(totals.loss),
  };
}

// --- Alerts -----------------------------------------------------------------

function selectAlertProducts(collection: TenantScope["Product"]) {
  return collection
    .select("id", "name", "sku", "imageUrl", "stockQty", "costPrice", "expiryDate")
    .include("category", (c) => c.select("id", "name"))
    .include("unit", (u) => u.select("id", "name"));
}

type AlertRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectAlertProducts>["first"]>>
>;

function toAlertProduct(row: AlertRow): AlertProduct {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    imageUrl: row.imageUrl,
    category: row.category ? { id: row.category.id, name: row.category.name } : null,
    unit: row.unit ? { id: row.unit.id, name: row.unit.name } : null,
    stockQty: row.stockQty,
    costPrice: String(row.costPrice),
    expiryDate: row.expiryDate,
  };
}

function searchable(collection: TenantScope["Product"], search: string) {
  if (search === "") return collection;
  const pattern = `%${escapeLike(search)}%`;
  return collection.where((p) => or(p.name.ilike(pattern), p.sku.ilike(pattern)));
}

/** Live products at or below the threshold, emptiest first. */
export async function listLowStock(
  scope: TenantScope,
  filter: { threshold: number; search: string },
  page: { offset: number; pageSize: number },
): Promise<{ products: AlertProduct[]; total: number }> {
  const query = searchable(
    scope.Product.where({ isDeleted: false }).where((p) =>
      p.stockQty.lte(filter.threshold),
    ),
    filter.search,
  );

  const [rows, count] = await Promise.all([
    selectAlertProducts(query)
      .orderBy([(p) => p.stockQty.asc(), (p) => p.name.asc(), (p) => p.id.asc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    query.aggregate((agg) => ({ total: agg.count() })),
  ]);

  return { products: rows.map(toAlertProduct), total: count.total };
}

/**
 * Live products whose expiry date falls on or before `asOf + days` — which
 * includes everything already expired, soonest first. Products with no stock
 * left are skipped unless asked for: there is nothing on the shelf to act on.
 */
export async function listNearExpiry(
  scope: TenantScope,
  filter: { asOf: string; cutoff: string; search: string; includeEmpty: boolean },
  page: { offset: number; pageSize: number },
): Promise<{ products: NearExpiryProduct[]; total: number }> {
  let query = scope.Product.where({ isDeleted: false })
    .where((p) => p.expiryDate.isNotNull())
    .where((p) => p.expiryDate.lte(filter.cutoff));
  if (!filter.includeEmpty) query = query.where((p) => p.stockQty.gt(0));
  query = searchable(query, filter.search);

  const [rows, count] = await Promise.all([
    selectAlertProducts(query)
      .orderBy([(p) => p.expiryDate.asc(), (p) => p.name.asc(), (p) => p.id.asc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    query.aggregate((agg) => ({ total: agg.count() })),
  ]);

  return {
    products: rows.map((row) => {
      const product = toAlertProduct(row);
      const expiryDate = product.expiryDate as string;
      return {
        ...product,
        expiryDate,
        daysLeft: daysBetween(filter.asOf, expiryDate),
      };
    }),
    total: count.total,
  };
}
