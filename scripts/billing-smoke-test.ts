import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { discardCheckout, settlePayment } from "../lib/billing/service.ts";
import { nextMonth } from "../lib/billing/payments.ts";
import type { BillingConfig } from "../lib/billing/config.ts";
import type { BkashGateway, BkashPayment } from "../lib/billing/bkash.ts";

// Uses real database transactions with a mocked gateway; all fixtures roll back.
const config: BillingConfig = { username: "mock", password: "mock", appKey: "mock", appSecret: "mock",
  baseUrl: "https://tokenized.sandbox.bka.sh/v1.2.0-beta", appUrl: "http://localhost:3001",
  prices: { basic: { monthly: "1000.00", yearly: "10000.00" }, pro: { monthly: "2000.00", yearly: "20000.00" } },
  limits: { basic: { maxProducts: 100, maxStaff: 5 }, pro: { maxProducts: 1000, maxStaff: 20 } } };
const rollback = new Error("Rollback billing fixtures");
try {
  await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: "Annual billing test", email: "billing-test@example.com", vatPercentage: numeric("0.00") });
    let response: BkashPayment = {};
    let queries = 0;
    const gateway: BkashGateway = {
      create: async () => { throw new Error("Unexpected checkout"); },
      execute: async () => { throw new Error("Completed payments must never execute again"); },
      query: async () => { queries++; return response; },
    };
    async function pay(paymentId: string, amount: string, durationMonths: number) {
      const row = await tx.orm.public.Subscription.select("id").create({ tenantId: tenant.id, plan: "basic", status: "past_due",
        amount: numeric<10, 2>(amount), startedAt: new Date().toISOString(), paymentId, durationMonths });
      response = { paymentID: paymentId, merchantInvoiceNumber: row.id, amount, currency: "BDT",
        statusCode: "0000", transactionStatus: "Completed", trxID: `trx-${paymentId}` };
      response.transactionStatus = "Initiated";
      assert.equal((await settlePayment(tenant.id, row.id, false, null, gateway, config)).status, "pending");
      assert.equal((await tx.orm.public.Subscription.where({ id: row.id }).first())?.paidAt, null, "Unpaid status checks must not activate a plan");
      response.transactionStatus = "Completed";
      assert.equal((await settlePayment(tenant.id, row.id, true, null, gateway, config)).status, "success");
      const saved = await tx.orm.public.Subscription.where({ id: row.id }).first();
      assert.ok(saved?.paidAt); assert.ok(saved?.endsAt);
      const end = new Date(saved.endsAt).toISOString();
      assert.equal(end, nextMonth(new Date(saved.startedAt), durationMonths));
      const queryCount = queries;
      await settlePayment(tenant.id, row.id, true, null, gateway, config);
      assert.equal(queries, queryCount, "Duplicate completion must not call the gateway");
      const current = await tx.orm.public.Tenant.where({ id: tenant.id }).first();
      assert.equal(new Date(current!.subscriptionEndsAt!).toISOString(), end, "Duplicate completion must not extend access");
      return end;
    }
    const suffix = tenant.id;
    const annualEnd = await pay(`year-${suffix}`, "10000.00", 12);
    const monthlyEnd = await pay(`month-${suffix}`, "1000.00", 1);
    assert.equal(monthlyEnd, nextMonth(new Date(annualEnd)), "Renewal must extend the existing annual expiry");
    const owner = await tx.orm.public.User.select("id").create({ tenantId: tenant.id, role: "shop_owner", name: "Billing test",
      email: `billing-${suffix}@example.com`, passwordHash: "unused-test-hash" });
    const pending = await tx.orm.public.Subscription.select("id").create({ tenantId: tenant.id, plan: "basic", status: "past_due",
      amount: numeric<10, 2>("1000.00"), startedAt: new Date().toISOString(), paymentId: `discard-${suffix}`, callbackToken: "test-token", checkoutUrl: "https://sandbox.payment.bkash.com/" });
    response = { paymentID: `discard-${suffix}`, merchantInvoiceNumber: pending.id, amount: "1000.00", currency: "BDT",
      statusCode: "0000", transactionStatus: "Initiated", verificationStatus: "Complete" };
    await assert.rejects(() => discardCheckout(tenant.id, response.paymentID!, owner.id, gateway, config), /cannot be discarded/);
    response.verificationStatus = "Incomplete";
    response.merchantInvoiceNumber = "different-invoice";
    await assert.rejects(() => discardCheckout(tenant.id, response.paymentID!, owner.id, gateway, config), /not been verified/);
    response.merchantInvoiceNumber = pending.id;
    assert.equal((await discardCheckout(tenant.id, response.paymentID!, owner.id, gateway, config)).status, "cancelled");
    const discarded = await tx.orm.public.Subscription.where({ id: pending.id }).first();
    assert.equal(discarded!.callbackToken, null); assert.equal(discarded!.checkoutUrl, null);
    assert.equal(discarded!.paymentId, response.paymentID, "Retain payment mapping for reconciliation");
    await settlePayment(tenant.id, pending.id, true, null, gateway, config);
    const unchanged = await tx.orm.public.Tenant.where({ id: tenant.id }).first();
    assert.equal(new Date(unchanged!.subscriptionEndsAt!).toISOString(), monthlyEnd, "Discard must not alter active access or execute a charge");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await db.close(); }
console.log("Billing database tests passed: yearly activation, monthly renewal and duplicate completion; fixtures rolled back.");
