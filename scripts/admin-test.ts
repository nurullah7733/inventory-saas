import assert from "node:assert/strict";
import type Stripe from "stripe";
import { monthlyCents, calculateRevenue } from "../lib/admin/revenue-calculations.ts";
import { accessSchema, tenantListSchema } from "../lib/admin/types.ts";

assert.equal(monthlyCents(120000, "usd", "year", 1), BigInt(10000));
assert.equal(monthlyCents(6000, "usd", "month", 3), BigInt(2000));
assert.equal(monthlyCents(1000, "jpy", "month", 1), BigInt(100000));
assert.equal(monthlyCents(1200, "usd", "week", 1), BigInt(5200));
assert.equal(monthlyCents(1200, "usd", "day", 1), BigInt(36500));
assert.throws(() => monthlyCents(1, "usd", "month", 0));
assert.throws(() => monthlyCents(-1, "usd", "month", 1));
assert.throws(() => monthlyCents(1, "usd", "unknown", 1));
assert.equal(accessSchema.safeParse({ isActive: false, expectedIsActive: true, reason: "x" }).success, false);
assert.equal(accessSchema.safeParse({ isActive: false, expectedIsActive: true, reason: "Policy", tenantId: "x" }).success, false);
assert.equal(tenantListSchema.safeParse({ page: "2", pageSize: "101" }).success, false);
assert.equal(tenantListSchema.safeParse({ status: "paid" }).success, false);
assert.equal(tenantListSchema.parse({}).page, 1);
const subscription = (id: string, currency = "usd", amount = 120000, interval = "year") => ({
  id, customer: "cus_test", status: "active", pause_collection: null, metadata: { app: "inventory-saas", tenantId: "tenant_test" },
  items: { has_more: false, data: [{ quantity: 1, price: { currency, unit_amount: amount, recurring: { interval, interval_count: 1, usage_type: "licensed" } } }] },
}) as unknown as Stripe.Subscription;
const a = subscription("sub_a"), b = subscription("sub_b", "jpy", 1000, "month");
const cancelled = { ...a, id: "cancelled", status: "canceled" } as Stripe.Subscription;
const trial = { ...a, id: "trial", status: "trialing" } as Stripe.Subscription;
const paused = { ...a, id: "paused", pause_collection: { behavior: "void" } } as Stripe.Subscription;
const forged = { ...a, id: "forged", metadata: { app: "inventory-saas", tenantId: "other" } };
const invalid = subscription("invalid"); invalid.items.data[0].quantity = 2;
const result = calculateRevenue([a, a, b, cancelled, trial, paused, forged, invalid], new Map([["cus_test", "tenant_test"]]));
assert.equal(result.excluded, 1);
assert.deepEqual(result.currencies, [{ currency: "jpy", mrr: "1000.00", arr: "12000.00", subscriptions: 1 }, { currency: "usd", mrr: "100.00", arr: "1200.00", subscriptions: 1 }]);
assert.deepEqual(calculateRevenue([a], new Map()).currencies, []);
console.log("Admin calculation/validation tests passed.");
