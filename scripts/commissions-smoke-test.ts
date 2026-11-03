import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { tenantScope, type TenantScope } from "../lib/tenant/scope.ts";
import { numeric } from "../lib/numeric.ts";
import { saveInvoice, createReturn } from "../lib/sales/service.ts";
import { invoiceSchema } from "../lib/sales/schemas.ts";
import { getInvoice } from "../lib/sales/queries.ts";
import { invoicePrintDocument } from "../lib/sales/invoice-print.ts";
import { commissionReport, saveCommissionPolicy, recordCommissionPayment } from "../lib/commissions/service.ts";
import { currentCommissionMonth, monthBounds } from "../lib/commissions/calculations.ts";

const fixtureIds: string[] = [];
const month = currentCommissionMonth();
const previous = new Date(monthBounds(month).from);
const previousMonth = currentCommissionMonth(new Date(previous.getTime() - 1000));
const olderMonth = currentCommissionMonth(new Date(new Date(monthBounds(previousMonth).from).getTime() - 1000));

try {
  const fixture = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: "Commission test", email: `${randomUUID()}@example.com`, vatPercentage: numeric("10"), lowStockThreshold: 5 });
    const foreign = await tx.orm.public.Tenant.select("id").create({ name: "Other commission test", email: `${randomUUID()}@example.com`, vatPercentage: numeric("0"), lowStockThreshold: 5 });
    const users = [];
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      users.push(await tx.orm.public.User.select("id", "role").create({ tenantId: tenant.id, role, name: `Original ${role}`, email: `${randomUUID()}@example.com`, passwordHash: "test-no-login" }));
    }
    const product = await tx.orm.public.Product.select("id").create({ tenantId: tenant.id, name: "Kids sandal", sku: "COMMISSION", costPrice: numeric("50"), sellPrice: numeric("20000"), stockQty: numeric("100") });
    const variant = await tx.orm.public.ProductVariant.select("id").create({ tenantId: tenant.id, productId: product.id, label: "XS", sku: "COMMISSION-XS", costPrice: numeric("50"), sellPrice: numeric("20000"), stockQty: numeric("100") });
    return { tenantId: tenant.id, foreignId: foreign.id, users, productId: product.id, variantId: variant.id };
  });
  fixtureIds.push(fixture.tenantId, fixture.foreignId);
  const [owner, manager, staff] = fixture.users;
  const run = <T>(fn: (scope: TenantScope) => Promise<T>) => withTenantRls(fixture.tenantId, () => fn(tenantScope(fixture.tenantId)));
  const plan = { userId: staff.id, month, enabled: true, target: "100000.00", rate: "5.00" };
  await run((scope) => saveCommissionPolicy(scope, owner, plan));
  await assert.rejects(run((scope) => saveCommissionPolicy(scope, staff, plan)), /Only the shop owner/);
  await assert.rejects(run((scope) => saveCommissionPolicy(scope, manager, plan)), /Only the shop owner/);
  await assert.rejects(run((scope) => saveCommissionPolicy(scope, owner, { ...plan, userId: owner.id })), /staff member or manager/);
  await assert.rejects(run((scope) => saveCommissionPolicy(scope, owner, { ...plan, month: previousMonth })), /Past months/);
  const items = [{ productId: fixture.productId, variantId: fixture.variantId, quantity: 6, unitPrice: "20000" }];
  const sale = await run((scope) => saveInvoice(scope, staff.id, invoiceSchema.parse({ status: "completed", items, paidAmount: "132000", paymentMethod: "cash" })));
  assert.equal(sale.creatorName, "Original staff");
  assert.equal(sale.sellerName, "Original staff");
  const report = await run((scope) => commissionReport(scope, owner, { month, userId: staff.id, page: 1 }));
  assert.equal(report.rows[0].eligibleSales, "120000.00", "VAT excluded");
  assert.equal(report.rows[0].earned, "1000.00", "only excess earns commission");
  assert.equal(Number(report.rows[0].soldQuantity), 6);
  assert.equal(report.products[0].name, "Kids sandal");
  assert.equal(report.products[0].variant, "XS");
  const draftInput = invoiceSchema.parse({ status: "draft", items: [{ ...items[0], quantity: 1, unitPrice: "100" }] });
  const draft = await run((scope) => saveInvoice(scope, owner.id, draftInput));
  const completed = await run((scope) => saveInvoice(scope, manager.id, invoiceSchema.parse({ ...draftInput, status: "completed", paidAmount: "110", paymentMethod: "cash" }), draft.id));
  assert.equal(completed.creatorName, "Original shop_owner", "creator survives draft handoff");
  assert.equal(completed.sellerName, "Original manager", "completion actor receives sale credit");
  await run(async (scope) => { await scope.User.where({ id: manager.id }).update({ name: "Changed manager" }); });
  const reprinted = await run((scope) => getInvoice(scope, completed.id));
  assert.equal(reprinted?.sellerName, "Original manager", "historical name survives profile edits");
  const printDoc = invoicePrintDocument(reprinted!, { name: "Shop", address: null, phone: null, email: "test@example.com", currencySymbol: "BDT" }, "a4");
  assert.match(printDoc, /Sold by: Original manager/);
  assert.doesNotMatch(printDoc, /Created by:/);
  await assert.rejects(run((scope) => commissionReport(scope, staff, { month, userId: manager.id, page: 1 })), /own commission/);
  const ownReport = await run((scope) => commissionReport(scope, staff, { month, page: 1 }));
  assert.deepEqual(ownReport.rows.map((row) => row.userId), [staff.id]);
  assert.equal(ownReport.canManage, false);
  await withTenantRls(fixture.foreignId, async () => {
    const scope = tenantScope(fixture.foreignId);
    assert.equal(await scope.CommissionPeriod.where({ userId: staff.id }).first(), null);
    await assert.rejects(commissionReport(scope, owner, { month, userId: staff.id, page: 1 }), /User not found/);
    await assert.rejects(saveCommissionPolicy(scope, owner, plan), /from this shop/);
  });
  const customer = await run((scope) => scope.Customer.select("id").create(scope.own({ name: "Partial payer" })));
  await run((scope) => saveInvoice(scope, manager.id, invoiceSchema.parse({ status: "completed", items: [{ ...items[0], quantity: 1, unitPrice: "1000" }], discount: "100", paidAmount: "495", paymentMethod: "cash", customerId: customer.id })));
  const managerReport = await run((scope) => commissionReport(scope, manager, { month, page: 1 }));
  assert.equal(managerReport.rows[0].eligibleSales, "1000.00", "full goods value, VAT and discount excluded");
  assert.equal(managerReport.rows[0].earned, "0.00", "commission opt-in required");
  await run(async (scope) => {
    await scope.CommissionPeriod.where({ userId: staff.id, month }).update({ month: olderMonth });
    await scope.Sale.where({ id: sale.id }).update({ completedAt: new Date(new Date(monthBounds(olderMonth).from).getTime() + 1000).toISOString() });
  });
  const payment = { requestId: randomUUID(), month: olderMonth, userId: staff.id, amount: "600.00", note: "Paid in cash" };
  const payments = await Promise.allSettled([
    run((scope) => recordCommissionPayment(scope, owner, payment)),
    run((scope) => recordCommissionPayment(scope, owner, { ...payment, requestId: randomUUID() })),
  ]);
  assert.equal(payments.filter((result) => result.status === "fulfilled").length, 1, "concurrent overpayment prevented");
  const savedPayment = payments.find((result) => result.status === "fulfilled")!;
  assert.equal(savedPayment.status, "fulfilled");
  if (savedPayment.status !== "fulfilled") throw new Error("Payment failed");
  const retried = await run((scope) => recordCommissionPayment(scope, owner, { ...payment, requestId: savedPayment.value.id }));
  assert.equal(retried.id, savedPayment.value.id, "retry never pays twice");
  await assert.rejects(run((scope) => recordCommissionPayment(scope, owner, { ...payment, requestId: savedPayment.value.id, amount: "1" })), /already used/);
  await run((scope) => createReturn(scope, owner.id, { requestId: randomUUID(), saleItemId: sale.items[0].id, quantity: 1, reason: "Return after commission payment" }));
  const reduced = await run((scope) => commissionReport(scope, owner, { month: olderMonth, userId: staff.id, page: 1 }));
  assert.equal(reduced.rows[0].earned, "0.00");
  assert.equal(reduced.rows[0].overpaid, "600.00");
  assert.equal(reduced.availableToPay, "0.00");
  const nextSale = await run((scope) => saveInvoice(scope, staff.id, invoiceSchema.parse({ status: "completed", items: [{ ...items[0], quantity: 1 }], paidAmount: "22000", paymentMethod: "cash" })));
  await run(async (scope) => {
    await scope.CommissionPeriod.create(scope.own({ userId: staff.id, month: previousMonth, target: numeric("0"), rate: numeric("5"), enabled: true }));
    await scope.Sale.where({ id: nextSale.id }).update({ completedAt: new Date(new Date(monthBounds(previousMonth).from).getTime() + 1000).toISOString() });
  });
  const adjusted = await run((scope) => commissionReport(scope, owner, { month: previousMonth, userId: staff.id, page: 1 }));
  assert.equal(adjusted.rows[0].earned, "1000.00");
  assert.equal(adjusted.availableToPay, "400.00", "prior overpayment reduces next payable amount");
  await assert.rejects(run((scope) => recordCommissionPayment(scope, owner, { ...payment, requestId: randomUUID(), month: previousMonth, amount: "401" })), /Available commission is 400.00/);
  await run((scope) => recordCommissionPayment(scope, owner, { ...payment, requestId: randomUUID(), month: previousMonth, amount: "400" }));
  const settled = await run((scope) => commissionReport(scope, staff, { month: previousMonth, page: 1 }));
  assert.equal(settled.availableToPay, "0.00");
  console.log("Commission integration passed: attribution, VAT, discounts, credit sales, returns, permissions, tenant isolation, concurrent payouts, retries and carry-forward adjustments.");
} finally {
  try {
    for (const id of fixtureIds) await withRlsBypass(async (tx) => {
      for (const plan of [
        rawSql`DELETE FROM public.commission_payments WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.commission_periods WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.audit_logs WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.returns WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.stock_movements WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.sale_items WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.sales WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.customers WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.product_variants WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.products WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.users WHERE tenant_id = ${id}::uuid`,
        rawSql`DELETE FROM public.tenants WHERE id = ${id}::uuid`,
      ]) await tx.execute(plan.affectedCount().build());
    });
  } finally { await db.close(); }
}
