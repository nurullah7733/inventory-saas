import { z } from "zod";
import { ApiProblem } from "../api/response.ts";
import { recordAudit } from "../audit/log.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { fromCents, numeric, toCents } from "../numeric.ts";
import type { TenantScope } from "../tenant/scope.ts";
import type { UserRole } from "../auth/roles.ts";
import { commissionAmount, commissionBalance, currentCommissionMonth, monthBounds } from "./calculations.ts";
import { lockCommissionAccount } from "./locks.ts";
import type { commissionPolicy, commissionPayment, commissionFilter } from "./schemas.ts";
import type { CommissionReport } from "./types.ts";

type Actor = { id: string; role: UserRole };
const zero = BigInt(0);
const totalsSchema = z.array(z.object({ userId: z.uuid(), month: z.string(), eligible: z.string(), invoices: z.number(), sold: z.string(), returned: z.string() }));

async function salesTotals(scope: TenantScope, from: string, to: string, userId?: string) {
  const selectedUser = userId ?? "";
  const result = await rlsDb().query(rawSql`
    WITH invoice_totals AS (
      SELECT s.sold_by, to_char(coalesce(s.completed_at, s.created_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') AS month,
        coalesce(lines.sold, 0) AS sold, coalesce(lines.returned, 0) AS returned,
        CASE WHEN s.total_amount > 0 THEN round(
          greatest(0, s.total_amount - coalesce(lines.credit, 0))
          * greatest(0, s.subtotal - s.discount) / s.total_amount, 2) ELSE 0 END AS eligible
      FROM public.sales s
      LEFT JOIN LATERAL (
        SELECT sum(i.quantity) AS sold, sum(coalesce(r.quantity, 0)) AS returned, sum(coalesce(r.credit, 0)) AS credit
        FROM public.sale_items i
        LEFT JOIN LATERAL (
          SELECT sum(quantity) AS quantity, sum(refund_amount) AS credit FROM public.returns
          WHERE tenant_id = ${scope.tenantId}::uuid AND sale_item_id = i.id
        ) r ON true
        WHERE i.tenant_id = ${scope.tenantId}::uuid AND i.sale_id = s.id
      ) lines ON true
      WHERE s.tenant_id = ${scope.tenantId}::uuid AND s.status = 'completed'
        AND coalesce(s.completed_at, s.created_at) >= ${from}::timestamptz
        AND coalesce(s.completed_at, s.created_at) < ${to}::timestamptz
        AND (nullif(${selectedUser}, '')::uuid IS NULL OR s.sold_by = nullif(${selectedUser}, '')::uuid)
    ), grouped AS (
      SELECT sold_by, month, sum(eligible) AS eligible, count(*)::int AS invoices, sum(sold) AS sold, sum(returned) AS returned
      FROM invoice_totals GROUP BY sold_by, month
    ) SELECT coalesce(jsonb_agg(jsonb_build_object('userId', sold_by, 'month', month,
      'eligible', eligible::text, 'invoices', invoices, 'sold', sold::text, 'returned', returned::text)), '[]'::jsonb) AS data FROM grouped
  `.returnsRow({ data: "pg/jsonb@1" }).build());
  return totalsSchema.parse(result[0]?.data ?? []);
}

async function productSales(scope: TenantScope, userId: string, month: string, page: number) {
  const { from, to } = monthBounds(month);
  const offset = (page - 1) * 50;
  const result = await rlsDb().query(rawSql`
    WITH grouped AS (
      SELECT i.product_id, i.variant_id, p.name, v.label AS variant, sum(i.quantity) AS quantity, sum(coalesce(r.quantity, 0)) AS returned
      FROM public.sale_items i
      JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = i.tenant_id
      JOIN public.products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
      JOIN public.product_variants v ON v.id = i.variant_id AND v.tenant_id = i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(quantity) AS quantity FROM public.returns
        WHERE tenant_id = ${scope.tenantId}::uuid AND sale_item_id = i.id) r ON true
      WHERE i.tenant_id = ${scope.tenantId}::uuid AND s.sold_by = ${userId}::uuid AND s.status = 'completed'
        AND coalesce(s.completed_at, s.created_at) >= ${from}::timestamptz
        AND coalesce(s.completed_at, s.created_at) < ${to}::timestamptz
      GROUP BY i.product_id, i.variant_id, p.name, v.label
    ), selected AS (SELECT * FROM grouped ORDER BY name, product_id, variant_id LIMIT 50 OFFSET ${offset})
    SELECT (SELECT count(*)::int FROM grouped) AS total,
      coalesce((SELECT jsonb_agg(jsonb_build_object('productId', product_id, 'name', name, 'variant', variant,
        'quantity', quantity::text, 'returned', returned::text) ORDER BY name, product_id, variant_id) FROM selected), '[]'::jsonb) AS data
  `.returnsRow({ total: "pg/int4@1", data: "pg/jsonb@1" }).build());
  return {
    total: result[0]?.total ?? 0,
    products: z.array(z.object({ productId: z.uuid(), name: z.string(), variant: z.string(), quantity: z.string(), returned: z.string() })).parse(result[0]?.data ?? []),
  };
}

