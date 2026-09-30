import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { numeric } from "../lib/numeric.ts";
import type { InvoiceDetail, InvoiceList, ReturnEntry } from "../lib/sales/types.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenantIds: string[] = [];
let passed = 0;
function check(value: unknown, label: string) { assert.ok(value, label); passed++; console.log(`ok ${label}`); }
async function call<T>(path: string, token = "", method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, { method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const result = await response.json() as { ok: boolean; data: T; error?: { message: string } };
  return { status: response.status, ...result };
}
async function fixture() {
  const id = randomUUID();
  const result = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.create({ id, name: `Sales test ${id}`, email: `${id}@example.com`, vatPercentage: numeric("15.00") });
    const user = await tx.orm.public.User.create({ tenantId: tenant.id, name: "Test staff", email: `${id}-staff@example.com`, passwordHash: "unused-test-account", role: "staff" });
    const customer = await tx.orm.public.Customer.create({ tenantId: tenant.id, name: "Test buyer" });
    const products = [];
    for (let index = 0; index < 2; index++) {
      products.push(await tx.orm.public.Product.create({ tenantId: tenant.id, name: `Test item ${index}`, sku: `TEST-${index}`, stockQty: 10,
        costPrice: numeric("40.00"), sellPrice: numeric("100.00") }));
    }
    products.sort((a, b) => a.id.localeCompare(b.id));
    return { tenantId: tenant.id, userId: user.id, customerId: customer.id, products };
  });
  tenantIds.push(id);
  const session = await withRlsBypass(() => issueSession({ userId: result.userId, tenantId: id, deviceId: "sales-smoke" }));
  const { token } = await signAccessToken({ userId: result.userId, tenantId: id, role: "staff", sessionId: session.sessionId });
  return { ...result, token };
}

