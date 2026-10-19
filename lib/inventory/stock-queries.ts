import { or } from "@prisma/orm-postgres/orm-client";
import { daysBetween } from "../dates.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { numeric } from "../numeric.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import { lockCatalogCodes } from "./catalog-codes.ts";
import { allocateStockArticles } from "./article-labels.ts";
import type {
  AlertProduct,
  MovementType,
  NearExpiryProduct,
  StockMovementResponse,
  WastageResponse,
} from "./stock.ts";

/**
 * Which row a stock change applies to. The variant row owns the truth; the
 * product's `stock_qty` is the denormalized total across its variants and is
 * maintained in the same two statements.
 */
export interface StockTarget {
  productId: string;
  variantId: string;
}

/**
 * Apply a signed change to a VARIANT's stock in ONE statement, and roll the
 * product's denormalized total forward in a second.
 *
 * `stock_qty = stock_qty + $delta` is evaluated by Postgres against the row it
 * has locked, so two tills recording wastage at the same moment cannot both
 * read 5 and both write 3. The `stock_qty + $delta >= 0` guard makes an
 * over-draw affect zero rows instead of going negative — the caller turns
 * that into a 409. An inactive variant matches nothing either.
 *
 * Raw SQL because the ORM's `update` takes values, not expressions. `updated_at`
 * is set by hand: that column's value is normally stamped by the Prisma
 * runtime, which a raw statement bypasses.
 *
 * With `costPrice`, the variant's (and the product's) cost price is set to it
 * in the same breath — "also set the cost price to this unit cost".
 *
 * Returns the variant's new stock quantity, or null when nothing was updated.
 */
export async function applyStockDelta(
  scope: TenantScope,
  target: StockTarget,
  delta: number,
  options: { costPrice?: string } = {},
): Promise<number | null> {
  // Match product/variant edits: catalog lock before stock row locks.
  if (delta > 0) await lockCatalogCodes(scope);
  // Two statements rather than one with a nullable parameter: a raw template
  // binds literals only, so "leave cost_price alone" is spelled by omission.
  // stock_qty is numeric(12,3) — fractional for measured units.
  const variantStatement =
    options.costPrice === undefined
      ? rawSql`
    UPDATE "public"."product_variants"
       SET "stock_qty" = "stock_qty" + ${delta}::numeric,
           "updated_at" = now()
     WHERE "id" = ${target.variantId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid
       AND "is_active" = true
       AND EXISTS (
         SELECT 1 FROM "public"."products" AS "p"
         WHERE "p"."id" = "product_variants"."product_id"
           AND "p"."tenant_id" = ${scope.tenantId}::uuid
           AND "p"."is_deleted" = false
       )
       AND "stock_qty" + ${delta}::numeric >= 0
    RETURNING "stock_qty" AS "stockQty"`
      : rawSql`
    UPDATE "public"."product_variants"
       SET "stock_qty" = "stock_qty" + ${delta}::numeric,
           "cost_price" = ${options.costPrice}::numeric,
           "updated_at" = now()
     WHERE "id" = ${target.variantId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid
       AND "is_active" = true
       AND EXISTS (
         SELECT 1 FROM "public"."products" AS "p"
         WHERE "p"."id" = "product_variants"."product_id"
           AND "p"."tenant_id" = ${scope.tenantId}::uuid
           AND "p"."is_deleted" = false
       )
       AND "stock_qty" + ${delta}::numeric >= 0
    RETURNING "stock_qty" AS "stockQty"`;

  const rows = await rlsDb()
    .query(variantStatement.returnsRow({ stockQty: "pg/numeric@1" }).build());
  const stockQty = rows[0]?.stockQty;
  if (stockQty === undefined || stockQty === null) return null;

  // The variant guard above is authoritative; the product total just follows.
  const productStatement =
    options.costPrice === undefined
      ? rawSql`
    UPDATE "public"."products"
       SET "stock_qty" = "stock_qty" + ${delta}::numeric,
           "updated_at" = now()
     WHERE "id" = ${target.productId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid`
      : rawSql`
    UPDATE "public"."products"
       SET "stock_qty" = "stock_qty" + ${delta}::numeric,
           "cost_price" = ${options.costPrice}::numeric,
           "updated_at" = now()
     WHERE "id" = ${target.productId}::uuid
       AND "tenant_id" = ${scope.tenantId}::uuid`;
  await rlsDb().execute(productStatement.affectedCount().build());

  return Number(stockQty);
}

