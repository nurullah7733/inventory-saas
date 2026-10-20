import assert from "node:assert/strict";
import { bkashCheckoutUrl, bkashGateway, type BkashPayment } from "../lib/billing/bkash.ts";
import { billingConfig, billingConfigured, type BillingConfig } from "../lib/billing/config.ts";
import { verifyPayment, nextMonth } from "../lib/billing/payments.ts";
import { checkoutSchema } from "../lib/billing/types.ts";
import { subscriptionStatus } from "../lib/billing/access.ts";

const config: BillingConfig = { username: "test-user", password: "test-password", appKey: "test-key", appSecret: "test-secret",
  appUrl: "http://localhost:3000", baseUrl: "https://tokenized.sandbox.bka.sh/v1.2.0-beta", prices: { basic: { monthly: "100.00", yearly: "1000.00" }, pro: { monthly: "200.00", yearly: "2000.00" } },
  limits: { basic: { maxProducts: 100, maxStaff: 5 }, pro: { maxProducts: 1000, maxStaff: 20 } } };
const expected = { id: "invoice-a", paymentId: "payment-a", amount: "100.00" };
const checkoutResponse = { statusCode: "0000", paymentID: "payment-a" };
for (const host of ["sandbox.payment.bkash.com", "tokenized.sandbox.bka.sh"])
  assert.equal(bkashCheckoutUrl({ ...checkoutResponse, bkashURL: `https://${host}/checkout` }, true), `https://${host}/checkout`);
assert.equal(bkashCheckoutUrl({ ...checkoutResponse, bkashURL: "https://payment.bkash.com/" }, false), "https://payment.bkash.com/");
for (const url of ["https://sandbox.payment.bkash.com.evil.test/", "https://evil.test/", "http://sandbox.payment.bkash.com/",
  "https://user:pass@sandbox.payment.bkash.com/", "https://sandbox.payment.bkash.com:444/", "https://payment.bkash.com/", "javascript:alert(1)"])
  assert.throws(() => bkashCheckoutUrl({ ...checkoutResponse, bkashURL: url }, true), /checkout URL/);
assert.throws(() => bkashCheckoutUrl({ ...checkoutResponse, bkashURL: "https://sandbox.payment.bkash.com/" }, false), /checkout URL/);
assert.throws(() => bkashCheckoutUrl({ statusCode: "2001" }, true), /code 2001/);
const paid: BkashPayment = { statusCode: "0000", transactionStatus: "Completed", paymentID: "payment-a", trxID: "trx-a",
  merchantInvoiceNumber: "invoice-a", amount: "100", currency: "BDT" };
assert.equal(verifyPayment(paid, expected), "trx-a");
for (const patch of [{ statusCode: "9999" }, { transactionStatus: "Initiated" }, { paymentID: "other" },
  { merchantInvoiceNumber: "other" }, { amount: "1.00" }, { amount: "100.001" }, { currency: "USD" }, { trxID: undefined }])
  assert.throws(() => verifyPayment({ ...paid, ...patch }, expected), /not been verified/);
assert.equal(nextMonth(new Date("2028-01-31T12:30:00Z")), "2028-02-29T12:30:00.000Z");
assert.equal(nextMonth(new Date("2027-01-31T12:30:00Z")), "2027-02-28T12:30:00.000Z");
assert.equal(nextMonth(new Date("2026-12-20T12:30:00Z")), "2027-01-20T12:30:00.000Z");
const expiry = Date.parse("2026-11-20T12:30:00Z");
const tenant = { subscriptionStatus: "active" as const, subscriptionEndsAt: new Date(expiry).toISOString(), trialEndsAt: null };
assert.equal(subscriptionStatus(tenant, expiry - 1), "active");
assert.equal(subscriptionStatus(tenant, expiry), "past_due", "Prepaid access must stop at expiry without a webhook");
assert.equal(subscriptionStatus({ ...tenant, subscriptionStatus: "trial", trialEndsAt: tenant.subscriptionEndsAt }, expiry), "past_due");
assert.equal(subscriptionStatus({ ...tenant, subscriptionStatus: "cancelled" }, expiry - 1), "cancelled");
assert.equal(checkoutSchema.safeParse({ plan: "basic" }).success, true);
assert.equal(checkoutSchema.parse({ plan: "basic" }).interval, "monthly");
assert.equal(checkoutSchema.parse({ plan: "pro", interval: "yearly" }).interval, "yearly");
assert.equal(checkoutSchema.safeParse({ plan: "basic", interval: "weekly" }).success, false);
assert.equal(checkoutSchema.safeParse({ plan: "basic", interval: "yearly", durationMonths: 1 }).success, false);
assert.equal(nextMonth(new Date("2028-02-29T12:30:00Z"), 12), "2029-02-28T12:30:00.000Z");
assert.equal(nextMonth(new Date("2026-10-20T12:30:00Z"), 12), "2027-10-20T12:30:00.000Z");
assert.throws(() => nextMonth(new Date(), 2), /Invalid billing duration/);
assert.throws(() => verifyPayment(paid, { ...expected, amount: "1000.00" }), /not been verified/);
assert.equal(verifyPayment({ ...paid, amount: "1000.00" }, { ...expected, amount: "1000.00" }), "trx-a");
for (const input of [{ plan: "trial" }, { plan: "basic", amount: "1" }, { plan: "pro", tenantId: "other" }, { plan: "basic", callbackURL: "https://evil.test" }])
  assert.equal(checkoutSchema.safeParse(input).success, false);
