import type { TenantRequestContext } from "../api/guard.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { addDays } from "../dates.ts";
import { buildDashboardSummary } from "./calculations.ts";
import { dashboardDay, dashboardWeek, type DashboardPeriod } from "./types.ts";

/** Aggregate inside Postgres; transfer only daily totals and five ranked products. */
export async function getDashboardSummary(auth: TenantRequestContext, period: DashboardPeriod, now = new Date()) {
  const tx = rlsDb(), tenantId = auth.tenantId;
  const week = dashboardWeek(dashboardDay(now));
  const weekStart = `${week.from}T00:00:00+06:00`, weekEnd = `${addDays(week.to, 1)}T00:00:00+06:00`;
  const start = `${period.from}T00:00:00+06:00`, end = `${addDays(period.to, 1)}T00:00:00+06:00`;
  const business = await auth.db.orm.public.Tenant.where({ id: tenantId }).select("currencySymbol").first();
  if (!business) throw new Error("Authenticated shop missing.");
  const sales = await tx.query(rawSql`SELECT to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS date,
    COALESCE(SUM(total_amount), 0)::text AS sales, COUNT(*)::text AS invoices
    FROM public.sales WHERE tenant_id = ${tenantId}::uuid AND status = 'completed'
      AND ((created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz)
        OR (created_at >= ${weekStart}::timestamptz AND created_at < ${weekEnd}::timestamptz))
    GROUP BY 1`.returnsRow({ date: "pg/text@1", sales: "pg/text@1", invoices: "pg/text@1" }).build());
  const returns = await tx.query(rawSql`SELECT to_char(r.created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS date,
    COALESCE(SUM(r.refund_amount), 0)::text AS "salesReturns"
    FROM public.returns r JOIN public.sale_items i ON i.id = r.sale_item_id AND i.tenant_id = ${tenantId}::uuid
    JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenantId}::uuid AND s.status = 'completed'
    WHERE r.tenant_id = ${tenantId}::uuid AND ((r.created_at >= ${start}::timestamptz AND r.created_at < ${end}::timestamptz)
      OR (r.created_at >= ${weekStart}::timestamptz AND r.created_at < ${weekEnd}::timestamptz))
    GROUP BY 1`.returnsRow({ date: "pg/text@1", salesReturns: "pg/text@1" }).build());
  const purchases = await tx.query(rawSql`SELECT to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS date,
    COALESCE(SUM(CASE WHEN type = 'in' THEN quantity::numeric * COALESCE(unit_cost, 0) ELSE 0 END), 0)::text AS purchases,
    COALESCE(SUM(CASE WHEN type = 'purchase_return' THEN -quantity::numeric * COALESCE(unit_cost, 0) ELSE 0 END), 0)::text AS "purchaseReturns"
    FROM public.stock_movements WHERE tenant_id = ${tenantId}::uuid AND type IN ('in', 'purchase_return')
      AND ((created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz)
        OR (created_at >= ${weekStart}::timestamptz AND created_at < ${weekEnd}::timestamptz))
    GROUP BY 1`.returnsRow({ date: "pg/text@1", purchases: "pg/text@1", purchaseReturns: "pg/text@1" }).build());
  const topProducts = await tx.query(rawSql`WITH quantities AS (
    SELECT i.product_id, SUM(i.quantity)::bigint AS sold, 0::bigint AS returned
    FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenantId}::uuid
    WHERE i.tenant_id = ${tenantId}::uuid AND s.status = 'completed'
      AND s.created_at >= ${start}::timestamptz AND s.created_at < ${end}::timestamptz GROUP BY i.product_id
    UNION ALL
    SELECT i.product_id, 0::bigint AS sold, SUM(r.quantity)::bigint AS returned
    FROM public.returns r JOIN public.sale_items i ON i.id = r.sale_item_id AND i.tenant_id = ${tenantId}::uuid
    JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenantId}::uuid AND s.status = 'completed'
    WHERE r.tenant_id = ${tenantId}::uuid AND r.created_at >= ${start}::timestamptz AND r.created_at < ${end}::timestamptz
    GROUP BY i.product_id
  ) SELECT p.id, p.name, p.sku, p.is_deleted AS "isDeleted",
    SUM(q.sold)::text AS "soldQuantity", SUM(q.returned)::text AS "returnedQuantity", (SUM(q.sold) - SUM(q.returned))::text AS "netQuantity"
    FROM quantities q JOIN public.products p ON p.id = q.product_id AND p.tenant_id = ${tenantId}::uuid
    GROUP BY p.id, p.name, p.sku, p.is_deleted HAVING SUM(q.sold) - SUM(q.returned) > 0
    ORDER BY SUM(q.sold) - SUM(q.returned) DESC, p.name ASC, p.id ASC LIMIT 5`
    .returnsRow({ id: "pg/uuid@1", name: "pg/text@1", sku: "pg/text@1", isDeleted: "pg/bool@1", soldQuantity: "pg/text@1", returnedQuantity: "pg/text@1", netQuantity: "pg/text@1" }).build());
  return buildDashboardSummary(period, { sales, returns, purchases, topProducts }, business.currencySymbol, now);
}
