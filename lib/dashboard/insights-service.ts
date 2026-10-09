import type { TenantRequestContext } from "../api/guard.ts";
import { rawSql } from "../db/rls.ts";
import { addDays } from "../dates.ts";
import { getReport } from "../reports/service.ts";
import { getDashboardSummary } from "./service.ts";
import { previousPeriod, chartPeriod, netAmount } from "./insights-calculations.ts";
import { toCents, fromCents } from "../numeric.ts";
import { canViewFinance } from "./permissions.ts";
import { dashboardDay, type DashboardPeriod } from "./types.ts";
import { INSIGHT_SECTIONS, type InsightSection, type InsightsResponse, type DashboardInsights, type SalesChartResponse, type ChartWindow } from "./insights-types.ts";

async function insight<K extends InsightSection>(auth: TenantRequestContext, period: DashboardPeriod, section: K): Promise<DashboardInsights[K]> {
  const tenant = auth.tenantId, start = `${period.from}T00:00:00+06:00`, end = `${addDays(period.to, 1)}T00:00:00+06:00`;
  let result: DashboardInsights[InsightSection];
  if (section === "comparison") {
    const previous = previousPeriod(period);
    result = { period: previous, totals: (await getDashboardSummary(auth, previous)).totals };
  } else if (section === "finance") {
    // Reuse the report's sale-time COGS, return credits and expense calculations.
    const current = await getReport(auth, "profit-loss", period);
    const previous = await getReport(auth, "profit-loss", previousPeriod(period));
    const amount = (report: typeof current, label: string) => String(report.summary.find((metric) => metric.label === label)?.value ?? "0.00");
    result = { expenses: amount(current, "Operating expenses"), cogs: amount(current, "COGS (after returns)"), grossProfit: amount(current, "Gross profit"), previousExpenses: amount(previous, "Operating expenses"), previousGrossProfit: amount(previous, "Gross profit") };
  } else if (section === "dues") {
    const filter = { from: "1970-01-01", to: period.to };
    const due = await getReport(auth, "due", filter), payable = await getReport(auth, "payable", filter);
    result = { receivable: String(due.summary.find((metric) => metric.label === "Total customer due")?.value ?? "0.00"), payable: String(payable.summary.find((metric) => metric.label === "Total payable")?.value ?? "0.00") };
  } else if (section === "stock") {
    const rows = await auth.db.query(rawSql`SELECT COALESCE(SUM(loss_amount), 0)::text AS amount FROM public.wastage WHERE tenant_id = ${tenant}::uuid AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz`.returnsRow({ amount: "pg/text@1" }).build());
    result = { wastage: rows[0]?.amount ?? "0.00" };
  } else if (section === "invoices") {
    const rows = await auth.scope.Sale.where((sale) => sale.createdAt.gte(start)).where((sale) => sale.createdAt.lt(end))
      .select("id", "invoiceNo", "totalAmount", "status").include("customer", (customer) => customer.where({ tenantId: tenant }).select("name"))
      .orderBy([(sale) => sale.createdAt.desc(), (sale) => sale.id.desc()]).limit(5).all();
    result = rows.map((row) => ({ id: row.id, invoiceNo: row.invoiceNo, amount: String(row.totalAmount), status: row.status, customer: row.customer?.name ?? "Walk-in customer" }));
  } else if (section === "returns") {
    const rows = await auth.db.query(rawSql`SELECT
      (SELECT COUNT(*)::text FROM public.returns r JOIN public.sale_items i ON i.id = r.sale_item_id AND i.tenant_id = ${tenant}::uuid JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenant}::uuid AND s.status = 'completed' WHERE r.tenant_id = ${tenant}::uuid AND r.created_at >= ${start}::timestamptz AND r.created_at < ${end}::timestamptz) AS sales,
      (SELECT COUNT(*)::text FROM public.stock_movements WHERE tenant_id = ${tenant}::uuid AND type = 'purchase_return' AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz) AS purchases`.returnsRow({ sales: "pg/text@1", purchases: "pg/text@1" }).build());
    result = { salesCount: rows[0]?.sales ?? "0", purchaseCount: rows[0]?.purchases ?? "0" };
  } else {
    // Line subtotals less recorded credits; invoice adjustments are not allocated.
    const rows = await auth.db.query(rawSql`WITH revenue AS (
      SELECT i.product_id, SUM(i.subtotal) AS amount FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenant}::uuid
      WHERE i.tenant_id = ${tenant}::uuid AND s.status = 'completed' AND s.created_at >= ${start}::timestamptz AND s.created_at < ${end}::timestamptz GROUP BY i.product_id
      UNION ALL
      SELECT i.product_id, -SUM(r.refund_amount) FROM public.returns r JOIN public.sale_items i ON i.id = r.sale_item_id AND i.tenant_id = ${tenant}::uuid JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenant}::uuid AND s.status = 'completed'
      WHERE r.tenant_id = ${tenant}::uuid AND r.created_at >= ${start}::timestamptz AND r.created_at < ${end}::timestamptz GROUP BY i.product_id
    ) SELECT p.id, p.name, p.image_url AS image, COALESCE(c.id::text, 'uncategorized') AS category, COALESCE(c.name, 'Uncategorized') AS "categoryName", SUM(r.amount)::text AS amount
    FROM revenue r JOIN public.products p ON p.id = r.product_id AND p.tenant_id = ${tenant}::uuid LEFT JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = ${tenant}::uuid
    GROUP BY p.id, p.name, p.image_url, c.id, c.name`.returnsRow({ id: "pg/uuid@1", name: "pg/text@1", image: "pg/text@1", category: "pg/text@1", categoryName: "pg/text@1", amount: "pg/text@1" }).build());
    if (section === "products") {
      const summary = await getDashboardSummary(auth, period);
      const byId = new Map(rows.map((row) => [row.id, row]));
      result = summary.topProducts.map((product) => ({ ...product, imageUrl: byId.get(product.id)?.image ?? null, revenue: byId.get(product.id)?.amount ?? "0.00" }));
    } else {
      const categories = new Map<string, { id: string; name: string; amount: bigint }>();
      for (const row of rows) {
        const category = categories.get(row.category) ?? { id: row.category, name: row.categoryName, amount: BigInt(0) };
        category.amount += toCents(row.amount); categories.set(row.category, category);
      }
      result = [...categories.values()].map((category) => ({ id: category.id, name: category.name, revenue: fromCents(category.amount) }));
    }
  }
  return result as DashboardInsights[K];
}

