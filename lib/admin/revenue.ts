import { calculateRevenue } from "./revenue-calculations.ts";
import type Stripe from "stripe";
import { stripeClient } from "../billing/stripe.ts";
import { billingConfigured, billingConfig } from "../billing/config.ts";
import { rlsDb } from "../db/rls.ts";
import type { AuthContext } from "../auth/context.ts";
import { assertPlatform } from "./service.ts";
import type { RevenueSummary } from "./types.ts";

export async function platformRevenue(auth: AuthContext): Promise<RevenueSummary> {
  assertPlatform(auth);
  const unavailable = (message: string): RevenueSummary => ({ available: false, message, asOf: new Date().toISOString(), currencies: [], excluded: 0 });
  if (!billingConfigured()) return unavailable("Configure Stripe to view recurring revenue.");
  const mapping = await rlsDb().orm.public.Subscription.where((s) => s.stripeCustomerId.isNotNull()).select("tenantId", "stripeCustomerId").all();
  const customers = new Map<string, string>();
  for (const row of mapping) {
    const id = row.stripeCustomerId!;
    if (customers.has(id) && customers.get(id) !== row.tenantId) throw new Error("Ambiguous billing customer mapping");
    customers.set(id, row.tenantId);
  }
  try {
    const client = stripeClient(billingConfig());
    const subscriptions: Stripe.Subscription[] = [];
    for await (const s of client.subscriptions.list({ status: "active", limit: 100 })) {
      subscriptions.push(s);
      if (subscriptions.length > 10000) return unavailable("Revenue scan limit reached. Use Stripe for the full account report.");
    }
    return calculateRevenue(subscriptions, customers);
  } catch {
    return unavailable("Stripe revenue is temporarily unavailable. Retry shortly.");
  }
}
