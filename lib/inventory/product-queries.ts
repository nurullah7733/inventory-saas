import { randomBytes } from "node:crypto";
import { or } from "@prisma/orm-postgres/orm-client";
import type { RlsSession } from "../db/rls.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import {
  PRODUCT_REFS,
  type ProductAttributes,
  type ProductRefField,
  type ProductResponse,
  type ProductStatus,
} from "./products.ts";

type ProductCollection = TenantScope["Product"];

export const PRODUCT_COLUMNS = [
  "id",
  "name",
  "sku",
  "brand",
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
 * a list of 20 products would otherwise be 1 + 5×20 lookups. The included rows
 * come through the same RLS session, so a reference could only ever resolve to
 * this shop's category or variant anyway.
 */
export function selectProducts(collection: ProductCollection) {
  return collection
    .select(...PRODUCT_COLUMNS)
    .include("category", (c) => c.select("id", "name"))
    .include("unit", (u) => u.select("id", "name"))
    .include("color", (c) => c.select("id", "name"))
    .include("size", (s) => s.select("id", "name"))
    .include("weight", (w) => w.select("id", "name"));
}

type ProductRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof selectProducts>["first"]>>
>;

function ref(value: { id: string; name: string } | null | undefined) {
  return value ? { id: value.id, name: value.name } : null;
}

export function toProductResponse(row: ProductRow): ProductResponse {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    brand: row.brand,
    category: ref(row.category),
    unit: ref(row.unit),
    color: ref(row.color),
    size: ref(row.size),
    weight: ref(row.weight),
    expiryDate: row.expiryDate,
    costPrice: String(row.costPrice),
    sellPrice: String(row.sellPrice),
    stockQty: row.stockQty,
    attributes: (row.attributes as ProductAttributes | null) ?? null,
    imageUrl: row.imageUrl,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findProduct(
  scope: TenantScope,
  id: string,
): Promise<ProductResponse | null> {
  const row = await selectProducts(scope.Product.where({ id })).first();
  return row ? toProductResponse(row) : null;
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
    query = query.where((p) => or(p.name.ilike(pattern), p.sku.ilike(pattern)));
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

  return { products: rows.map(toProductResponse), total: count.total };
}

/**
 * SKUs are stored upper-case and the unique index covers soft-deleted
 * products too (a deleted product keeps its code, so restoring it cannot
 * collide) — this check therefore looks at every product in the shop.
 */
export function findSkuClash(scope: TenantScope, sku: string, exceptId?: string) {
  let query = scope.Product.where({ sku });
  if (exceptId) query = query.where((p) => p.id.neq(exceptId));
  return query.select("id", "name", "isDeleted").first();
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
 * Check that every category / variant id in a write belongs to THIS shop.
 *
 * The foreign keys only prove the row exists somewhere — `products.color_id`
 * would happily accept another shop's color id, and RLS guards the product row
 * being written, not the row it points at. The lookup below runs through the
 * tenant scope, so another shop's id is simply not found.
 *
 * A category must also be active to be newly assigned: archiving one is how
 * a shop takes it off the product form.
 */
export async function validateProductRefs(
  scope: TenantScope,
  refs: Partial<Record<ProductRefField, string | null>>,
  options: { previousCategoryId?: string | null } = {},
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
        case "unitId":
          found = await scope.VariantUnit.select("id").where({ id }).first();
          break;
        case "colorId":
          found = await scope.VariantColor.select("id").where({ id }).first();
          break;
        case "sizeId":
          found = await scope.VariantSize.select("id").where({ id }).first();
          break;
        case "weightId":
          found = await scope.VariantWeight.select("id").where({ id }).first();
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
