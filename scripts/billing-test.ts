import assert from "node:assert/strict";
import Stripe from "stripe";
import { checkoutSchema } from "../lib/billing/types.ts";
import { billingConfig, planLimits, type BillingConfig } from "../lib/billing/config.ts";
import { localStatus, projectSubscription, stripeAmount, validatePrice } from "../lib/billing/subscriptions.ts";
import { subscriptionIdFromEvent } from "../lib/billing/events.ts";
import { stripeGateway, STRIPE_API_VERSION, verifyStripeEvent, BILLING_APP, type BillingSubscription } from "../lib/billing/stripe.ts";

const config: BillingConfig = { secretKey: "sk_test_mock", webhookSecret: "whsec_mock", appUrl: "http://localhost:3000",
  prices: { basic: "price_basic", pro: "price_pro" }, limits: { basic: { maxProducts: 100, maxStaff: 5 }, pro: { maxProducts: 1000, maxStaff: 20 } } };
const subscription: BillingSubscription = { id: "sub_test", customerId: "cus_test", status: "active", created: 1,
  metadata: { app: BILLING_APP, tenantId: "tenant" }, trialEnd: null, canceledAt: null, cancelAtPeriodEnd: false, pauseCollection: false,
  items: [{ price: { id: "price_pro", active: true, amount: 2500, currency: "usd", interval: "month", intervalCount: 1, usage: "licensed" }, quantity: 1, start: 1790812800, end: 1793491200 }] };
