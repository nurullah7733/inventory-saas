import { z } from "zod";
import { addDays, daysBetween, isCalendarDate } from "../dates.ts";

export const DASHBOARD_TIME_ZONE = "Asia/Dhaka";
export function dashboardDay(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: DASHBOARD_TIME_ZONE });
}
export function dashboardWeek(today: string) {
  const offset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(today, -offset);
  return { from, to: addDays(from, 6) };
}
const date = z.string().refine(isCalendarDate, "Use a valid YYYY-MM-DD date.");
export const dashboardFilterSchema = z.object({ from: date.optional(), to: date.optional() }).strict()
  .refine((v) => !!v.from === !!v.to, "Provide both from and to dates.")
  .refine((v) => !v.from || !v.to || v.from <= v.to, "End date must follow start date.")
  .refine((v) => !v.from || !v.to || !isCalendarDate(v.from) || !isCalendarDate(v.to) || daysBetween(v.from, v.to) <= 92, "Select at most 93 days.");
export interface DashboardPeriod { from: string; to: string }
export interface DashboardTotals {
  sales: string; purchases: string; salesReturns: string; purchaseReturns: string;
  netSales: string; netPurchases: string; completedInvoices: string;
}
export interface DashboardTrend { date: string; sales: string; salesReturns: string; netSales: string }
export interface TopSellingProduct { id: string; name: string; sku: string; isDeleted: boolean; soldQuantity: string; returnedQuantity: string; netQuantity: string }
export interface DashboardSummary {
  period: DashboardPeriod; timeZone: string; today: string; currency: string; generatedAt: string;
  totals: DashboardTotals; trend: DashboardTrend[]; topProducts: TopSellingProduct[];
  week: DashboardPeriod & { sales: string; purchases: string; salesReturns: string; purchaseReturns: string; netSales: string; netPurchases: string };
}