/** Savepoints isolate SQL failures so one card does not abort the request transaction. */
export async function getDashboardInsights(auth: TenantRequestContext, period: DashboardPeriod, section?: InsightSection): Promise<InsightsResponse> {
  const response: InsightsResponse = { period, sections: {} };
  for (const key of section ? [section] : INSIGHT_SECTIONS) {
    if ((key === "finance" || key === "dues") && !canViewFinance(auth.user.role)) continue;
    await auth.db.execute(rawSql`SAVEPOINT dashboard_card`.affectedCount().build());
    try {
      const data = await insight(auth, period, key);
      Object.assign(response.sections, { [key]: { data } });
    } catch (error) {
      await auth.db.execute(rawSql`ROLLBACK TO SAVEPOINT dashboard_card`.affectedCount().build());
      console.error(`[dashboard] ${key} failed`, error);
      Object.assign(response.sections, { [key]: { error: "Could not load this card. Please retry." } });
    }
    await auth.db.execute(rawSql`RELEASE SAVEPOINT dashboard_card`.affectedCount().build());
  }
  return response;
}

export async function getSalesChart(auth: TenantRequestContext, period: DashboardPeriod, window: ChartWindow): Promise<SalesChartResponse> {
  const today = dashboardDay();
  const range = chartPeriod(period, window, today);
  const start = `${range.from}T00:00:00+06:00`, end = `${addDays(range.to, 1)}T00:00:00+06:00`, tenant = auth.tenantId;
  const monthly = window === "12m";
  const rows = await auth.db.query(rawSql`WITH events AS (
    SELECT created_at AS occurred, total_amount AS sales, 0::numeric AS purchases, 0::numeric AS returns FROM public.sales WHERE tenant_id = ${tenant}::uuid AND status = 'completed' AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
    UNION ALL SELECT created_at, 0, quantity::numeric * COALESCE(unit_cost, 0), 0 FROM public.stock_movements WHERE tenant_id = ${tenant}::uuid AND type = 'in' AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
    UNION ALL SELECT r.created_at, 0, 0, r.refund_amount FROM public.returns r JOIN public.sale_items i ON i.id = r.sale_item_id AND i.tenant_id = ${tenant}::uuid JOIN public.sales s ON s.id = i.sale_id AND s.tenant_id = ${tenant}::uuid AND s.status = 'completed' WHERE r.tenant_id = ${tenant}::uuid AND r.created_at >= ${start}::timestamptz AND r.created_at < ${end}::timestamptz
  ) SELECT to_char(occurred AT TIME ZONE 'Asia/Dhaka', CASE WHEN ${monthly} THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) AS date, SUM(sales)::text AS sales, SUM(purchases)::text AS purchases, SUM(returns)::text AS "salesReturns" FROM events GROUP BY 1 ORDER BY 1`.returnsRow({ date: "pg/text@1", sales: "pg/text@1", purchases: "pg/text@1", salesReturns: "pg/text@1" }).build());
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const points = [];
  for (let date = range.from; date <= range.to; date = monthly ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10) : addDays(date, 1)) {
    const key = monthly ? date.slice(0, 7) : date, row = byDate.get(key);
    const sales = row?.sales ?? "0.00", salesReturns = row?.salesReturns ?? "0.00";
    points.push({ date: key, sales, purchases: row?.purchases ?? "0.00", salesReturns, netSales: netAmount(sales, salesReturns) });
  }
  return { period: range, points, monthly };
}
