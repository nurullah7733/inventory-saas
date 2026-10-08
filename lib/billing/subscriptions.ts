import type Stripe from "stripe";
import { fromCents, MAX_MONEY_CENTS } from "../numeric.ts";
import { ApiProblem } from "../api/response.ts";
import type { BillingConfig } from "./config.ts";
import type { BillingPrice, BillingSubscription } from "./stripe.ts";
import { BILLING_APP } from "./stripe.ts";
import type { PaidPlan, SubscriptionStatus } from "./types.ts";

const zeroDecimal = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
export function stripeAmount(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Unsupported Stripe price amount.");
  // ISK/UGX use the Stripe two-digit backwards-compatible representation.
  const cents = BigInt(amount) * BigInt(zeroDecimal.has(currency.toLowerCase()) ? 100 : 1);
  if (cents > MAX_MONEY_CENTS) throw new Error("Stripe price exceeds the billing amount column.");
  return fromCents(cents);
}
export function validatePrice(price: BillingPrice) {
  if (!price.active || price.amount === null || !price.interval || price.usage !== "licensed")
    throw new ApiProblem("BILLING_UNAVAILABLE", "This subscription plan is not available. Please contact the app owner.", 503);
  stripeAmount(price.amount, price.currency);
}
export function localStatus(status: Stripe.Subscription.Status, paused = false): SubscriptionStatus {
  if (paused) return "past_due";
  switch (status) {
    case "active": return "active";
    case "trialing": return "trial";
    case "canceled": case "incomplete_expired": return "cancelled";
    default: return "past_due";
  }
}
export function terminal(s: BillingSubscription) { return s.status === "canceled" || s.status === "incomplete_expired"; }
export function managed(s: BillingSubscription, tenantId: string) { return s.metadata.app === BILLING_APP && s.metadata.tenantId === tenantId; }
export function projectSubscription(s: BillingSubscription, config: BillingConfig) {
  if (s.items.length !== 1 || s.items[0].quantity !== 1) throw new Error("Expected one flat-rate subscription item.");
  const item = s.items[0];
  const plan = (Object.entries(config.prices) as [PaidPlan, string][]).find(([, id]) => id === item.price.id)?.[0];
  if (!plan || item.price.amount === null || !item.price.interval || item.price.usage !== "licensed") throw new Error("Unrecognized subscription price. Keep configured price IDs available until subscriptions migrate.");
  const status = localStatus(s.status, s.pauseCollection);
  const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
  const end = s.canceledAt ?? item.end;
  return { plan, status, amount: stripeAmount(item.price.amount, item.price.currency),
    startedAt: iso(item.start), endsAt: iso(end), trialEndsAt: s.trialEnd ? iso(s.trialEnd) : null,
    ...config.limits[plan] };
}