function visibleUser(actor: Actor, userId?: string) {
  if (actor.role === "shop_owner") return userId;
  if (actor.role !== "staff" && actor.role !== "manager") throw new ApiProblem("FORBIDDEN", "Shop account required.", 403);
  if (userId && userId !== actor.id) throw new ApiProblem("FORBIDDEN", "You can only view your own commission.", 403);
  return actor.id;
}

function requireOwner(actor: Actor) {
  if (actor.role !== "shop_owner") throw new ApiProblem("FORBIDDEN", "Only the shop owner manages commissions.", 403);
}

export async function commissionReport(scope: TenantScope, actor: Actor, filter: z.output<typeof commissionFilter>): Promise<CommissionReport> {
  const userId = visibleUser(actor, filter.userId);
  const { from, to } = monthBounds(filter.month);
  let usersQuery = scope.User.select("id", "name", "role", "isActive");
  if (userId) usersQuery = usersQuery.where({ id: userId });
  const users = await usersQuery.orderBy((u) => u.name.asc()).all();
  if (userId && !users.length) throw new ApiProblem("NOT_FOUND", "User not found.", 404);
  let policiesQuery = scope.CommissionPeriod.where({ month: filter.month });
  if (userId) policiesQuery = policiesQuery.where({ userId });
  const policies = await policiesQuery.all();
  const policyIds = policies.map((p) => p.id);
  const paymentTotals = policyIds.length ? await scope.CommissionPayment.where((p) => p.periodId.in(policyIds))
    .groupBy("periodId").aggregate((a) => ({ paid: a.sum("amount") })) : [];
  const payments = policyIds.length ? await scope.CommissionPayment.where((p) => p.periodId.in(policyIds))
    .select("id", "periodId", "amount", "note", "createdAt").orderBy((p) => p.createdAt.desc()).limit(100).all() : [];
  const totals = await salesTotals(scope, from, to, userId);
  const details = userId ? await productSales(scope, userId, filter.month, filter.page) : { total: 0, products: [] };
  return {
    availableToPay: userId && filter.month < currentCommissionMonth() ? await paymentAvailability(scope, userId, filter.month) : null,
    month: filter.month, canManage: actor.role === "shop_owner", policyEditable: filter.month >= currentCommissionMonth(),
    rows: users.map((user) => {
      const policy = policies.find((p) => p.userId === user.id);
      const stats = totals.find((s) => s.userId === user.id);
      const eligibleSales = stats?.eligible ?? "0.00";
      const enabled = policy?.enabled ?? false;
      const target = String(policy?.target ?? "0.00");
      const rate = String(policy?.rate ?? "0.00");
      const earned = enabled ? commissionAmount(eligibleSales, target, rate) : "0.00";
      const paid = String(paymentTotals.find((p) => p.periodId === policy?.id)?.paid ?? "0.00");
      return { userId: user.id, name: user.name, role: user.role, isActive: user.isActive, invoiceCount: stats?.invoices ?? 0,
        soldQuantity: stats?.sold ?? "0", returnedQuantity: stats?.returned ?? "0", eligibleSales, enabled, target, rate,
        earned, paid, ...commissionBalance(earned, paid) };
    }),
    products: details.products, productTotal: details.total, page: filter.page,
    payments: payments.map((p) => ({ id: p.id, userId: policies.find((period) => period.id === p.periodId)!.userId,
      amount: String(p.amount), note: p.note, createdAt: p.createdAt })),
  };
}

