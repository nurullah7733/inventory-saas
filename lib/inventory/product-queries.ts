import { randomBytes } from "node:crypto";
import { or } from "@prisma/orm-postgres/orm-client";
import type { RlsSession } from "../db/rls.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import { variantIdFromLabel } from "./label-codes.ts";
import {
  PRODUCT_REFS,
  VARIANT_REFS,
  type ProductAttributes,
  type ProductRefField,
  type ProductResponse,
  type ProductStatus,
  type ProductVariantResponse,
  type VariantRefField,
} from "./products.ts";

type ProductCollection = TenantScope["Product"];

export const PRODUCT_COLUMNS = [
  "id",
  "name",
  "sku",
  "expiryDate",
  "costPrice",
  "sellPrice",
  "stockQty",
  "attributes",
  "imageUrl",
  "isDeleted",
  "createdAt",
  "updatedAt",
] as const;

/**
 * The product columns plus the NAME of each thing it points at, in one query —
 * a list of 20 products would otherwise be 1 + 3×20 lookups. The included rows
 * come through the same RLS session, so a reference could only ever resolve to
 * this shop's category or brand anyway.
 */
export function selectProducts(collection: ProductCollection) {
  return collection
    .select(...PRODUCT_COLUMNS)
    .include("category", (c) => c.select("id", "name"))
    .include("brand", (b) => b.select("id", "name"))
    .include("unit", (u) => u.select("id", "name"));
}

type ProductRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectProducts>["first"]>>
>;

function ref(value: { id: string; name: string } | null | undefined) {
  return value ? { id: value.id, name: value.name } : null;
}

