import type { TenantScope } from "../tenant/scope.ts";
import type { CategoryResponse, CategoryStatus } from "./categories.ts";
import { escapeLike } from "../inventory/master-data.ts";

const CATEGORY_COLUMNS = [
  "id",
  "name",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function findCategory(scope: TenantScope, id: string) {
  return scope.ExpenseCategory.select(...CATEGORY_COLUMNS)
    .where({ id })
    .first();
}

type CategoryRow = NonNullable<Awaited<ReturnType<typeof findCategory>>>;

export function toCategoryResponse(
  row: CategoryRow,
  expenseCount: number,
): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    expenseCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** All references must be removed before a category can be deleted. */
export async function countExpensesInCategory(
  scope: TenantScope,
  id: string,
): Promise<number> {
  const result = await scope.Expense.where({ categoryId: id }).aggregate(
    (agg) => ({ total: agg.count() }),
  );
  return result.total;
}

export async function listCategories(
  scope: TenantScope,
  status: CategoryStatus,
): Promise<CategoryResponse[]> {
  let query = scope.ExpenseCategory.select(...CATEGORY_COLUMNS);
  if (status !== "all") query = query.where({ isActive: status === "active" });

  const [rows, groups] = await Promise.all([
    query.orderBy([(c) => c.name.asc(), (c) => c.id.asc()]).all(),
    scope.Expense.where((p) => p.categoryId.isNotNull())
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
  let query = scope.ExpenseCategory.where((c) =>
    c.name.ilike(escapeLike(name)),
  );
  if (exceptId) query = query.where((c) => c.id.neq(exceptId));
  return query.select("id", "name").first();
}
