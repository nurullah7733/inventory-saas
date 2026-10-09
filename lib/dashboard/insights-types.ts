import { z } from "zod";
import { dashboardFilterSchema, type DashboardPeriod, type DashboardTotals, type TopSellingProduct } from "./types.ts";

export const INSIGHT_SECTIONS = ["comparison", "finance", "stock", "dues", "products", "invoices", "categories", "returns"] as const;
export type InsightSection = typeof INSIGHT_SECTIONS[number];
export const insightsFilterSchema = dashboardFilterSchema.safeExtend({ section: z.enum(INSIGHT_SECTIONS).optional() });
export interface DashboardInsights {
  comparison: { period: DashboardPeriod; totals: DashboardTotals };
  finance: { expenses: string; cogs: string; grossProfit: string; previousExpenses: string; previousGrossProfit: string };
  stock: { wastage: string };
  dues: { receivable: string; payable: string };
  products: (TopSellingProduct & { imageUrl: string | null; revenue: string })[];
  invoices: { id: string; invoiceNo: string; customer: string; amount: string; status: "completed" | "draft" }[];
  categories: { id: string; name: string; revenue: string }[];
  returns: { salesCount: string; purchaseCount: string };
}
export type InsightResult<T> = { data: T; error?: never } | { data?: never; error: string };
export type InsightsResponse = { period: DashboardPeriod; sections: { [K in InsightSection]?: InsightResult<DashboardInsights[K]> } };
export type ChartWindow = "selected" | "7d" | "30d" | "12m";
export interface SalesChartPoint { date: string; sales: string; purchases: string; salesReturns: string; netSales: string }
export interface SalesChartResponse { period: DashboardPeriod; points: SalesChartPoint[]; monthly: boolean }