export function toProductResponse(
  row: ProductRow,
  variants: ProductVariantResponse[] = [],
): ProductResponse {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    brand: ref(row.brand),
    category: ref(row.category),
    unit: ref(row.unit),
    expiryDate: row.expiryDate,
    costPrice: String(row.costPrice),
    sellPrice: String(row.sellPrice),
    stockQty: Number(row.stockQty),
    variants,
    variantCount: variants.filter((variant) => variant.isActive).length,
    attributes: (row.attributes as ProductAttributes | null) ?? null,
    imageUrl: row.imageUrl,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const VARIANT_RESPONSE_COLUMNS = [
  "id",
  "productId",
  "sku",
  "barcode",
  "label",
  "costPrice",
  "sellPrice",
  "stockQty",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function selectProductVariants(collection: TenantScope["ProductVariant"]) {
  return collection
    .select(...VARIANT_RESPONSE_COLUMNS)
    .include("size", (s) => s.select("id", "name"))
    .include("color", (c) => c.select("id", "name"))
    .include("weight", (w) => w.select("id", "name"));
}

type VariantRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectProductVariants>["first"]>>
>;

function toVariantResponse(row: VariantRow): ProductVariantResponse {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    barcode: row.barcode,
    label: row.label,
    size: ref(row.size),
    color: ref(row.color),
    weight: ref(row.weight),
    costPrice: String(row.costPrice),
    sellPrice: String(row.sellPrice),
    stockQty: Number(row.stockQty),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A product's variants, Default first, then by creation order. */
export async function listVariants(
  scope: TenantScope,
  productId: string,
  options: { activeOnly?: boolean } = {},
): Promise<ProductVariantResponse[]> {
  let query = scope.ProductVariant.where({ productId });
  if (options.activeOnly) query = query.where({ isActive: true });
  const rows = await selectProductVariants(query)
    .orderBy([(v) => v.createdAt.asc(), (v) => v.sku.asc()])
    .all();
  return rows.map(toVariantResponse);
}

/**
 * Active-variant counts for a page of products, in one grouped query — the
 * list shows "Ladies Heel — 3 variants" without N+1 lookups.
 */
export async function variantCounts(
  scope: TenantScope,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const groups = await scope.ProductVariant
    .where({ isActive: true })
    .where((v) => v.productId.in(productIds))
    .groupBy("productId")
    .aggregate((agg) => ({ total: agg.count() }));
  return new Map(groups.map((group) => [group.productId, group.total]));
}

export async function findProduct(
  scope: TenantScope,
  id: string,
): Promise<ProductResponse | null> {
  const row = await selectProducts(scope.Product.where({ id })).first();
  if (!row) return null;
  const variants = await listVariants(scope, id);
  return toProductResponse(row, variants);
}

export interface ProductListFilter {
  status: ProductStatus;
  search: string;
  categoryId: string | null;
}

export function filterProducts(
  collection: ProductCollection,
  filter: ProductListFilter,
): ProductCollection {
  let query = collection;
  if (filter.status !== "all") {
    query = query.where({ isDeleted: filter.status === "deleted" });
  }
  if (filter.categoryId) query = query.where({ categoryId: filter.categoryId });
  if (filter.search !== "") {
    const pattern = `%${escapeLike(filter.search)}%`;
    const labelVariantId = variantIdFromLabel(filter.search.trim());
    query = query.where((p) => or(
      p.name.ilike(pattern),
      p.sku.ilike(pattern),
      p.variants.some((v) => or(
        v.sku.ilike(pattern),
        v.barcode.ilike(pattern),
        ...(labelVariantId ? [v.id.eq(labelVariantId)] : []),
      )),
    ));
  }
  return query;
}

export async function listProducts(
  scope: TenantScope,
  filter: ProductListFilter,
  page: { offset: number; pageSize: number },
): Promise<{ products: ProductResponse[]; total: number }> {
  const filtered = filterProducts(scope.Product, filter);

  const [rows, count] = await Promise.all([
    selectProducts(filtered)
      .orderBy([(p) => p.createdAt.desc(), (p) => p.id.desc()])
      .offset(page.offset)
      .limit(page.pageSize)
      .all(),
    filtered.aggregate((agg) => ({ total: agg.count() })),
  ]);

  const counts = await variantCounts(scope, rows.map((row) => row.id));

  return {
    products: rows.map((row) => {
      const product = toProductResponse(row);
      return { ...product, variantCount: counts.get(row.id) ?? 0 };
    }),
    total: count.total,
  };
}

/**
 * SKUs are stored upper-case and the unique index covers soft-deleted
 * products too (a deleted product keeps its code, so restoring it cannot
 * collide) — this check therefore looks at every product in the shop, and at
 * variant SKUs as well (the Default variant inherits the product's SKU).
 */
export async function findSkuClash(scope: TenantScope, sku: string, exceptId?: string) {
  let query = scope.Product.where({ sku });
  if (exceptId) query = query.where((p) => p.id.neq(exceptId));
  const [product, variant] = await Promise.all([
    query.select("id", "name", "isDeleted").first(),
    scope.ProductVariant.select("id").where((v) => or(v.sku.eq(sku), v.barcode.ilike(escapeLike(sku)))).first(),
  ]);
  return product ?? (variant ? { id: variant.id, name: "variant", isDeleted: false } : null);
}

/** Variant SKUs are unique per shop across every product. */
export function findVariantSkuClash(scope: TenantScope, sku: string) {
  return scope.ProductVariant.select("id", "label").where({ sku }).first();
}

/** Barcodes are unique per shop when present. */
export function findVariantBarcodeClash(scope: TenantScope, barcode: string) {
  return scope.ProductVariant.select("id", "label").where({ barcode }).first();
}

const SKU_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A code for a product saved with the SKU left blank. 8 characters from a
 * 32-letter alphabet without look-alikes (0/O, 1/I) — readable off a shelf
 * label, and ~10^12 combinations, so a clash is checked for but not expected.
 */
export async function generateSku(scope: TenantScope): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = randomBytes(8);
    let code = "P-";
    for (const byte of bytes) code += SKU_ALPHABET[byte % SKU_ALPHABET.length];
    if (!(await findSkuClash(scope, code))) return code;
  }
  throw new Error("Could not generate a unique SKU after 5 attempts.");
}

/**
 * Check that every category / brand / unit id in a write belongs to THIS shop.
 *
 * The foreign keys only prove the row exists somewhere — `products.category_id`
 * would happily accept another shop's category id, and RLS guards the product row
 * being written, not the row it points at. The lookup below runs through the
 * tenant scope, so another shop's id is simply not found.
 *
 * A category must also be active to be newly assigned: archiving one is how
 * a shop takes it off the product form.
 */
export async function validateProductRefs(
  scope: TenantScope,
  refs: Partial<Record<ProductRefField, string | null>>,
  options: {
    previousCategoryId?: string | null;
    previousBrandId?: string | null;
  } = {},
): Promise<Record<string, string[]> | null> {
  const errors: Record<string, string[]> = {};

  const checks = (Object.keys(PRODUCT_REFS) as ProductRefField[]).map(
    async (field) => {
      const id = refs[field];
      if (!id) return;

      const label = PRODUCT_REFS[field];
      let found: { id: string; isActive?: boolean } | null;
      switch (field) {
        case "categoryId":
          found = await scope.Category.select("id", "isActive").where({ id }).first();
          break;
        case "brandId":
          found = await scope.Brand.select("id", "isActive").where({ id }).first();
          break;
        case "unitId":
          found = await scope.VariantUnit.select("id").where({ id }).first();
          break;
      }

      if (!found) {
        errors[field] = [`This ${label} does not exist. Choose one from your list.`];
      } else if (
        field === "categoryId" &&
        found.isActive === false &&
        id !== options.previousCategoryId
      ) {
        errors[field] = ["This category is archived. Restore it or choose another one."];
      } else if (
        field === "brandId" &&
        found.isActive === false &&
        id !== options.previousBrandId
      ) {
        errors[field] = ["This brand is archived. Restore it or choose another one."];
      }
    },
  );
  await Promise.all(checks);

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Same check for the option ids on variant rows (size / color / weight). Each
 * field carries every distinct id used across the payload's rows; the per-kind
 * lookup runs through the tenant scope, so another shop's value id is simply
 * not found.
 */
export async function validateVariantOptionRefs(
  scope: TenantScope,
  ids: Partial<Record<VariantRefField, string[]>>,
): Promise<Record<string, string[]> | null> {
  const errors: Record<string, string[]> = {};

  const checks = (Object.keys(VARIANT_REFS) as VariantRefField[]).map(
    async (field) => {
      const fieldIds = ids[field] ?? [];
      if (fieldIds.length === 0) return;

      const collection =
        field === "sizeId"
          ? scope.VariantSize
          : field === "colorId"
            ? scope.VariantColor
            : scope.VariantWeight;
      const found = await collection
        .select("id")
        .where((v) => v.id.in(fieldIds))
        .all();
      if (found.length < fieldIds.length) {
        errors[field] = [`This ${VARIANT_REFS[field]} does not exist. Choose one from your list.`];
      }
    },
  );
  await Promise.all(checks);

  return Object.keys(errors).length > 0 ? errors : null;
}

/** Products counted against the plan's `max_products` — deleted ones are not. */
export async function planProductUsage(
  scope: TenantScope,
  db: RlsSession,
): Promise<{ used: number; max: number }> {
  const [count, tenant] = await Promise.all([
    scope.Product.where({ isDeleted: false }).aggregate((agg) => ({
      total: agg.count(),
    })),
    db.orm.public.Tenant.select("maxProducts").where({ id: scope.tenantId }).first(),
  ]);
  return { used: count.total, max: tenant?.maxProducts ?? 0 };
}