export async function saveCommissionPolicy(scope: TenantScope, actor: Actor, input: z.output<typeof commissionPolicy>) {
  requireOwner(actor);
  await lockCommissionAccount(scope, input.userId);
  if (input.month < currentCommissionMonth()) throw new ApiProblem("CONFLICT", "Past months are locked. Set a current or future month's plan.", 409);
  const user = await scope.User.where({ id: input.userId }).select("role", "isActive").first();
  if (!user || !["staff", "manager"].includes(user.role)) throw new ApiProblem("VALIDATION_ERROR", "Choose a staff member or manager from this shop.", 422);
  if (!user.isActive && input.enabled) throw new ApiProblem("CONFLICT", "Reactivate this user before enabling a new plan.", 409);
  const existing = await scope.CommissionPeriod.where({ userId: input.userId, month: input.month }).first();
  const values = { enabled: input.enabled, target: numeric<10, 2>(input.target), rate: numeric<5, 2>(input.rate) };
  const result = existing
    ? await scope.CommissionPeriod.where({ id: existing.id }).select("id").update(values)
    : await scope.CommissionPeriod.select("id").create(scope.own({ ...values, month: input.month, userId: input.userId }));
  await recordAudit({ tenantId: scope.tenantId, userId: actor.id, action: "commission.plan.update", entityType: "commission_period", entityId: existing?.id ?? result?.id,
    metadata: { userId: input.userId, month: input.month, enabled: input.enabled, target: input.target, rate: input.rate,
      before: existing ? { enabled: existing.enabled, target: String(existing.target), rate: String(existing.rate) } : null } });
  return { saved: true };
}

export async function recordCommissionPayment(scope: TenantScope, actor: Actor, input: z.output<typeof commissionPayment>) {
  requireOwner(actor);
  await lockCommissionAccount(scope, input.userId);
  const period = await scope.CommissionPeriod.where({ userId: input.userId, month: input.month }).first();
  if (!period) throw new ApiProblem("NOT_FOUND", "Commission plan not found.", 404);
  const retry = await scope.CommissionPayment.where({ id: input.requestId }).first();
  if (retry) {
    if (retry.periodId !== period.id || toCents(String(retry.amount)) !== toCents(input.amount) || (retry.note ?? "") !== input.note)
      throw new ApiProblem("CONFLICT", "This payment reference was already used.", 409);
    return { id: retry.id, amount: String(retry.amount) };
  }
  const currentMonth = currentCommissionMonth();
  if (input.month >= currentMonth) throw new ApiProblem("CONFLICT", "Record commission after the month has ended.", 409);
  const available = toCents(await paymentAvailability(scope, input.userId, input.month));
  if (toCents(input.amount) > available) throw new ApiProblem("CONFLICT", `Available commission is ${fromCents(available > zero ? available : zero)} after previous payments and returns.`, 409);
  const saved = await scope.CommissionPayment.select("id").create(scope.own({ id: input.requestId, periodId: period.id,
    amount: numeric<10, 2>(input.amount), createdBy: actor.id, note: input.note || null }));
  await recordAudit({ tenantId: scope.tenantId, userId: actor.id, action: "commission.payment.record", entityType: "commission_payment", entityId: saved.id,
    metadata: { userId: input.userId, month: input.month, amount: input.amount, note: input.note } });
  return { id: saved.id, amount: input.amount };
}

async function paymentAvailability(scope: TenantScope, userId: string, month: string) {
  const currentMonth = currentCommissionMonth();
  const periods = await scope.CommissionPeriod.where({ userId: userId }).where((p) => p.month.lt(currentMonth)).orderBy((p) => p.month.asc()).all();
  if (!periods.length) return "0.00";
  const { from } = monthBounds(periods[0].month);
  const { from: to } = monthBounds(currentMonth);
  const totals = await salesTotals(scope, from, to, userId);
  const ids = periods.map((p) => p.id);
  const paidTotals = await scope.CommissionPayment.where((p) => p.periodId.in(ids)).groupBy("periodId").aggregate((a) => ({ paid: a.sum("amount") }));
  let accountBalance = zero;
  let monthBalance = zero;
  for (const policy of periods) {
    const earned = policy.enabled ? commissionAmount(totals.find((t) => t.month === policy.month)?.eligible ?? "0.00", String(policy.target), String(policy.rate)) : "0.00";
    const paid = String(paidTotals.find((p) => p.periodId === policy.id)?.paid ?? "0.00");
    const balance = toCents(earned) - toCents(paid);
    accountBalance += balance;
    if (policy.month === month) monthBalance = balance;
  }
  const available = accountBalance < monthBalance ? accountBalance : monthBalance;
  return fromCents(available > zero ? available : zero);
}