// --- Variant resolution -----------------------------------------------------

export interface ResolvedVariant {
  id: string;
  productId: string;
  label: string;
  sku: string;
  costPrice: string;
  sellPrice: string;
  stockQty: number;
  isActive: boolean;
}

export type VariantResolution =
  | { ok: true; variant: ResolvedVariant }
  | { ok: false; field: "productId" | "variantId"; message: string };

const VARIANT_COLUMNS = [
  "id",
  "productId",
  "label",
  "sku",
  "costPrice",
  "sellPrice",
  "stockQty",
  "isActive",
] as const;

/**
 * Pick the variant a write applies to. A client may omit `variantId` only for
 * a single-variant product (the plain case): the Default variant is then
 * implied. A multi-variant product without an explicit choice is an error —
 * guessing a size would silently deduct the wrong shelf.
 */
export async function resolveVariant(
  scope: TenantScope,
  productId: string,
  variantId: string | null,
): Promise<VariantResolution> {
  if (variantId !== null) {
    const variant = await scope.ProductVariant.select(...VARIANT_COLUMNS)
      .where({ id: variantId, productId })
      .first();
    if (!variant) {
      return {
        ok: false,
        field: "variantId",
        message: "This variant does not belong to the chosen product.",
      };
    }
    if (!variant.isActive) {
      return { ok: false, field: "variantId", message: "This variant is inactive." };
    }
    return {
      ok: true,
      variant: {
        ...variant,
        costPrice: String(variant.costPrice),
        sellPrice: String(variant.sellPrice),
        stockQty: Number(variant.stockQty),
      },
    };
  }

  const variants = await scope.ProductVariant.select(...VARIANT_COLUMNS)
    .where({ productId, isActive: true })
    .all();
  if (variants.length === 0) {
    return {
      ok: false,
      field: "productId",
      message: "This product has no active variant.",
    };
  }
  if (variants.length > 1) {
    return {
      ok: false,
      field: "variantId",
      message: "This product has multiple sizes or colors. Choose one.",
    };
  }
  const [variant] = variants;
  return {
    ok: true,
    variant: {
      ...variant,
      costPrice: String(variant.costPrice),
      sellPrice: String(variant.sellPrice),
      stockQty: Number(variant.stockQty),
    },
  };
}

/**
 * The product's unit of measure with its measured flag — the input to the
 * "decimals only for measured units" check (`quantityErrorForUnit`).
 */
export async function productUnit(
  scope: TenantScope,
  productId: string,
): Promise<{ id: string; name: string; measured: boolean } | null> {
  const row = await scope.Product
    .select("id")
    .include("unit", (u) => u.select("id", "name", "measured"))
    .where({ id: productId })
    .first();
  return row?.unit
    ? { id: row.unit.id, name: row.unit.name, measured: row.unit.measured }
    : null;
}

/**
 * Create the ledger row for goods received. Shared by Add Stock and the
 * opening stock inside product create, so the "in" movement is written
 * exactly one way.
 */