async function main() {
  const a = await fixture();
  const b = await fixture();
  const productId = a.products[0].id;
  const stock = async () => withRlsBypass(async (tx) => (await tx.orm.public.Product.where({ id: productId, tenantId: a.tenantId }).select("stockQty").first())!.stockQty);
  const input = { customerId: a.customerId, status: "draft", items: [{ productId, quantity: 3, unitPrice: "100.00" }], discount: "30.00", paidAmount: "0.00", paymentMethod: "cash" };
  check((await call("/invoices")).status === 401, "bearer token is required");
  const created = await call<{ invoice: InvoiceDetail }>("/invoices", a.token, "POST", input);
  check(created.status === 201, `staff creates a draft (${created.error?.message ?? "ok"})`);
  const draft = created.data.invoice;
  check(draft.totalAmount === "310.50" && draft.vatAmount === "40.50", "VAT applies after discount");
  check(await stock() === 10, "draft leaves stock unchanged");
  check((await call(`/invoices/${draft.id}`, b.token)).status === 404, "other tenant cannot read invoice");
  check((await call(`/invoices/${draft.id}`, b.token, "PUT", input)).status === 404, "other tenant cannot edit invoice");
  check((await call("/invoices", a.token, "POST", { ...input, customerId: b.customerId })).status === 422, "cross-tenant customer rejected");
  check((await call("/invoices", a.token, "POST", { ...input, items: [{ ...input.items[0], productId: b.products[0].id }] })).status === 422, "cross-tenant product rejected");
  check((await call("/invoices", a.token, "POST", { ...input, tenantId: b.tenantId })).status === 403, "tenant injection rejected");
  check((await call("/invoices", a.token, "POST", { ...input, discount: "301" })).status === 422, "excess discount rejected");
  check((await call("/invoices", a.token, "POST", { ...input, paidAmount: "1" })).status === 422, "draft payment rejected");
  const completedInput = { ...input, status: "completed", paidAmount: "200.00" };
  const completions = await Promise.all([1, 2].map(() => call<{ invoice: InvoiceDetail }>(`/invoices/${draft.id}`, a.token, "PUT", completedInput)));
  check(completions.filter((r) => r.status === 200).length === 1 && completions.filter((r) => r.status === 409).length === 1, "concurrent draft completion succeeds once");
  check(await stock() === 7, "completion decrements stock exactly once");
  const invoice = completions.find((r) => r.status === 200)!.data.invoice;
  check(invoice.dueAmount === "110.50", "partial payment leaves correct due");
  check(invoice.items[0].unitCost === "40.00", "COGS snapshots cost price");
  const completedList = await call<InvoiceList>("/invoices?status=completed", a.token);
  check(completedList.data.total === 1, "completed list includes completed sale");
  check((await call<InvoiceList>("/invoices?status=draft", a.token)).data.total === 0, "completed invoice leaves draft list");
  check((await call<InvoiceList>("/invoices", b.token)).data.total === 0, "list is tenant isolated");

  // First product succeeds, second fails: ALL stock changes must roll back.
  const badCart = { ...completedInput, discount: "0", paidAmount: "0", items: [
    { productId, quantity: 1, unitPrice: "100" }, { productId: a.products[1].id, quantity: 11, unitPrice: "100" },
  ] };
  check((await call("/invoices", a.token, "POST", badCart)).status === 409, "overselling later cart item is refused");
  check(await stock() === 7, "earlier stock decrement rolls back");
  check((await call<InvoiceList>("/invoices", a.token)).data.total === 1, "failed sale leaves no invoice");
  const itemId = invoice.items[0].id;
  const returnInput = { saleItemId: itemId, quantity: 1, reason: "Test return", requestId: randomUUID() };
  check((await call("/returns", b.token, "POST", returnInput)).status === 404, "other tenant cannot return item");
  const firstReturn = await call<{ return: ReturnEntry }>("/returns", a.token, "POST", returnInput);
  check(firstReturn.status === 201 && firstReturn.data.return.refundAmount === "103.50", "return uses original discounted VAT-inclusive value");
  check((await call<{ return: ReturnEntry }>("/returns", a.token, "POST", returnInput)).data.return.id === firstReturn.data.return.id, "return retry is idempotent");
  check(await stock() === 8, "return retry does not restore twice");
  const afterOne = (await call<{ invoice: InvoiceDetail }>(`/invoices/${draft.id}`, a.token)).data.invoice;
  check(afterOne.dueAmount === "7.00" && afterOne.cashRefundAmount === "0.00", "credit reduces due before cash refund");
  const racingReturns = await Promise.all([1, 2].map(() => call("/returns", a.token, "POST", { saleItemId: itemId, quantity: 2, requestId: randomUUID() })));
  check(racingReturns.filter((r) => r.status === 201).length === 1 && racingReturns.filter((r) => r.status === 409).length === 1, "concurrent returns cannot exceed sold quantity");
  check(await stock() === 10, "full return restores original stock");
  const afterAll = (await call<{ invoice: InvoiceDetail }>(`/invoices/${draft.id}`, a.token)).data.invoice;
  check(afterAll.creditAmount === "310.50" && afterAll.cashRefundAmount === "200.00" && afterAll.dueAmount === "0.00", "full return clears due and refunds actual payment only");

  const key = randomUUID();
  const retryInput = { ...completedInput, requestId: key, discount: "0", paidAmount: "115", items: [{ productId, quantity: 1, unitPrice: "100" }] };
  const retries = await Promise.all([1, 2].map(() => call<{ invoice: InvoiceDetail }>("/invoices", a.token, "POST", retryInput)));
  check(retries.every((r) => r.status === 201 && r.data.invoice.id === key), "concurrent create retries use one invoice");
  check(await stock() === 9, "create retries decrement stock once");
  const audit = await withRlsBypass((tx) => tx.orm.public.AuditLog.where({ tenantId: a.tenantId }).select("action").all());
  check(audit.filter((row) => row.action === "sale.complete").length === 2 && audit.filter((row) => row.action === "return.create").length === 2, "successful sales and returns audited once");
  for (const path of ["/sales/create", "/sales/invoices", "/sales/drafts", `/sales/invoices/${draft.id}`, "/inventory/returns"]) {
    const response = await fetch(`${base}${path}`, { headers: { cookie: "has_session=1" }, signal: AbortSignal.timeout(90000) });
    check(response.status === 200, `${path} renders`);
  }
  console.log(`${passed} sales smoke checks passed.`);
}

async function cleanup() {
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      for (const statement of [
        rawSql`DELETE FROM public.audit_logs WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.returns WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.stock_movements WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.sale_items WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.sales WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.products WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.customers WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.refresh_sessions WHERE tenant_id = ${tenantId}::uuid`,
        rawSql`DELETE FROM public.users WHERE tenant_id = ${tenantId}::uuid`,
      ]) await tx.execute(statement.affectedCount().build());
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { try { await cleanup(); } finally { await db.close(); } });
