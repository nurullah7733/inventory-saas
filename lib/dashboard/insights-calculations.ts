import { addDays, daysBetween } from "../dates.ts";
import { fromCents, toCents } from "../numeric.ts";
import type { DashboardPeriod } from "./types.ts";
import type { ChartWindow } from "./insights-types.ts";

export function chartPeriod(period: DashboardPeriod, window: ChartWindow, today: string): DashboardPeriod {
  if (window === "selected") return period;
  if (window === "7d" || window === "30d") return { from: addDays(today, window === "7d" ? -6 : -29), to: today };
  const firstMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 11);
  return { from: firstMonth.toISOString().slice(0, 10), to: today };
}

export function previousPeriod(period: DashboardPeriod): DashboardPeriod {
  const length = daysBetween(period.from, period.to) + 1;
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}
export function netAmount(gross: string, returns: string) { return fromCents(toCents(gross) - toCents(returns)); }
export function grossProfit(netSales: string, netCogs: string) { return netAmount(netSales, netCogs); }
/** Exact two-decimal percentage; the visual width alone is capped at 100%. */
export function returnPercentage(amount: string, total: string): { percentage: string; barPercent: number } | null {
  const denominator = toCents(total);
  if (denominator === BigInt(0)) return null;
  const hundredths = (toCents(amount) * BigInt(10000) + denominator / BigInt(2)) / denominator;
  const capped = hundredths < BigInt(0) ? BigInt(0) : hundredths > BigInt(10000) ? BigInt(10000) : hundredths;
  return { percentage: fromCents(hundredths), barPercent: Number(capped) / 100 };
}
/** Signed percentage with an absolute baseline; null means no nonzero baseline. */
export function periodComparison(current: string, previous: string): string | null {
  const currentCents = toCents(current), baseline = toCents(previous);
  if (baseline === BigInt(0)) return currentCents === BigInt(0) ? "0.00" : null;
  const magnitude = baseline < BigInt(0) ? -baseline : baseline;
  const delta = currentCents - baseline;
  const absolute = delta < BigInt(0) ? -delta : delta;
  const hundredths = (absolute * BigInt(10000) + magnitude / BigInt(2)) / magnitude;
  return `${delta < BigInt(0) && hundredths !== BigInt(0) ? "-" : ""}${fromCents(hundredths)}`;
}

/** KPI presentation uses percentages only for a positive previous value. */
export function formatKpiPercentage(percent: string): string {
  const hundredths = toCents(percent.replace("-", ""));
  if (hundredths >= BigInt(10000)) return ((hundredths + BigInt(50)) / BigInt(100)).toLocaleString("en-US");
  const tenths = (hundredths + BigInt(5)) / BigInt(10);
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}
export function kpiComparison(current: string, previous: string, expense = false): { label: string; tone: "neutral" | "positive" | "negative" } {
  const value = toCents(current), baseline = toCents(previous);
  if (value === baseline) return { label: "— No change", tone: "neutral" };
  if (baseline === BigInt(0) && value > BigInt(0)) return { label: "New", tone: "positive" };
  if (baseline <= BigInt(0)) return { label: "— No positive baseline", tone: "neutral" };
  const percent = periodComparison(current, previous)!;
  const decreasing = value < baseline;
  return { label: `${decreasing ? "▼" : "▲"} ${formatKpiPercentage(percent)}% vs previous period`, tone: (expense ? decreasing : !decreasing) ? "positive" : "negative" };
}
