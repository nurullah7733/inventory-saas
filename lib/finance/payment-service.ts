import type { TenantRequestContext } from "../api/guard.ts";
import { ApiProblem } from "../api/response.ts";
import { numeric } from "../numeric.ts";
import { recordAudit } from "../audit/log.ts";
import { isForeignKeyViolation } from "../inventory/master-data.ts";
import {
  paymentSchema,
  paymentPatchSchema,
  financeListSchema,
} from "./schemas.ts";
import type { z } from "zod";

const columns = [
  "id",
  "supplierId",
  "amount",
  "paymentDate",
  "note",
  "createdBy",
  "createdAt",
] as const;
export function find(auth: TenantRequestContext, id: string) {
  return auth.scope.SupplierPayment.select(...columns)
    .where({ id })
    .first();
}
export async function list(
  auth: TenantRequestContext,
  filter: z.output<typeof financeListSchema>,
) {
  let query = auth.scope.SupplierPayment.select(...columns);
  if (filter.from) query = query.where((r) => r.paymentDate.gte(filter.from!));
  if (filter.to) query = query.where((r) => r.paymentDate.lte(filter.to!));
  if (filter.supplierId) query = query.where({ supplierId: filter.supplierId });
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const rows = await query
    .orderBy([(r) => r.paymentDate.desc(), (r) => r.id.desc()])
    .offset((filter.page - 1) * filter.limit)
    .limit(filter.limit)
    .all();
  return {
    payments: rows,
    total: count.total,
    page: filter.page,
    limit: filter.limit,
  };
}
export async function save(
  auth: TenantRequestContext,
  data: z.output<typeof paymentSchema> | z.output<typeof paymentPatchSchema>,
  id?: string,
) {
  const current = id ? await find(auth, id) : null;
  if (id && !current)
    throw new ApiProblem("NOT_FOUND", "Record not found.", 404);
  const reference = data.supplierId;
  if (reference) {
    const target = await auth.scope.Supplier.select("id", "isActive")
      .where({ id: reference })
      .first();
    if (!target || (!target.isActive && current?.supplierId !== reference)) {
      throw new ApiProblem(
        "VALIDATION_ERROR",
        "Choose an active supplier from your workspace.",
        422,
      );
    }
  }
  const { amount, ...rest } = data;
  const values = {
    ...rest,
    ...(amount !== undefined ? { amount: numeric<10, 2>(amount) } : {}),
  };
  let row;
  try {
    row = id
      ? await auth.scope.SupplierPayment.where({ id })
          .select(...columns)
          .update(values)
      : await auth.scope.SupplierPayment.select(...columns).create(
          auth.scope.own({
            ...paymentSchema.parse(data),
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
    action: "supplier_payment." + (id ? "update" : "create"),
    entityType: "supplier_payment",
    entityId: row.id,
    metadata: { before: current, after: row },
  });
  return { payment: row };
}
export async function remove(auth: TenantRequestContext, id: string) {
  const current = await find(auth, id);
  if (!current) throw new ApiProblem("NOT_FOUND", "Record not found.", 404);
  await auth.scope.SupplierPayment.where({ id }).delete();
  await recordAudit({
    tenantId: auth.tenantId,
    userId: auth.user.id,
    action: "supplier_payment.delete",
    entityType: "supplier_payment",
    entityId: id,
    metadata: { before: current },
  });
  return { deleted: { id } };
}
