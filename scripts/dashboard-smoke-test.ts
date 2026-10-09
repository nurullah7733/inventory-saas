import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { dashboardDay, dashboardWeek } from "../lib/dashboard/types.ts";
import { addDays } from "../lib/dates.ts";
import type { UserRole } from "../lib/auth/roles.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
const today = dashboardDay(), timestamp = `${today}T00:00:00+06:00`;
async function fixture(populate: boolean) {
  return withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Dashboard QA ${randomUUID()}`, email: "dashboard-qa@example.com", vatPercentage: numeric("0.00") });
    tenants.push(tenant.id);
    const own = <T extends object>(value: T) => ({ ...value, tenantId: tenant.id });
    async function account(role: UserRole) {
      const user = await tx.orm.public.User.select("id", "name", "email", "tenantId", "role").create(own({ name: "Dashboard QA", email: `dashboard-${randomUUID()}@example.com`, passwordHash: "unused-dashboard-qa", role }));
      const session = await issueSession({ userId: user.id, tenantId: tenant.id, deviceId: "dashboard-qa" });
      return { user, token: (await signAccessToken({ userId: user.id, tenantId: tenant.id, role, sessionId: session.sessionId })).token, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt, sessionId: session.sessionId };
    }
    const owner = await account("shop_owner"), staff = await account("staff");
    if (populate) {
      const supplier = await tx.orm.public.Supplier.select("id").create(own({ name: "Dashboard supplier" }));
      const products = [];
      for (const [name, isDeleted] of [["Best shoe", true], ["Other shoe", false], ["Older shoe", false]] as const)
        products.push(await tx.orm.public.Product.select("id").create(own({ name, sku: name, isDeleted, stockQty: 0, costPrice: numeric("10.25"), sellPrice: numeric("50.00") })));
      const sale = await tx.orm.public.Sale.select("id").create(own({ invoiceNo: "DASH-1", status: "completed", subtotal: numeric("200.00"), discount: numeric("0.00"), vatAmount: numeric("20.00"), totalAmount: numeric("220.00"), paidAmount: numeric("220.00"), soldBy: owner.user.id, createdAt: timestamp }));
      const lines = [];
      for (const [index, quantity] of [[0, 3], [1, 1]] as const)
        lines.push(await tx.orm.public.SaleItem.select("id").create(own({ saleId: sale.id, productId: products[index].id, quantity, unitPrice: numeric("50.00"), unitCost: numeric("10.25"), subtotal: numeric(String(quantity * 50)), createdAt: timestamp })));
      await tx.orm.public.SaleReturn.create(own({ saleItemId: lines[0].id, quantity: 1, refundAmount: numeric("55.00"), createdBy: owner.user.id, createdAt: timestamp }));
      const olderDate = `${addDays(today, -100)}T00:00:00+06:00`;
      const oldSale = await tx.orm.public.Sale.select("id").create(own({ invoiceNo: "DASH-OLD", status: "completed", subtotal: numeric("50.00"), discount: numeric("0.00"), vatAmount: numeric("0.00"), totalAmount: numeric("50.00"), paidAmount: numeric("50.00"), soldBy: owner.user.id, createdAt: olderDate }));
      const oldLine = await tx.orm.public.SaleItem.select("id").create(own({ saleId: oldSale.id, productId: products[2].id, quantity: 1, unitPrice: numeric("50.00"), unitCost: numeric("10.25"), subtotal: numeric("50.00") }));
      await tx.orm.public.SaleReturn.create(own({ saleItemId: oldLine.id, quantity: 1, refundAmount: numeric("50.00"), createdBy: owner.user.id, createdAt: timestamp }));
      const draft = await tx.orm.public.Sale.select("id").create(own({ invoiceNo: "DASH-DRAFT", status: "draft", subtotal: numeric("999.00"), discount: numeric("0.00"), vatAmount: numeric("0.00"), totalAmount: numeric("999.00"), paidAmount: numeric("0.00"), soldBy: owner.user.id, createdAt: timestamp }));
      await tx.orm.public.SaleItem.create(own({ saleId: draft.id, productId: products[1].id, quantity: 100, unitPrice: numeric("9.99"), unitCost: numeric("1.00"), subtotal: numeric("999.00") }));
      const purchase = await tx.orm.public.StockMovement.select("id").create(own({ productId: products[1].id, supplierId: supplier.id, type: "in", quantity: 10, unitCost: numeric("10.25"), createdBy: owner.user.id, createdAt: timestamp }));
      await tx.orm.public.StockMovement.create(own({ productId: products[1].id, supplierId: supplier.id, sourceMovementId: purchase.id, type: "purchase_return", quantity: -2, unitCost: numeric("10.25"), createdBy: owner.user.id, createdAt: timestamp }));
      await tx.orm.public.StockMovement.create(own({ productId: products[1].id, supplierId: null, type: "in", quantity: 1, unitCost: numeric("2.01"), createdBy: owner.user.id, createdAt: timestamp }));
      await tx.orm.public.StockMovement.create(own({ productId: products[1].id, supplierId: null, type: "return", quantity: 2, unitCost: numeric("99.00"), createdBy: owner.user.id, createdAt: timestamp }));
    }
    return { tenantId: tenant.id, owner, staff };
  });
}
async function call(query = "", token?: string) {
  const response = await fetch(`${base}/api/v1/dashboard/summary${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function insightCall(path: string, token?: string) {
  const response = await fetch(`${base}/api/v1/dashboard/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function main() {
  try {
    const a = await fixture(true), b = await fixture(false);
    assert.equal((await call()).status, 401);
    const result = await call(`?from=${today}&to=${today}`, a.owner.token);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const summary = result.body.data.summary;
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(summary.totals, { sales: "220.00", salesReturns: "105.00", purchases: "104.51", purchaseReturns: "20.50", netSales: "115.00", netPurchases: "84.01", completedInvoices: "1" });
    assert.deepEqual(summary.trend, [{ date: today, sales: "220.00", salesReturns: "105.00", netSales: "115.00" }]);
    assert.equal(summary.topProducts.length, 2);
    assert.equal(summary.topProducts[0].name, "Best shoe"); assert.equal(summary.topProducts[0].netQuantity, "2"); assert.equal(summary.topProducts[0].isDeleted, true);
    assert.equal(summary.topProducts[1].name, "Other shoe"); assert.equal(summary.topProducts[1].netQuantity, "1", "Draft invoice lines must not rank");
    assert.equal(summary.week.sales, "220.00"); assert.equal(summary.week.purchases, "104.51"); assert.equal(summary.week.purchaseReturns, "20.50");
    assert.equal(summary.week.from, dashboardWeek(today).from);
    const historical = await call(`?from=${addDays(today, -110)}&to=${addDays(today, -99)}`, a.owner.token);
    assert.equal(historical.status, 200); assert.equal(historical.body.data.summary.totals.sales, "50.00");
    assert.equal(historical.body.data.summary.week.sales, "220.00", "Current week is fetched even for historical selected periods");
    const empty = await call(`?from=${today}&to=${today}`, b.owner.token);
    assert.equal(empty.status, 200); assert.equal(empty.body.data.summary.totals.sales, "0.00"); assert.equal(empty.body.data.summary.topProducts.length, 0);
    assert.equal((await call(`?from=${today}&to=${today}`, a.staff.token)).status, 200);
    const insights = await insightCall(`insights?from=${today}&to=${today}`, a.owner.token);
    assert.equal(insights.status, 200, JSON.stringify(insights.body));
    assert.equal(insights.headers.get("cache-control"), "private, no-store");
    for (const section of ["comparison", "finance", "stock", "dues", "products", "invoices", "categories", "returns"]) assert.ok(insights.body.data.sections[section].data, `${section}: ${JSON.stringify(insights.body)}`);
    assert.equal(insights.body.data.sections.products.data[0].netQuantity, "2");
    assert.equal(insights.body.data.sections.products.data[0].isDeleted, true);
    assert.equal(insights.body.data.sections.finance.data.expenses, "0.00");
    assert.equal(insights.body.data.sections.returns.data.salesCount, "2");
    assert.equal(insights.body.data.sections.returns.data.purchaseCount, "1");
    assert.ok(insights.body.data.sections.invoices.data.some((invoice: { status: string }) => invoice.status === "draft"));
    const staffInsights = await insightCall(`insights?from=${today}&to=${today}`, a.staff.token);
    assert.equal(staffInsights.status, 200); assert.equal(staffInsights.body.data.sections.finance, undefined); assert.equal(staffInsights.body.data.sections.dues, undefined);
    assert.equal((await insightCall("insights?section=finance", a.staff.token)).status, 403);
    assert.equal((await insightCall("insights?section=dues", a.staff.token)).status, 403);
    assert.equal((await insightCall("insights?section=stock", a.owner.token)).status, 200);
    assert.equal((await insightCall("insights")).status, 401);
    for (const path of ["insights?section=invalid", "insights?from=2026-02-30&to=2026-03-01", `insights?from=${addDays(today, 1)}&to=${addDays(today, 1)}`, "chart?window=invalid", "chart?from=2026-01-01&to=2026-12-31"]) assert.equal((await insightCall(path, a.owner.token)).status, 422);
    assert.equal((await insightCall(`insights?tenant_id=${b.tenantId}`, a.owner.token)).status, 403);
    const otherInsights = await insightCall(`insights?from=${today}&to=${today}`, b.owner.token);
    assert.equal(otherInsights.body.data.sections.products.data.length, 0); assert.equal(otherInsights.body.data.sections.invoices.data.length, 0);
    const chart = await insightCall(`chart?from=${today}&to=${today}&window=selected`, a.owner.token);
    assert.equal(chart.status, 200); assert.deepEqual(chart.body.data.points, [{ date: today, sales: "220.00", purchases: "104.51", salesReturns: "105.00", netSales: "115.00" }]);
    const annual = await insightCall("chart?window=12m", a.owner.token);
    assert.equal(annual.status, 200); assert.equal(annual.body.data.points.length, 12); assert.equal(annual.body.data.monthly, true);
    for (const query of ["?from=2026-02-30&to=2026-03-01", "?from=2026-01-01&to=2026-12-31", `?from=${today}`, `?from=${addDays(today, 1)}&to=${addDays(today, 1)}`, "?unknown=1"])
      assert.equal((await call(query, a.owner.token)).status, 422);
    assert.equal((await call(`?tenant_id=${b.tenantId}`, a.owner.token)).status, 403);
    await withRlsBypass((tx) => tx.orm.public.RefreshSession.where({ id: a.staff.sessionId }).update({ revokedAt: new Date().toISOString() }));
    assert.equal((await call("", a.staff.token)).status, 401);
    if (process.env.DASHBOARD_BROWSER_CHECK === "1") {
      const { runDashboardBrowserCheck } = await import("./dashboard-browser-check.ts");
      await runDashboardBrowserCheck(base, { user: { ...a.owner.user, pinEnabled: false }, tenant: null, refreshToken: a.owner.refreshToken, refreshExpiresAt: a.owner.refreshExpiresAt });
    }
    console.log("Dashboard API smoke tests passed: exact totals, both return types, draft exclusion, net product ranking, historical/weekly ranges, filters, live session and tenant isolation.");
  } finally {
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.SaleReturn.where({ tenantId }).deleteAll();
      await tx.orm.public.SaleItem.where({ tenantId }).deleteAll();
      await tx.orm.public.Sale.where({ tenantId }).deleteAll();
      await tx.orm.public.StockMovement.where({ tenantId, type: "purchase_return" }).deleteAll();
      await tx.orm.public.StockMovement.where({ tenantId }).deleteAll();
      await tx.orm.public.Product.where({ tenantId }).deleteAll();
      await tx.orm.public.Supplier.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
