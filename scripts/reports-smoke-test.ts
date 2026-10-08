import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { numeric } from "../lib/numeric.ts";
import type { Report, ReportKind } from "../lib/reports/types.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
async function request(path: string, token?: string) {
  const response = await fetch(`${base}/api/v1/reports/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
}
async function fixture(populate: boolean) {
  const user = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Reports smoke ${Date.now()}`, email: "reports@example.com", vatPercentage: numeric("0.00") });
    tenants.push(tenant.id);
    const owner = await tx.orm.public.User.select("id").create({ tenantId: tenant.id, name: "Reports tester", email: `reports-${tenant.id}@example.com`, passwordHash: "unused-smoke-password", role: "shop_owner" });
    const own = <T extends object>(value: T) => ({ ...value, tenantId: tenant.id });
    if (populate) {
      const customer = await tx.orm.public.Customer.select("id").create(own({ name: "Smoke Customer" }));
      const supplier = await tx.orm.public.Supplier.select("id").create(own({ name: "Smoke Supplier" }));
      const product = await tx.orm.public.Product.select("id").create(own({ name: "Smoke Product", sku: "REPORTS", stockQty: 3, costPrice: numeric("99.00"), sellPrice: numeric("50.00") }));
      const sale = await tx.orm.public.Sale.select("id").create(own({ customerId: customer.id, invoiceNo: "REPORTS-1", status: "completed", subtotal: numeric("100.00"), discount: numeric("0.00"), vatAmount: numeric("10.00"), totalAmount: numeric("110.00"), paidAmount: numeric("20.00"), soldBy: owner.id, createdAt: "2026-10-01T00:00:00Z" }));
      const item = await tx.orm.public.SaleItem.select("id").create(own({ saleId: sale.id, productId: product.id, quantity: 2, unitCost: numeric("30.00"), unitPrice: numeric("50.00"), subtotal: numeric("100.00") }));
      await tx.orm.public.SaleReturn.create(own({ saleItemId: item.id, quantity: 1, refundAmount: numeric("55.00"), createdBy: owner.id, createdAt: "2026-10-02T00:00:00Z" }));
      // A draft in the same range must contribute neither orders nor sales.
      await tx.orm.public.Sale.create(own({ invoiceNo: "REPORTS-DRAFT", status: "draft", subtotal: numeric("999.00"), discount: numeric("0.00"), vatAmount: numeric("0.00"), totalAmount: numeric("999.00"), paidAmount: numeric("0.00"), soldBy: owner.id, createdAt: "2026-10-01T00:00:00Z" }));
      await tx.orm.public.Expense.create(own({ title: "Smoke expense", amount: numeric("5.00"), expenseDate: "2026-10-01", createdBy: owner.id }));
      await tx.orm.public.Wastage.create(own({ productId: product.id, quantity: 1, lossAmount: numeric("9.00"), createdBy: owner.id, createdAt: "2026-10-03T00:00:00Z" }));
      for (const [date, quantity] of [["2026-09-01T00:00:00Z", 3], ["2026-10-01T00:00:00Z", 10]] as const) {
        await tx.orm.public.StockMovement.create(own({ productId: product.id, supplierId: supplier.id, type: "in", quantity, unitCost: numeric("10.00"), createdBy: owner.id, createdAt: date }));
      }
      await tx.orm.public.SupplierPayment.create(own({ supplierId: supplier.id, amount: numeric("20.00"), paymentDate: "2026-10-02", createdBy: owner.id }));
    }
    return { id: owner.id, tenantId: tenant.id };
  });
  const session = await withRlsBypass(() => issueSession({ userId: user.id, tenantId: user.tenantId, deviceId: "reports-smoke" }));
  return (await signAccessToken({ userId: user.id, tenantId: user.tenantId, role: "shop_owner", sessionId: session.sessionId })).token;
}
async function cleanup() {
  for (const tenantId of tenants) await withRlsBypass(async (tx) => {
    await tx.orm.public.SaleReturn.where({ tenantId }).deleteAll();
    await tx.orm.public.SaleItem.where({ tenantId }).deleteAll();
    await tx.orm.public.Sale.where({ tenantId }).deleteAll();
    await tx.orm.public.Wastage.where({ tenantId }).deleteAll();
    await tx.orm.public.StockMovement.where({ tenantId }).deleteAll();
    await tx.orm.public.SupplierPayment.where({ tenantId }).deleteAll();
    await tx.orm.public.Expense.where({ tenantId }).deleteAll();
    await tx.orm.public.Product.where({ tenantId }).deleteAll();
    await tx.orm.public.Customer.where({ tenantId }).deleteAll();
    await tx.orm.public.Supplier.where({ tenantId }).deleteAll();
    await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
    await tx.orm.public.User.where({ tenantId }).deleteAll();
    await tx.orm.public.Tenant.where({ id: tenantId }).delete();
  });
}
async function main() {
  assert.equal((await request("sales?from=2026-10-01&to=2026-10-08")).status, 401);
  try {
    const a = await fixture(true), b = await fixture(false);
    const reports = new Map<ReportKind, Report>();
    for (const kind of ["sales", "profit-loss", "due", "payable", "stock", "expense"] as const) {
      const path = `${kind}?from=2026-10-01&to=2026-10-08`;
      const result = await request(path, a);
      assert.equal(result.status, 200, `${kind}: ${JSON.stringify(result.body)}`);
      assert.equal(result.cache, "private, no-store");
      reports.set(kind, result.body.data.report);
      const other = await request(path, b);
      assert.equal(other.status, 200);
      assert.ok(other.body.data.report.tables.every((t: { rows: unknown[] }) => t.rows.length === 0), `${kind}: tenant isolation`);
      console.log(`ok ${kind}: authenticated report, no cache, tenant isolation`);
    }
    const metric = (kind: ReportKind, label: string) => reports.get(kind)!.summary.find((m) => m.label === label)?.value;
    assert.equal(metric("sales", "Orders"), 1);
    assert.equal(metric("sales", "Sales incl. VAT"), "110.00");
    assert.equal(metric("profit-loss", "COGS (after returns)"), "30.00");
    assert.equal(metric("profit-loss", "Net profit"), "20.00");
    assert.equal(metric("profit-loss", "Wastage loss (separate)"), "9.00");
    assert.equal(metric("due", "Total customer due"), "35.00");
    assert.equal(metric("payable", "Total payable"), "110.00");
    assert.equal(metric("stock", "Value at current cost"), "297.00");
    assert.equal(reports.get("stock")!.tables[1].rows.length, 1);
    assert.equal(metric("expense", "Total expense"), "5.00");
    assert.equal((await request("sales?from=2026-02-30&to=2026-10-08", a)).status, 422);
    assert.equal((await request("sales?from=2026-10-09&to=2026-10-08", a)).status, 422);
    assert.equal((await request("sales?from=2026-10-01&to=2026-10-08&tenant_id=spoof", a)).status, 403);
    assert.equal((await request("missing?from=2026-10-01&to=2026-10-08", a)).status, 404);
    const excluded = await request("sales?from=2026-10-04&to=2026-10-08", a);
    assert.equal(excluded.body.data.report.summary.find((m: { label: string }) => m.label === "Orders").value, 0);
    console.log("Reports API smoke tests passed.");
  } finally { await cleanup(); }
}
if (process.argv.includes("--cleanup-stale")) {
  withRlsBypass(async (tx) => {
    const rows = await tx.orm.public.Tenant.where({ email: "reports@example.com" }).select("id", "name").all();
    for (const row of rows.filter((r) => /^Reports smoke \d+$/.test(r.name))) {
      const user = await tx.orm.public.User.where({ tenantId: row.id, email: `reports-${row.id}@example.com`, passwordHash: "unused-smoke-password" }).first();
      if (user) tenants.push(row.id);
    }
  }).then(cleanup).then(() => console.log(`Removed ${tenants.length} stale reports test fixture(s).`))
    .catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
}
