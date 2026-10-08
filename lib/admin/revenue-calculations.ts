import type Stripe from "stripe";
import { BILLING_APP } from "../billing/stripe.ts";
import { stripeAmount } from "../billing/subscriptions.ts";
import { toCents, fromCents } from "../numeric.ts";
import type { RevenueSummary } from "./types.ts";

/** Base contracted MRR, before discounts/taxes/fees; not cash collections. */
export function monthlyCents(amount: number, currency: string, interval: string, count: number): bigint {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid interval");
  const cents = toCents(stripeAmount(amount, currency));
  const ratios: Record<string, [number, number]> = { month: [1, 1], year: [1, 12], week: [52, 12], day: [365, 12] };
  const ratio = ratios[interval]; if (!ratio) throw new Error("Unsupported interval");
  const numerator = cents * BigInt(ratio[0]), denominator = BigInt(ratio[1]) * BigInt(count);
  return (numerator + denominator / BigInt(2)) / denominator;
}
export function calculateRevenue(subscriptions: Stripe.Subscription[], customers: Map<string, string>): RevenueSummary {
  const currencies = new Map<string, { cents: bigint; subscriptions: number }>();
  const seen = new Set<string>(); let excluded = 0;
  for (const s of subscriptions) {
    if (seen.has(s.id)) continue; seen.add(s.id);
    const customer = typeof s.customer === "string" ? s.customer : s.customer.id;
    if (s.metadata.app !== BILLING_APP || customers.get(customer) !== s.metadata.tenantId) continue;
    if (s.status !== "active" || s.pause_collection) continue;
    const item = s.items.data[0], p = item?.price;
    if (s.items.has_more || s.items.data.length !== 1 || item.quantity !== 1 || p?.unit_amount == null || !p.recurring || p.recurring.usage_type !== "licensed") { excluded++; continue; }
    try {
      const cents = monthlyCents(p.unit_amount, p.currency, p.recurring.interval, p.recurring.interval_count);
      const sum = currencies.get(p.currency) ?? { cents: BigInt(0), subscriptions: 0 };
      sum.cents += cents; sum.subscriptions++; currencies.set(p.currency, sum);
    } catch { excluded++; }
  }
  return { available: true, asOf: new Date().toISOString(), excluded,
    currencies: [...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, mrr: fromCents(v.cents), arr: fromCents(v.cents * BigInt(12)), subscriptions: v.subscriptions })) };
}
