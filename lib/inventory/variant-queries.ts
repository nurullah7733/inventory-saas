import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "./master-data.ts";
import type { VariantKind, VariantOptionResponse } from "./variants.ts";

type VariantCollection = TenantScope["VariantColor"];

export function variantCollection(
  scope: TenantScope,
  kind: VariantKind,
): VariantCollection {
  switch (kind) {
    case "colors":
      return scope.VariantColor;
    case "sizes":
      return scope.VariantSize as unknown as VariantCollection;
    case "weights":
      return scope.VariantWeight as unknown as VariantCollection;
    case "units":
      return scope.VariantUnit as unknown as VariantCollection;
  }
}

/** The `products` column that points at each list. */
const PRODUCT_COLUMN = {
  colors: "colorId",
  sizes: "sizeId",
  weights: "weightId",
  units: "unitId",
} as const satisfies Record<VariantKind, string>;

/** `entity_type` / action prefix in `audit_logs`, e.g. `variant_color.create`. */
export const VARIANT_ENTITY: Record<VariantKind, string> = {
  colors: "variant_color",
  sizes: "variant_size",
  weights: "variant_weight",
  units: "variant_unit",
};

export async function countProductsUsing(
  scope: TenantScope,
  kind: VariantKind,
  id: string,
): Promise<number> {
  const column = PRODUCT_COLUMN[kind];
  const result = await scope.Product.where((p) => p[column].eq(id)).aggregate(
    (agg) => ({ total: agg.count() }),
  );
  return result.total;
}

async function productCountsByOption(
  scope: TenantScope,
  kind: VariantKind,
): Promise<Map<string, number>> {
  const column = PRODUCT_COLUMN[kind];
  const groups = await scope.Product.where((p) => p[column].isNotNull())
    .groupBy(column)
    .aggregate((agg) => ({ total: agg.count() }));

  const counts = new Map<string, number>();
  for (const group of groups) {
    const id = (group as Record<string, unknown>)[column];
    if (typeof id === "string") counts.set(id, group.total);
  }
  return counts;
}

export async function listVariantOptions(
  scope: TenantScope,
  kind: VariantKind,
): Promise<VariantOptionResponse[]> {
  const [rows, counts] = await Promise.all([
    variantCollection(scope, kind)
      .select("id", "name", "createdAt")
      .orderBy([(v) => v.name.asc(), (v) => v.id.asc()])
      .all(),
    productCountsByOption(scope, kind),
  ]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    productCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt,
  }));
}

export function findVariantOption(
  scope: TenantScope,
  kind: VariantKind,
  id: string,
) {
  return variantCollection(scope, kind)
    .select("id", "name", "createdAt")
    .where({ id })
    .first();
}

export function findVariantNameClash(
  scope: TenantScope,
  kind: VariantKind,
  name: string,
  exceptId?: string,
) {
  let query = variantCollection(scope, kind).where((v) =>
    v.name.ilike(escapeLike(name)),
  );
  if (exceptId) query = query.where((v) => v.id.neq(exceptId));
  return query.select("id", "name").first();
}
