import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import type { UserRole } from "../lib/auth/roles.ts";
import { reportDay } from "../lib/reports/calculations.ts";
import { withAuditActor } from "../lib/audit/context.ts";
import { createPurchaseReturn } from "../lib/inventory/purchase-return-service.ts";
import { tenantScope } from "../lib/tenant/scope.ts";
import type { AuthUser } from "../lib/auth/context.ts";
import { verifyPurchaseReturnUi } from "./purchase-return-browser-qa.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
async function fixture() {
  return withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Purchase return QA ${randomUUID()}`, email: "purchase-qa@example.com", vatPercentage: numeric("0.00") });
    tenants.push(tenant.id);
    const own = <T extends object>(value: T) => ({ ...value, tenantId: tenant.id });
    async function account(role: UserRole) {
      const user = await tx.orm.public.User.select("id", "name", "email", "tenantId", "role").create(own({ name: "Purchase QA", email: `purchase-${randomUUID()}@example.com`, role, passwordHash: "unused-purchase-qa" }));
      const session = await issueSession({ userId: user.id, tenantId: tenant.id, deviceId: "purchase-qa" });
      const token = (await signAccessToken({ userId: user.id, tenantId: tenant.id, role, sessionId: session.sessionId })).token;
      return { user, token, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt };
    }
    const owner = await account("shop_owner"), manager = await account("manager"), staff = await account("staff");
    const supplier = await tx.orm.public.Supplier.select("id").create(own({ name: "QA Supplier" }));
    const product = await tx.orm.public.Product.select("id").create(own({ name: "QA Shoes", sku: "QA-SHOES", stockQty: 12, costPrice: numeric("99.00"), sellPrice: numeric("120.00") }));
    const purchase = await tx.orm.public.StockMovement.select("id").create(own({ productId: product.id, supplierId: supplier.id, type: "in", quantity: 10, unitCost: numeric("10.25"), createdBy: owner.user.id }));
    const other = await tx.orm.public.StockMovement.select("id").create(own({ productId: product.id, supplierId: supplier.id, type: "in", quantity: 2, unitCost: numeric("50.00"), createdBy: owner.user.id }));
    const noSupplier = await tx.orm.public.StockMovement.select("id").create(own({ productId: product.id, supplierId: null, type: "adjustment", quantity: 0, unitCost: null, createdBy: owner.user.id }));
    return { tenantId: tenant.id, owner, manager, staff, supplierId: supplier.id, productId: product.id, purchaseId: purchase.id, otherId: other.id, noSupplierId: noSupplier.id };
  });
}
async function call(path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function main() {
  try {
    const a = await fixture(), b = await fixture();
    const data = (quantity: number, extra = {}) => ({ requestId: randomUUID(), sourceMovementId: a.purchaseId, quantity, reason: "Damaged packaging", ...extra });
    const stock = () => withTenantRls(a.tenantId, (tx) => tx.orm.public.Product.where({ id: a.productId }).select("stockQty").first());
    const events = () => withTenantRls(a.tenantId, (tx) => tx.orm.public.AuditLog.where({ tenantId: a.tenantId, action: "purchase_return.create" }).all());
    assert.equal((await call("/purchase-returns")).status, 401);
    assert.equal((await call("/purchase-returns", a.staff.token, data(1))).status, 403);
    assert.equal((await call("/purchase-returns", a.owner.token, data(1, { tenant_id: b.tenantId }))).status, 403);
    assert.equal((await call("/purchase-returns", a.owner.token, data(1, { creditAmount: "999.00" }))).status, 422);
    assert.equal((await call("/purchase-returns", a.owner.token, data(0))).status, 422);
    assert.equal((await call("/purchase-returns", a.owner.token, data(1.5))).status, 422);
    assert.equal((await call("/purchase-returns", a.owner.token, data(1, { sourceMovementId: b.purchaseId }))).status, 404);
    assert.equal((await call("/purchase-returns", a.owner.token, data(1, { sourceMovementId: a.noSupplierId }))).status, 422);
    const receipts = await call("/purchase-returns/purchases", a.owner.token);
    assert.equal(receipts.status, 200, JSON.stringify(receipts.body));
    assert.equal(receipts.body.data.total, 2);
    assert.equal(receipts.body.data.purchases.find((p: { id: string }) => p.id === a.purchaseId).returnableQuantity, 10);
    const firstBody = data(2);
    const first = await call("/purchase-returns", a.owner.token, firstBody);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.purchaseReturn.creditAmount, "20.50", "Credit uses original unit cost, not the current product cost");
    assert.equal(first.body.data.purchaseReturn.quantity, -2);
    assert.equal((await stock())!.stockQty, 10);
    assert.equal((await events()).length, 1);
    const replay = await call("/purchase-returns", a.owner.token, firstBody);
    assert.equal(replay.status, 200); assert.equal(replay.body.data.replayed, true);
    assert.equal((await stock())!.stockQty, 10); assert.equal((await events()).length, 1);
    assert.equal((await call("/purchase-returns", a.owner.token, { ...firstBody, quantity: 1 })).status, 409);
    assert.equal((await call("/purchase-returns", a.manager.token, data(1))).status, 201);
    const competing = await Promise.all([call("/purchase-returns", a.owner.token, data(4)), call("/purchase-returns", a.manager.token, data(4))]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [201, 409], "Concurrent returns cannot exceed the original purchase quantity");
    assert.equal((await stock())!.stockQty, 5); assert.equal((await events()).length, 3);
    const receiptAfter = await call("/purchase-returns/purchases", a.owner.token);
    const remaining = receiptAfter.body.data.purchases.find((p: { id: string }) => p.id === a.purchaseId);
    assert.equal(remaining.returnedQuantity, 7); assert.equal(remaining.returnableQuantity, 3);
    await withRlsBypass((tx) => tx.orm.public.Product.where({ id: a.productId }).update({ stockQty: 1 }));
    assert.equal((await call("/purchase-returns", a.owner.token, data(2))).status, 409, "On-hand stock is a separate return limit");
    assert.equal((await stock())!.stockQty, 1); assert.equal((await events()).length, 3);
    await withRlsBypass((tx) => tx.orm.public.Product.where({ id: a.productId }).update({ stockQty: 5, isDeleted: true }));
    assert.equal((await call("/purchase-returns", a.owner.token, data(1))).status, 409);
    assert.equal((await call("/purchase-returns", a.owner.token, firstBody)).status, 200, "A replay remains safe even after the product is archived");
    await withRlsBypass(async (tx) => {
      await tx.orm.public.Product.where({ id: a.productId }).update({ isDeleted: false });
      await tx.orm.public.Supplier.where({ id: a.supplierId }).update({ isActive: false });
    });
    const rollbackId = randomUUID();
    await assert.rejects(withTenantRls(a.tenantId, () => withAuditActor(a.owner.user as AuthUser, () => createPurchaseReturn(tenantScope(a.tenantId), a.staff.user.id,
      { requestId: rollbackId, sourceMovementId: a.purchaseId, quantity: 1, reason: null }))), /verified request user/);
    assert.equal((await stock())!.stockQty, 5, "Audit failure rolls stock back");
    assert.equal(await withTenantRls(a.tenantId, (tx) => tx.orm.public.StockMovement.where({ id: rollbackId }).first()), null);
    const sameRequest = data(1);
    const retries = await Promise.all([call("/purchase-returns", a.owner.token, sameRequest), call("/purchase-returns", a.owner.token, sameRequest)]);
    assert.deepEqual(retries.map((r) => r.status).sort(), [200, 201], "Concurrent duplicate request produces one return");
    assert.equal((await stock())!.stockQty, 4); assert.equal((await events()).length, 4);
    const day = reportDay(new Date().toISOString());
    const report = await call(`/reports/payable?from=${day}&to=${day}`, a.owner.token);
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const metric = (label: string) => report.body.data.report.summary.find((v: { label: string }) => v.label === label).value;
    assert.equal(metric("Purchases"), "202.50"); assert.equal(metric("Purchase return credits"), "82.00"); assert.equal(metric("Total payable"), "120.50");
    const history = await call(`/purchase-returns?supplierId=${a.supplierId}&pageSize=2`, a.staff.token);
    assert.equal(history.status, 200); assert.equal(history.body.data.total, 4); assert.equal(history.body.data.returns.length, 2);
    assert.equal(history.headers.get("cache-control"), "private, no-store");
    assert.equal((await call("/purchase-returns", b.owner.token)).body.data.total, 0);
    assert.equal((await call(`/purchase-returns?tenant_id=${b.tenantId}`, a.owner.token)).status, 403);
    assert.equal((await call("/purchase-returns?from=2026-10-09T00:00:00Z&to=2026-10-08T00:00:00Z", a.owner.token)).status, 422);
    const ledger = await call("/stock-movements?type=purchase_return", a.owner.token);
    assert.equal(ledger.body.data.total, 4);
    assert.ok(ledger.body.data.movements.every((r: { sourceMovementId: string; quantity: number }) => r.sourceMovementId === a.purchaseId && r.quantity < 0));
    assert.equal((await call("/returns", a.owner.token)).body.data.total, 0, "Purchase returns are separate from customer returns");
    await verifyPurchaseReturnUi(base, { user: { ...a.owner.user, pinEnabled: false }, tenant: null,
      refreshToken: a.owner.refreshToken, refreshExpiresAt: a.owner.refreshExpiresAt });
    console.log("Purchase return smoke tests passed: original cost, partial/concurrent returns, idempotency, stock limits, archived products, inactive supplier history, payable credit, permissions, filters, tenant isolation and audit rollback.");
  } finally {
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
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