const saved = { ...process.env };
try {
  Object.assign(process.env, { BKASH_ENV: "sandbox", BKASH_USERNAME: "user", BKASH_PASSWORD: "password", BKASH_APP_KEY: "key",
    BKASH_APP_SECRET: "secret", APP_URL: "http://localhost:3000", BILLING_BASIC_PRICE_BDT: "100", BILLING_PRO_PRICE_BDT: "200", BILLING_BASIC_YEARLY_PRICE_BDT: "1000", BILLING_PRO_YEARLY_PRICE_BDT: "2000" });
  assert.equal(billingConfigured(), true); assert.equal(billingConfig().prices.basic.monthly, "100.00");
  assert.equal(billingConfig().prices.basic.yearly, "1000.00");
  process.env.BILLING_PRO_YEARLY_PRICE_BDT = ""; assert.equal(billingConfigured(), false);
  process.env.BILLING_PRO_YEARLY_PRICE_BDT = "2000";
  process.env.BKASH_ENV = "live"; assert.equal(billingConfigured(), false, "Live callbacks require HTTPS");
  process.env.APP_URL = "https://shop.example"; assert.equal(billingConfigured(), true);
  process.env.BILLING_BASIC_PRICE_BDT = "0"; assert.equal(billingConfigured(), false);
  process.env.BILLING_BASIC_PRICE_BDT = "-1"; assert.equal(billingConfigured(), false);
} finally { process.env = saved; }
const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
const responses: BkashPayment[] = [{ statusCode: "0000", id_token: "test-token" },
  { statusCode: "0000", paymentID: "payment-a", bkashURL: "https://tokenized.sandbox.bka.sh/checkout/test" }, paid,
  { ...paid, merchantInvoiceNumber: undefined, merchantInvoice: expected.id }];
const transport: typeof fetch = async (input, init) => {
  calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
  assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
  return Response.json(responses.shift());
};
const gateway = bkashGateway(config, transport);
await gateway.create(expected.id, "100.00", "https://shop.example/api/v1/billing/callback?token=test");
await gateway.execute("payment-a");
const queried = await gateway.query("payment-a");
assert.equal(verifyPayment(queried, expected), "trx-a", "Query must normalize bKash's merchantInvoice field");
assert.equal(calls.length, 4, "Token is reused within the operation");
assert.deepEqual(calls[0].body, { app_key: config.appKey, app_secret: config.appSecret });
assert.equal(calls[1].body.amount, "100.00"); assert.equal(calls[1].body.currency, "BDT");
assert.equal(calls[1].body.merchantInvoiceNumber, expected.id); assert.equal(calls[1].body.mode, "0011");
assert.equal(calls[1].headers.Authorization, "test-token"); assert.equal(calls[1].headers["X-APP-Key"], "test-key");
assert.ok(calls[3].url.endsWith("/payment/status"));
await assert.rejects(() => bkashGateway(config, async () => { throw new Error("private response"); }).query("payment-a"),
  (error: Error) => !error.message.includes("private response") && error.message.includes("could not confirm"));
await assert.rejects(() => bkashGateway(config, async () => Response.json({ statusCode: "9999" })).query("payment-a"), /authentication/);
console.log("Billing tests passed: verified amounts/invoices, calendar renewals, config validation, server-only bKash requests and safe failures.");