assert.equal(checkoutSchema.safeParse({ plan: "pro" }).success, true);
for (const body of [{ plan: "trial" }, { plan: "pro", priceId: "price_cheap" }, { plan: "basic", tenantId: "other" }, { plan: "basic", successUrl: "https://evil.example" }]) assert.equal(checkoutSchema.safeParse(body).success, false);
assert.equal(localStatus("active"), "active"); assert.equal(localStatus("trialing"), "trial");
for (const status of ["incomplete", "past_due", "unpaid", "paused"] as const) assert.equal(localStatus(status), "past_due");
for (const status of ["canceled", "incomplete_expired"] as const) assert.equal(localStatus(status), "cancelled");
assert.equal(localStatus("active", true), "past_due", "Paused collection must not grant paid access");
assert.equal(stripeAmount(1299, "usd"), "12.99"); assert.equal(stripeAmount(1200, "jpy"), "1200.00");
assert.equal(stripeAmount(500, "isk"), "5.00"); assert.equal(stripeAmount(500, "ugx"), "5.00");
assert.throws(() => stripeAmount(-1, "usd")); assert.throws(() => stripeAmount(0.5, "usd"));
assert.throws(() => validatePrice({ ...subscription.items[0].price, interval: null }));
assert.throws(() => validatePrice({ ...subscription.items[0].price, usage: "metered" }));
assert.throws(() => validatePrice({ ...subscription.items[0].price, amount: null }));
const projection = projectSubscription(subscription, config);
assert.equal(projection.plan, "pro"); assert.equal(projection.amount, "25.00"); assert.equal(projection.maxProducts, 1000);
assert.equal(projectSubscription({ ...subscription, cancelAtPeriodEnd: true }, config).status, "active", "Scheduled cancellation retains access through the paid period");
assert.equal(projectSubscription({ ...subscription, status: "canceled", canceledAt: 1790899200 }, config).endsAt, "2026-10-02T00:00:00.000Z");
assert.throws(() => projectSubscription({ ...subscription, items: [...subscription.items, ...subscription.items] }, config));
assert.throws(() => projectSubscription(subscription, { ...config, prices: { basic: "price_other", pro: "price_unknown" } }));
function event(type: string, object: unknown) { return { id: "evt_test", type, data: { object } } as Stripe.Event; }
assert.equal(subscriptionIdFromEvent(event("checkout.session.completed", { subscription: "sub_test" })), "sub_test");
assert.equal(subscriptionIdFromEvent(event("customer.subscription.updated", { id: "sub_test" })), "sub_test");
assert.equal(subscriptionIdFromEvent(event("invoice.paid", { parent: { type: "subscription_details", subscription_details: { subscription: "sub_test" } } })), "sub_test");
assert.equal(subscriptionIdFromEvent(event("invoice.payment_failed", { subscription: "sub_legacy" })), "sub_legacy");
assert.equal(subscriptionIdFromEvent(event("payment_intent.succeeded", { id: "pi_test" })), null);
const payload = JSON.stringify(event("customer.subscription.updated", { id: "sub_test" }));
const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
assert.equal(verifyStripeEvent(payload, header, config.webhookSecret).id, "evt_test");
assert.throws(() => verifyStripeEvent(payload + " ", header, config.webhookSecret), "Raw-body modification invalidates the signature");
assert.throws(() => verifyStripeEvent(payload, header, "whsec_wrong"));
const stale = Stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret, timestamp: 1 });
assert.throws(() => verifyStripeEvent(payload, stale, config.webhookSecret));
const saved = { ...process.env };
try {
  Object.assign(process.env, { STRIPE_SECRET_KEY: config.secretKey, STRIPE_WEBHOOK_SECRET: config.webhookSecret,
    STRIPE_BASIC_PRICE_ID: config.prices.basic, STRIPE_PRO_PRICE_ID: config.prices.pro, APP_URL: config.appUrl });
  assert.equal(billingConfig().appUrl, config.appUrl);
  process.env.APP_URL = "https://app.example.com/path"; assert.throws(billingConfig);
  process.env.APP_URL = "http://remote.example.com"; assert.throws(billingConfig);
  process.env.APP_URL = config.appUrl;
  process.env.BILLING_PRO_MAX_STAFF = "20bad"; assert.throws(planLimits);
} finally { process.env = saved; }
// Exercise the real SDK's form encoding and response mapping using an in-memory HTTP transport.
const requests: { url: string; headers: Headers; body: URLSearchParams }[] = [];
const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body ?? "")) });
    const path = new URL(String(url)).pathname;
    let response: object;
    if (path === "/v1/customers") response = { id: "cus_sdk", object: "customer" };
    else if (path === "/v1/checkout/sessions") response = { id: "cs_sdk", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_sdk" };
    else if (path === "/v1/billing_portal/sessions") response = { id: "bps_sdk", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/sdk" };
    else throw new Error(`Unexpected SDK request ${path}`);
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  }) });
const provider = stripeGateway(config, stripe);
assert.equal(await provider.customer({ tenantId: "tenant", name: "Shop", email: "shop@example.com" }), "cus_sdk");
assert.equal(requests[0].headers.get("Idempotency-Key"), "inventory-customer-tenant");
assert.equal(requests[0].body.get("metadata[tenantId]"), "tenant");
await provider.checkout({ tenantId: "tenant", customerId: "cus_sdk", plan: "pro", priceId: "price_pro", appUrl: config.appUrl });
assert.equal(requests[1].body.get("mode"), "subscription");
assert.equal(requests[1].body.get("line_items[0][price]"), "price_pro");
assert.equal(requests[1].body.get("subscription_data[metadata][tenantId]"), "tenant");
assert.equal(requests[1].body.get("allowed_payment_method_types[0]"), "card");
assert.equal(requests[1].body.get("success_url"), "http://localhost:3000/settings/billing?checkout=success");
assert.equal(requests[1].headers.get("Stripe-Version"), STRIPE_API_VERSION);
await provider.portal("cus_sdk", config.appUrl);
assert.equal(requests[2].body.get("customer"), "cus_sdk");
assert.equal(requests[2].body.get("return_url"), "http://localhost:3000/settings/billing");
console.log("Billing tests passed: plans, price validation, status mapping, current period, currency, events, signature, replay tolerance and redirect config.");
