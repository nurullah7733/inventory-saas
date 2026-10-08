import assert from "node:assert/strict";
import { buildDashboardSummary } from "../lib/dashboard/calculations.ts";
import { dashboardDay, dashboardFilterSchema, dashboardWeek } from "../lib/dashboard/types.ts";

const now = new Date("2026-10-08T12:00:00Z");
assert.equal(dashboardDay(new Date("2026-10-07T18:00:00Z")), "2026-10-08");
assert.deepEqual(dashboardWeek("2026-10-08"), { from: "2026-10-05", to: "2026-10-11" });
assert.deepEqual(dashboardWeek("2026-10-11"), { from: "2026-10-05", to: "2026-10-11" });
assert.deepEqual(dashboardWeek("2026-10-12"), { from: "2026-10-12", to: "2026-10-18" });
for (const invalid of [{ from: "2026-02-30", to: "2026-10-08" }, { from: "2026-10-09", to: "2026-10-08" }, { from: "2026-10-01" }, { from: "2026-01-01", to: "2026-10-08" }, { tenantId: "spoof" }])
  assert.equal(dashboardFilterSchema.safeParse(invalid).success, false);
assert.equal(dashboardFilterSchema.safeParse({ from: "2026-01-01", to: "2026-04-03" }).success, true, "Exactly 93 calendar days allowed");
const data = { sales: [{ date: "2026-10-01", sales: "110.00", invoices: "1" }, { date: "2026-10-05", sales: "99.99", invoices: "2" }],
  returns: [{ date: "2026-10-02", salesReturns: "120.50" }, { date: "2026-10-05", salesReturns: "0.01" }],
  purchases: [{ date: "2026-10-01", purchases: "30.50", purchaseReturns: "0.00" }, { date: "2026-10-05", purchases: "45.99", purchaseReturns: "10.25" }], topProducts: [] };
const summary = buildDashboardSummary({ from: "2026-10-01", to: "2026-10-03" }, data, "BDT", now);
assert.deepEqual(summary.totals, { sales: "110.00", salesReturns: "120.50", purchases: "30.50", purchaseReturns: "0.00", netSales: "-10.50", netPurchases: "30.50", completedInvoices: "1" });
assert.equal(summary.trend.length, 3);
assert.deepEqual(summary.trend[2], { date: "2026-10-03", sales: "0.00", salesReturns: "0.00", netSales: "0.00" }, "Empty days are zero-filled");
assert.equal(summary.trend[1].netSales, "-120.50", "Return-only days can be negative");
assert.equal(summary.week.sales, "99.99", "Current week is independent of the selected date range");
assert.equal(summary.week.netSales, "99.98"); assert.equal(summary.week.netPurchases, "35.74");
const empty = buildDashboardSummary({ from: "2026-10-01", to: "2026-10-08" }, { sales: [], returns: [], purchases: [], topProducts: [] }, "BDT", now);
assert.equal(empty.totals.sales, "0.00"); assert.equal(empty.week.purchases, "0.00"); assert.equal(empty.trend.length, 8);
const large = buildDashboardSummary({ from: "2026-10-01", to: "2026-10-01" }, { sales: [{ date: "2026-10-01", sales: "9007199254740993.01", invoices: "2" }], returns: [{ date: "2026-10-01", salesReturns: "0.01" }], purchases: [], topProducts: [] }, "BDT", now);
assert.equal(large.totals.netSales, "9007199254740993.00", "Large totals must not pass through floating point");
console.log("Dashboard calculation tests passed: Dhaka dates, week boundaries, filters, exact totals, return-only days, zero fill and independent weekly comparison.");
