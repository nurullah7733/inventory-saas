import { z } from "zod";
import { isCalendarDate } from "../dates.ts";

export const REPORT_KINDS = ["sales", "profit-loss", "due", "payable", "stock", "expense"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABELS: Record<ReportKind, string> = {
  sales: "Sales", "profit-loss": "Profit & Loss", due: "Customer Due",
  payable: "Supplier Payable", stock: "Stock", expense: "Expense",
};
const date = z.string().refine(isCalendarDate, "Use a valid YYYY-MM-DD date.");
export const reportFilterSchema = z.object({ from: date, to: date }).strict()
  .refine((v) => v.from <= v.to, { path: ["to"], message: "End date must be on or after start date." });
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type Cell = string | number;
export interface ReportTable { title: string; columns: string[]; rows: Cell[][] }
export interface Report {
  kind: ReportKind; title: string; business: string; currency: string;
  from: string; to: string; generatedAt: string;
  summary: { label: string; value: Cell; money?: boolean }[];
  notes: string[]; tables: ReportTable[];
  trend: { date: string; sales: string; netProfit?: string }[];
}
