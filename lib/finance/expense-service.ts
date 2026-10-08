import type { TenantRequestContext } from "../api/guard.ts";
import { ApiProblem } from "../api/response.ts";
import { numeric } from "../numeric.ts";
import { changedFields, recordAudit } from "../audit/log.ts";
import { escapeLike, isForeignKeyViolation } from "../inventory/master-data.ts";
import {
  expenseSchema,
  expensePatchSchema,
  financeListSchema,
} from "./schemas.ts";
import type { z } from "zod";

const columns = [
  "id",
  "title",
  "categoryId",
  "amount",
  "expenseDate",
  "note",
  "createdBy",
  "createdAt",
] as const;
export function find(auth: TenantRequestContext, id: string) {
  return auth.scope.Expense.select(...columns)
    .where({ id })
    .first();
}
export async function list(
  auth: TenantRequestContext,
  filter: z.output<typeof financeListSchema>,
) {
  let query = auth.scope.Expense.select(...columns);
  if (filter.from) query = query.where((r) => r.expenseDate.gte(filter.from!));
  if (filter.to) query = query.where((r) => r.expenseDate.lte(filter.to!));
  if (filter.categoryId) query = query.where({ categoryId: filter.categoryId });
  if (filter.search)
    query = query.where((r) => r.title.ilike(`%${escapeLike(filter.search)}%`));
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const rows = await query
    .orderBy([(r) => r.expenseDate.desc(), (r) => r.id.desc()])
    .offset((filter.page - 1) * filter.limit)
    .limit(filter.limit)
    .all();
  return {
    expenses: rows,
    total: count.total,
    page: filter.page,
    limit: filter.limit,
  };
}
export async function save(
  auth: TenantRequestContext,
  data: z.output<typeof expenseSchema> | z.output<typeof expensePatchSchema>,
  id?: string,
) {
  const current = id ? await find(auth, id) : null;
  if (id && !current)
    throw new ApiProblem("NOT_FOUND", "Record not found.", 404);
  const reference = data.categoryId;
  if (reference) {
    const target = await auth.scope.ExpenseCategory.select("id", "isActive")
      .where({ id: reference })
      .first();
    if (!target || (!target.isActive && current?.categoryId !== reference)) {
      throw new ApiProblem(
        "VALIDATION_ERROR",
        "Choose an active expense category from your workspace.",
        422,
      );
    }
  }
  const { amount, ...rest } = data;
  const values = {
    ...rest,
    ...(amount !== undefined ? { amount: numeric<10, 2>(amount) } : {}),
  };
  const diff = current ? changedFields(current, values) : null;
  if (current && diff!.changed.length === 0) return { expense: current };
  let row;
  try {
    row = id
      ? await auth.scope.Expense.where({ id })
          .select(...columns)
          .update(values)
      : await auth.scope.Expense.select(...columns).create(
          auth.scope.own({
            ...expenseSchema.parse(data),
            amount: numeric<10, 2>(data.amount!),
            createdBy: auth.user.id,
          }),
        );
  } catch (error) {
    if (isForeignKeyViolation(error))
      throw new ApiProblem(
        "CONFLICT",
        "The selected reference is no longer available. Reload and try again.",
        409,
      );
    throw error;
  }
  if (!row) throw new ApiProblem("NOT_FOUND", "Record not found.", 404);
  await recordAudit({
    tenantId: auth.tenantId,
    userId: auth.user.id,
    action: "expense." + (id ? "update" : "create"),
    entityType: "expense",
    entityId: row.id,
    metadata: current ? { ...diff! } : { after: row },
  });
  return { expense: row };
}
export async function remove(auth: TenantRequestContext, id: string) {
  const current = await find(auth, id);
  if (!current) throw new ApiProblem("NOT_FOUND", "Record not found.", 404);
  await auth.scope.Expense.where({ id }).delete();
  await recordAudit({
    tenantId: auth.tenantId,
    userId: auth.user.id,
    action: "expense.delete",
    entityType: "expense",
    entityId: id,
    metadata: { before: current },
  });
  return { deleted: { id } };
}