export async function recordStockIn(
  scope: TenantScope,
  userId: string,
  input: {
    productId: string;
    variantId: string;
    supplierId: string | null;
    quantity: number;
    unitCost: string;
    /** ISO timestamp, or null for "now". */
    receivedAt: string | null;
    note: string | null;
  },
): Promise<{ id: string }> {
  const movement = await scope.StockMovement.select("id").create(
    scope.own({
      productId: input.productId,
      variantId: input.variantId,
      supplierId: input.supplierId,
      type: "in" as const,
      quantity: numeric<12, 3>(input.quantity),
      unitCost: numeric<10, 2>(input.unitCost),
      note: input.note,
      createdBy: userId,
      ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
    }),
  );
  const unit = await productUnit(scope, input.productId);
  if (unit?.measured) {
    // Measurements aren't a package count. Keep one stable variant code.
    const existing = await scope.ArticleLabel.select("id").where({ variantId: input.variantId }).first();
    if (!existing) await allocateStockArticles(scope, input.variantId, 1, movement.id);
  } else {
    await allocateStockArticles(scope, input.variantId, input.quantity, movement.id);
  }
  return movement;
}

// --- Stock movements --------------------------------------------------------

export function selectMovements(collection: TenantScope["StockMovement"]) {
  return collection
    .select("id", "type", "quantity", "unitCost", "sourceMovementId", "note", "createdAt")
    .include("product", (p) => p.select("id", "name", "sku"))
    .include("variant", (v) => v.select("id", "label"))
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
    quantity: Number(row.quantity),
    unitCost: row.unitCost === null ? null : String(row.unitCost),
    sourceMovementId: row.sourceMovementId,
    note: row.note,
    product: row.product
      ? { id: row.product.id, name: row.product.name, sku: row.product.sku }
      : null,
    variant: row.variant ? { id: row.variant.id, name: row.variant.label } : null,
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
  groupByProduct = false,
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

  if (groupByProduct) {
    // Page products first so a product's entries never straddle pages.
    const groups = await rlsDb().query(rawSql`SELECT product_id AS "productId", count(*) OVER ()::int AS total
      FROM public.stock_movements
      WHERE tenant_id = ${scope.tenantId}::uuid
        AND (${filter.type} = 'all' OR type = ${filter.type})
        AND (${filter.productId ?? ""} = '' OR product_id::text = ${filter.productId ?? ""})
        AND (${filter.supplierId ?? ""} = '' OR supplier_id::text = ${filter.supplierId ?? ""})
        AND created_at >= ${filter.from ?? "0001-01-01T00:00:00Z"}::timestamptz
        AND created_at < ${filter.to ?? "9999-12-31T23:59:59Z"}::timestamptz
      GROUP BY product_id
      ORDER BY max(created_at) DESC, product_id DESC
      OFFSET ${page.offset} LIMIT ${page.pageSize}`
      .returnsRow({ productId: "pg/uuid@1", total: "pg/int4@1" }).build());
    if (!groups.length) {
      const count = await query.groupBy("productId").aggregate((a) => ({ entries: a.count() }));
      return { movements: [], total: count.length };
    }
    const productIds = groups.map((group) => group.productId);
    const rows = await selectMovements(query.where((m) => m.productId.in(productIds)))
      .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]).all();
    const rank = new Map(productIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (rank.get(a.product?.id ?? "") ?? 0) - (rank.get(b.product?.id ?? "") ?? 0));
    return { movements: rows.map(toMovementResponse), total: groups[0].total };
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
    .include("variant", (v) => v.select("id", "label"))
    .include("createdByUser", (u) => u.select("id", "name"));
}

type WastageRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectWastage>["first"]>>
>;

export function toWastageResponse(row: WastageRow): WastageResponse {
  return {
    id: row.id,
    quantity: Number(row.quantity),
    reason: row.reason,
    lossAmount: String(row.lossAmount),
    product: row.product
      ? { id: row.product.id, name: row.product.name, sku: row.product.sku }
      : null,
    variant: row.variant ? { id: row.variant.id, name: row.variant.label } : null,
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
    stockQty: Number(row.stockQty),
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
      p.stockQty.lte(numeric<12, 3>(filter.threshold)),
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
  if (!filter.includeEmpty) query = query.where((p) => p.stockQty.gt(numeric<12, 3>(0)));
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
