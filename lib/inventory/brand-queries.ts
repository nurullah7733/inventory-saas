import type { TenantScope } from "../tenant/scope.ts";
import type { BrandResponse, BrandStatus } from "./brands.ts";
import { escapeLike } from "./master-data.ts";

const BRAND_COLUMNS = [
  "id",
  "name",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function findBrand(scope: TenantScope, id: string) {
  return scope.Brand.select(...BRAND_COLUMNS).where({ id }).first();
}

type BrandRow = NonNullable<Awaited<ReturnType<typeof findBrand>>>;

export function toBrandResponse(
  row: BrandRow,
  productCount: number,
): BrandResponse {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    productCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function countProductsInBrand(
  scope: TenantScope,
  id: string,
): Promise<number> {
  const result = await scope.Product.where({ brandId: id }).aggregate(
    (agg) => ({ total: agg.count() }),
  );
  return result.total;
}

export async function listBrands(
  scope: TenantScope,
  status: BrandStatus,
): Promise<BrandResponse[]> {
  let query = scope.Brand.select(...BRAND_COLUMNS);
  if (status !== "all") query = query.where({ isActive: status === "active" });

  const [rows, groups] = await Promise.all([
    query.orderBy([(b) => b.name.asc(), (b) => b.id.asc()]).all(),
    scope.Product.where((p) => p.brandId.isNotNull())
      .groupBy("brandId")
      .aggregate((agg) => ({ total: agg.count() })),
  ]);

  const counts = new Map<string, number>();
  for (const group of groups) {
    if (group.brandId) counts.set(group.brandId, group.total);
  }

  return rows.map((row) => toBrandResponse(row, counts.get(row.id) ?? 0));
}

export function findBrandNameClash(
  scope: TenantScope,
  name: string,
  exceptId?: string,
) {
  let query = scope.Brand.where((b) => b.name.ilike(escapeLike(name)));
  if (exceptId) query = query.where((b) => b.id.neq(exceptId));
  return query.select("id", "name").first();
}
