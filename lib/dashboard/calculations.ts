import { addDays } from "../dates.ts";
import { fromCents, toCents } from "../numeric.ts";
import { DASHBOARD_TIME_ZONE, dashboardDay, dashboardWeek, type DashboardPeriod, type DashboardSummary, type TopSellingProduct } from "./types.ts";

export interface DashboardDailySales { date: string; sales: string; invoices: string }
export interface DashboardDailyReturns { date: string; salesReturns: string }
export interface DashboardDailyPurchases { date: string; purchases: string; purchaseReturns: string }
export function buildDashboardSummary(period: DashboardPeriod, data: {
  sales: DashboardDailySales[]; returns: DashboardDailyReturns[]; purchases: DashboardDailyPurchases[];
  topProducts: TopSellingProduct[];
}, currency: string, now = new Date()): DashboardSummary {
  const today = dashboardDay(now), week = dashboardWeek(today);
  function totals(range: DashboardPeriod) {
    const within = (date: string) => date >= range.from && date <= range.to;
    let sales = BigInt(0), salesReturns = BigInt(0), purchases = BigInt(0), purchaseReturns = BigInt(0), invoices = BigInt(0);
    for (const row of data.sales) if (within(row.date)) { sales += toCents(row.sales); invoices += BigInt(row.invoices); }
    for (const row of data.returns) if (within(row.date)) salesReturns += toCents(row.salesReturns);
    for (const row of data.purchases) if (within(row.date)) { purchases += toCents(row.purchases); purchaseReturns += toCents(row.purchaseReturns); }
    return { sales: fromCents(sales), salesReturns: fromCents(salesReturns), purchases: fromCents(purchases), purchaseReturns: fromCents(purchaseReturns),
      netSales: fromCents(sales - salesReturns), netPurchases: fromCents(purchases - purchaseReturns), completedInvoices: invoices.toString() };
  }
  const dailySales = new Map(data.sales.map((r) => [r.date, r.sales]));
  const dailyReturns = new Map(data.returns.map((r) => [r.date, r.salesReturns]));
  const trend = [];
  for (let date = period.from; date <= period.to; date = addDays(date, 1)) {
    const sales = dailySales.get(date) ?? "0.00", salesReturns = dailyReturns.get(date) ?? "0.00";
    trend.push({ date, sales, salesReturns, netSales: fromCents(toCents(sales) - toCents(salesReturns)) });
  }
  return { period, today, timeZone: DASHBOARD_TIME_ZONE, currency, generatedAt: now.toISOString(), totals: totals(period), trend,
    topProducts: data.topProducts, week: { ...week, ...totals(week) } };
}
