import type { TenantScope } from "../tenant/scope.ts";
import { buildLabel } from "./variant-combinations.ts";
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

/**
 * Sizes/colors/weights are referenced by ProductVariant rows (a product's
 * variants carry the options); units stay product-level. A value is "in use"
 * — and therefore undeletable — while any row in the matching table points
 * at it.
 */

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
  if (kind !== "units") {
    const result = await scope.ProductVariant
      .where((v) => v[optionColumn(kind)].eq(id))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }
  const result = await scope.Product.where((p) => p.unitId.eq(id)).aggregate(
    (agg) => ({ total: agg.count() }),
  );
  return result.total;
}

function optionColumn(kind: Exclude<VariantKind, "units">): "colorId" | "sizeId" | "weightId" {
  switch (kind) {
    case "colors":
      return "colorId";
    case "sizes":
      return "sizeId";
    case "weights":
      return "weightId";
  }
}

async function optionUsageCounts(
  scope: TenantScope,
  kind: VariantKind,
): Promise<Map<string, number>> {
  if (kind !== "units") {
    const column = optionColumn(kind);
    const groups = await scope.ProductVariant
      .where((v) => v[column].isNotNull())
      .groupBy(column)
      .aggregate((agg) => ({ total: agg.count() }));
    const counts = new Map<string, number>();
    for (const group of groups) {
      const id = (group as Record<string, unknown>)[column];
      if (typeof id === "string") counts.set(id, group.total);
    }
    return counts;
  }
  const groups = await scope.Product.where((p) => p.unitId.isNotNull())
    .groupBy("unitId")
    .aggregate((agg) => ({ total: agg.count() }));
  const counts = new Map<string, number>();
  for (const group of groups) {
    const id = (group as Record<string, unknown>).unitId;
    if (typeof id === "string") counts.set(id, group.total);
  }
  return counts;
}

export async function listVariantOptions(
  scope: TenantScope,
  kind: VariantKind,
): Promise<VariantOptionResponse[]> {
  const [rows, counts] = await Promise.all([
    kind === "units"
      ? scope.VariantUnit.select("id", "name", "createdAt", "measured")
          .orderBy([(v) => v.name.asc(), (v) => v.id.asc()])
          .all()
      : variantCollection(scope, kind)
          .select("id", "name", "createdAt")
          .orderBy([(v) => v.name.asc(), (v) => v.id.asc()])
          .all(),
    optionUsageCounts(scope, kind),
  ]);

  return rows.map((row) => {
    const measured = (row as { measured?: boolean }).measured;
    return {
      id: row.id,
      name: row.name,
      productCount: counts.get(row.id) ?? 0,
      ...(measured === undefined ? {} : { measured }),
      createdAt: row.createdAt,
    };
  });
}

export function findVariantOption(
  scope: TenantScope,
  kind: VariantKind,
  id: string,
) {
  return kind === "units"
    ? scope.VariantUnit.select("id", "name", "createdAt", "measured").where({ id }).first()
    : variantCollection(scope, kind)
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

/**
 * Renaming an option value must refresh the denormalized variant labels that
 * mention it ("37 / Red" → "37 / Crimson") in the SAME transaction as the
 * rename — `label` is the per-product combo key, so a stale label would be a
 * wrong combo key. A rename that would give two variants of one product the
 * same label hits the (product_id, label) unique constraint; the caller maps
 * that violation to a clear 409 and the whole transaction rolls back.
 */
export async function rebuildVariantLabels(
  scope: TenantScope,
  kind: Exclude<VariantKind, "units">,
  optionId: string,
): Promise<number> {
  const column = optionColumn(kind);
  const rows = await scope.ProductVariant
    .select("id")
    .include("size", (s) => s.select("name"))
    .include("color", (c) => c.select("name"))
    .include("weight", (w) => w.select("name"))
    .where((v) => v[column].eq(optionId))
    .all();

  let updated = 0;
  for (const row of rows) {
    const label = buildLabel({
      size: row.size?.name ?? null,
      color: row.color?.name ?? null,
      weight: row.weight?.name ?? null,
    });
    await scope.ProductVariant.where({ id: row.id }).update({ label });
    updated += 1;
  }
  return updated;
}
