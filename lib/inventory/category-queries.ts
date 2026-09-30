import type { TenantScope } from "../tenant/scope.ts";
import type { CategoryResponse, CategoryStatus } from "./categories.ts";
import { escapeLike } from "./master-data.ts";

const CATEGORY_COLUMNS = [
  "id",
  "name",
  "imageUrl",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function findCategory(scope: TenantScope, id: string) {
  return scope.Category.select(...CATEGORY_COLUMNS).where({ id }).first();
}

type CategoryRow = NonNullable<Awaited<ReturnType<typeof findCategory>>>;

export function toCategoryResponse(
  row: CategoryRow,
  productCount: number,
): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    productCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Products in one category. Soft-deleted products count: the foreign key does
 * not know about `is_deleted`, so they block a delete too.
 */
export async function countProductsInCategory(
  scope: TenantScope,
  id: string,
): Promise<number> {
  const result = await scope.Product.where({ categoryId: id }).aggregate(
    (agg) => ({ total: agg.count() }),
  );
  return result.total;
}

export async function listCategories(
  scope: TenantScope,
  status: CategoryStatus,
): Promise<CategoryResponse[]> {
  let query = scope.Category.select(...CATEGORY_COLUMNS);
  if (status !== "all") query = query.where({ isActive: status === "active" });

  const [rows, groups] = await Promise.all([
    query.orderBy([(c) => c.name.asc(), (c) => c.id.asc()]).all(),
    scope.Product.where((p) => p.categoryId.isNotNull())
      .groupBy("categoryId")
      .aggregate((agg) => ({ total: agg.count() })),
  ]);

  const counts = new Map<string, number>();
  for (const group of groups) {
    if (group.categoryId) counts.set(group.categoryId, group.total);
  }

  return rows.map((row) => toCategoryResponse(row, counts.get(row.id) ?? 0));
}

/** Case-insensitive, for the same reason as variant options. */
export function findCategoryNameClash(
  scope: TenantScope,
  name: string,
  exceptId?: string,
) {
  let query = scope.Category.where((c) => c.name.ilike(escapeLike(name)));
  if (exceptId) query = query.where((c) => c.id.neq(exceptId));
  return query.select("id", "name").first();
}
