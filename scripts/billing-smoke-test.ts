import "dotenv/config";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { db } from "../prisma/db.ts";
import { withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { tenantScope } from "../lib/tenant/scope.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import type { TenantRequestContext } from "../lib/api/guard.ts";
import { createCheckout, createPortal, syncSubscription } from "../lib/billing/service.ts";
import type { BillingConfig } from "../lib/billing/config.ts";
import { BILLING_APP, type BillingGateway, type BillingCheckout, type BillingSubscription, type BillingPrice } from "../lib/billing/stripe.ts";

const config: BillingConfig = { secretKey: "sk_test_mock", webhookSecret: "whsec_mock", appUrl: "http://localhost:3000",
  prices: { basic: "price_basic", pro: "price_pro" }, limits: { basic: { maxProducts: 100, maxStaff: 5 }, pro: { maxProducts: 1000, maxStaff: 20 } } };
const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
interface Fixture { tenantId: string; ownerId: string; ownerToken: string; staffToken: string }
async function fixture(): Promise<Fixture> {
  const rows = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Billing smoke ${Date.now()}`, email: "billing-smoke@example.com", vatPercentage: numeric("0.00"), trialEndsAt: "2030-01-01T00:00:00Z" });
    tenants.push(tenant.id);
    const owner = await tx.orm.public.User.select("id").create({ tenantId: tenant.id, role: "shop_owner", name: "Tester", email: `billing-owner-${tenant.id}@example.com`, passwordHash: "unused-billing-smoke-password" });
    const staff = await tx.orm.public.User.select("id").create({ tenantId: tenant.id, role: "staff", name: "Staff", email: `billing-staff-${tenant.id}@example.com`, passwordHash: "unused-billing-smoke-password" });
    await tx.orm.public.Subscription.create({ tenantId: tenant.id, plan: "trial", status: "trial", amount: numeric("0.00"), startedAt: "2026-10-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" });
    return { tenantId: tenant.id, ownerId: owner.id, staffId: staff.id };
  });
  async function token(userId: string, role: "shop_owner" | "staff") {
    const session = await withRlsBypass(() => issueSession({ userId, tenantId: rows.tenantId, deviceId: "billing-smoke" }));
    return (await signAccessToken({ userId, tenantId: rows.tenantId, role, sessionId: session.sessionId })).token;
  }
  return { ...rows, ownerToken: await token(rows.ownerId, "shop_owner"), staffToken: await token(rows.staffId, "staff") };
}
async function withOwner<T>(f: Fixture, work: (auth: TenantRequestContext) => Promise<T>) {
  return withTenantRls(f.tenantId, async (tx) => {
    const tenant = await tx.orm.public.Tenant.where({ id: f.tenantId }).select("id", "name", "isActive", "subscriptionPlan", "subscriptionStatus", "trialEndsAt", "subscriptionEndsAt").first();
    if (!tenant) throw new Error("Fixture missing.");
    return work({ user: { id: f.ownerId, name: "Tester", email: "tester@example.com", tenantId: f.tenantId, role: "shop_owner", photoUrl: null },
      tenant, tenantId: f.tenantId, sessionId: "test", scope: tenantScope(f.tenantId), db: tx });
  });
}
async function tenant(f: Fixture) { return withTenantRls(f.tenantId, (tx) => tx.orm.public.Tenant.where({ id: f.tenantId }).first()); }
async function history(f: Fixture) { return withTenantRls(f.tenantId, () => tenantScope(f.tenantId).Subscription.where((r) => r.stripeSubscriptionId.isNotNull()).all()); }
const subscriptions = new Map<string, BillingSubscription[]>(), checkouts = new Map<string, BillingCheckout[]>();
let customerCalls = 0, checkoutCalls = 0;
const price = (id: string): BillingPrice => ({ id, active: true, amount: id === "price_basic" ? 1000 : 2500, currency: "usd", interval: "month", intervalCount: 1, usage: "licensed" });
const gateway: BillingGateway = {
  price: async (id) => price(id),
  customer: async ({ tenantId }) => { customerCalls++; return `cus_${tenantId}`; },
  subscriptions: async (customer) => structuredClone(subscriptions.get(customer) ?? []),
  subscription: async (id) => { const s = [...subscriptions.values()].flat().find((s) => s.id === id); if (!s) throw new Error("Missing mocked subscription"); return structuredClone(s); },
  openCheckouts: async (customer) => structuredClone(checkouts.get(customer) ?? []),
  expireCheckout: async (id) => { for (const [customer, rows] of checkouts) checkouts.set(customer, rows.filter((s) => s.id !== id)); },
  checkout: async (input) => {
    const session = { id: `cs_${++checkoutCalls}`, url: `https://checkout.stripe.com/c/pay/cs_${checkoutCalls}`, tenantId: input.tenantId, plan: input.plan, priceId: input.priceId };
    checkouts.set(input.customerId, [...(checkouts.get(input.customerId) ?? []), session]); return session;
  },
  portal: async (customerId, appUrl) => { assert.ok(customerId.startsWith("cus_")); assert.equal(appUrl, config.appUrl); return "https://billing.stripe.com/p/session/test"; },
};
function subscription(f: Fixture, id = "sub_a", overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return { id, customerId: `cus_${f.tenantId}`, status: "active", created: 1790812800,
    metadata: { app: BILLING_APP, tenantId: f.tenantId }, trialEnd: null, canceledAt: null, cancelAtPeriodEnd: false, pauseCollection: false,
    items: [{ price: price("price_pro"), quantity: 1, start: 1790812800, end: 1793491200 }], ...overrides };
}
async function call(path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function cleanup() {
  for (const tenantId of tenants) await withRlsBypass(async (tx) => {
    await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
    await tx.orm.public.Subscription.where({ tenantId }).deleteAll();
    await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
    await tx.orm.public.User.where({ tenantId }).deleteAll();
    await tx.orm.public.Tenant.where({ id: tenantId }).delete();
  });
}
async function main() {
  try {
    const a = await fixture(), b = await fixture();
    assert.equal((await call("/billing")).status, 401);
    assert.equal((await call("/billing/checkout", a.staffToken, { plan: "pro" })).status, 403);
    assert.equal((await call("/billing/portal", a.staffToken, {})).status, 403);
    assert.equal((await call("/billing/checkout", a.ownerToken, { plan: "free" })).status, 422);
    assert.equal((await call("/billing/checkout", a.ownerToken, { plan: "pro", priceId: "price_cheap" })).status, 422);
    assert.equal((await call("/billing/checkout", a.ownerToken, { plan: "pro", tenant_id: b.tenantId })).status, 403);
    assert.equal((await call("/billing/portal", a.ownerToken, { returnUrl: "https://evil.example" })).status, 422);
    assert.equal((await call("/billing/webhook", undefined, {})).status, 400, "Unsigned webhook reaches signature check without bearer auth");
    const webhookSecret = process.env.BILLING_SMOKE_WEBHOOK_SECRET;
    if (webhookSecret) {
      const payload = JSON.stringify({ id: "evt_smoke", type: "payment_intent.succeeded", data: { object: { id: "pi_test" } } });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const signed = (body: string, header: string) => fetch(`${base}/api/v1/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body });
      assert.equal((await signed(payload, signature)).status, 200, "Signed unrelated event acknowledged without DB or Stripe request");
      assert.equal((await signed(payload + " ", signature)).status, 400, "Modified raw body rejected by live webhook route");
      assert.equal((await signed(payload, "bad_signature")).status, 400);
    }
    const summary = await call("/billing", a.ownerToken);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    if (!summary.body.data.billing.configured) assert.equal((await call("/billing/checkout", a.ownerToken, { plan: "pro" })).status, 503);
    const first = await withOwner(a, (auth) => createCheckout(auth, "pro", gateway, config));
    const duplicate = await withOwner(a, (auth) => createCheckout(auth, "pro", gateway, config));
    assert.equal(first.sessionId, duplicate.sessionId); assert.equal(customerCalls, 1); assert.equal(checkoutCalls, 1);
    const basic = await withOwner(a, (auth) => createCheckout(auth, "basic", gateway, config));
    assert.notEqual(basic.sessionId, first.sessionId); assert.equal(checkouts.get(`cus_${a.tenantId}`)!.length, 1);
    await withOwner(b, (auth) => createCheckout(auth, "basic", gateway, config));
    assert.equal(customerCalls, 2);
    assert.match((await withOwner(a, (auth) => createPortal(auth, gateway, config))).url, /^https:\/\/billing.stripe.com/);
    assert.equal((await tenant(a))!.subscriptionStatus, "trial", "Checkout does not grant paid status");
    const state = subscription(a); subscriptions.set(state.customerId, [state]);
    await Promise.all([syncSubscription(state.id, gateway, config), syncSubscription(state.id, gateway, config)]);
    assert.equal((await history(a)).length, 1, "Concurrent duplicate webhook creates one period row");
    const systemLogs = () => withTenantRls(a.tenantId, (tx) => tx.orm.public.AuditLog.where({ tenantId: a.tenantId, userId: null }).all());
    const auditEvents = await systemLogs();
    assert.equal(auditEvents.length, 2, "Concurrent webhook records one subscription and one tenant update");
    assert.ok(auditEvents.every((event) => (event.metadata as { actorType: string; source: string }).actorType === "system" && (event.metadata as { source: string }).source === "stripe"));
    await syncSubscription(state.id, gateway, config);
    assert.equal((await systemLogs()).length, 2, "Identical webhook retry does not duplicate audit history");
    assert.equal((await tenant(a))!.subscriptionStatus, "active"); assert.equal((await tenant(a))!.maxProducts, 1000);
    assert.equal((await tenant(b))!.subscriptionStatus, "trial", "Unrelated tenant unchanged");
    await assert.rejects(withOwner(a, (auth) => createCheckout(auth, "pro", gateway, config)), /already have a subscription/);
    state.status = "past_due"; await syncSubscription(state.id, gateway, config);
    assert.equal((await tenant(a))!.subscriptionStatus, "past_due");
    state.status = "active"; state.cancelAtPeriodEnd = true; await syncSubscription(state.id, gateway, config);
    assert.equal((await tenant(a))!.subscriptionStatus, "active");
    state.items[0].start = 1793491200; state.items[0].end = 1796083200;
    await syncSubscription(state.id, gateway, config); assert.equal((await history(a)).length, 2, "Renewal adds one period");
    await syncSubscription(state.id, gateway, config); assert.equal((await history(a)).length, 2, "Retry does not duplicate renewal");
    state.status = "canceled"; state.canceledAt = 1793491200;
    const newer = subscription(a, "sub_new", { created: 1793491200, items: [{ price: price("price_basic"), quantity: 1, start: 1793491200, end: 1796083200 }] });
    subscriptions.set(state.customerId, [state, newer]);
    await syncSubscription(state.id, gateway, config);
    assert.equal((await tenant(a))!.subscriptionStatus, "active"); assert.equal((await tenant(a))!.subscriptionPlan, "basic", "Old cancellation cannot cancel new subscription");
    const forged = subscription(a, "sub_forged", { metadata: { app: BILLING_APP, tenantId: b.tenantId } });
    subscriptions.set(forged.customerId, [state, newer, forged]);
    await assert.rejects(syncSubscription(forged.id, gateway, config), /mapping mismatch/);
    assert.equal((await tenant(b))!.subscriptionStatus, "trial");
    subscriptions.set(state.customerId, [state, newer]); newer.status = "canceled"; newer.canceledAt = 1793577600;
    await syncSubscription(newer.id, gateway, config); assert.equal((await tenant(a))!.subscriptionStatus, "cancelled");
    const before = await tenant(a);
    await assert.rejects(syncSubscription(newer.id, { ...gateway, subscriptions: async () => { throw new Error("Provider temporarily unavailable"); } }, config));
    assert.equal((await tenant(a))!.subscriptionStatus, before!.subscriptionStatus, "Provider failures cannot partially update state");
    console.log("Billing smoke tests passed: authenticated APIs, owner permissions, webhook boundary, checkout reuse, concurrency, renewal, status/limits, stale cancellation, tenant isolation and retry failures.");
  } finally { await cleanup(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
