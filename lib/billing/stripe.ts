import Stripe from "stripe";
import { billingConfig, billingUnavailable, type BillingConfig } from "./config.ts";

export const STRIPE_API_VERSION = "2026-09-30.endive";
export const BILLING_APP = "inventory-saas";
export interface BillingPrice {
  id: string; active: boolean; amount: number | null; currency: string;
  interval: string | null; intervalCount: number | null; usage: string | null;
}
export interface BillingSubscription {
  id: string; customerId: string; status: Stripe.Subscription.Status; created: number;
  metadata: Record<string, string>; trialEnd: number | null; canceledAt: number | null;
  cancelAtPeriodEnd: boolean; pauseCollection: boolean;
  items: { price: BillingPrice; quantity: number; start: number; end: number }[];
}
export interface BillingCheckout { id: string; url: string | null; plan: string | undefined; priceId: string | undefined; tenantId: string | undefined }
/** Small provider boundary enables deterministic tests without making real charges. */
export interface BillingGateway {
  price(id: string): Promise<BillingPrice>;
  customer(input: { tenantId: string; name: string; email: string }): Promise<string>;
  subscriptions(customer: string): Promise<BillingSubscription[]>;
  subscription(id: string): Promise<BillingSubscription>;
  openCheckouts(customer: string): Promise<BillingCheckout[]>;
  expireCheckout(id: string): Promise<void>;
  checkout(input: { tenantId: string; customerId: string; plan: string; priceId: string; appUrl: string }): Promise<{ id: string; url: string }>;
  portal(customerId: string, appUrl: string): Promise<string>;
}
let cached: { key: string; client: Stripe } | undefined;
export function stripeClient(config = billingConfig()) {
  if (!cached || cached.key !== config.secretKey) cached = { key: config.secretKey,
    client: new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, timeout: 10_000, maxNetworkRetries: 1 }) };
  return cached.client;
}
function priceData(p: Stripe.Price): BillingPrice {
  return { id: p.id, active: p.active, amount: p.unit_amount, currency: p.currency,
    interval: p.recurring?.interval ?? null, intervalCount: p.recurring?.interval_count ?? null, usage: p.recurring?.usage_type ?? null };
}
function subscriptionData(s: Stripe.Subscription): BillingSubscription {
  return { id: s.id, customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
    status: s.status, created: s.created, metadata: s.metadata, trialEnd: s.trial_end,
    canceledAt: s.ended_at, cancelAtPeriodEnd: s.cancel_at_period_end, pauseCollection: !!s.pause_collection,
    items: s.items.data.map((i) => ({ price: priceData(i.price), quantity: i.quantity ?? 1, start: i.current_period_start, end: i.current_period_end })) };
}
export function stripeGateway(config: BillingConfig = billingConfig(), stripe: Stripe = stripeClient(config)): BillingGateway {
  const safe = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        // Log identifiers only; SDK errors can include request details and credentials.
        console.error("[billing] Stripe request failed", { type: error.type, requestId: error.requestId });
        billingUnavailable("Could not connect to billing. Please try again shortly.");
      }
      throw error;
    }
  };
  return {
    price: (id) => safe(async () => priceData(await stripe.prices.retrieve(id))),
    customer: (input) => safe(async () => (await stripe.customers.create({ name: input.name, email: input.email,
      metadata: { tenantId: input.tenantId, app: BILLING_APP } }, { idempotencyKey: `inventory-customer-${input.tenantId}` })).id),
    subscriptions: (customer) => safe(async () => {
      const rows: BillingSubscription[] = [];
      for await (const s of stripe.subscriptions.list({ customer, status: "all", limit: 100 })) rows.push(subscriptionData(s));
      return rows;
    }),
    subscription: (id) => safe(async () => subscriptionData(await stripe.subscriptions.retrieve(id))),
    openCheckouts: (customer) => safe(async () => {
      const rows: BillingCheckout[] = [];
      for await (const s of stripe.checkout.sessions.list({ customer, status: "open", limit: 100 })) rows.push({ id: s.id, url: s.url, plan: s.metadata?.plan, priceId: s.metadata?.priceId, tenantId: s.client_reference_id ?? undefined });
      return rows;
    }),
    expireCheckout: (id) => safe(async () => { await stripe.checkout.sessions.expire(id); }),
    checkout: (input) => safe(async () => {
      const metadata = { tenantId: input.tenantId, plan: input.plan, priceId: input.priceId, app: BILLING_APP };
      const session = await stripe.checkout.sessions.create({ mode: "subscription", customer: input.customerId,
        client_reference_id: input.tenantId, metadata, line_items: [{ price: input.priceId, quantity: 1 }],
        subscription_data: { metadata },
        success_url: `${input.appUrl}/settings/billing?checkout=success`, cancel_url: `${input.appUrl}/settings/billing?checkout=cancelled`,
        allowed_payment_method_types: ["card"] });
      if (!session.url) billingUnavailable();
      return { id: session.id, url: session.url };
    }),
    portal: (customer, appUrl) => safe(async () => (await stripe.billingPortal.sessions.create({ customer, return_url: `${appUrl}/settings/billing` })).url),
  };
}
export function verifyStripeEvent(body: string, signature: string, secret: string): Stripe.Event {
  // Signature verification doesn't need an API request or database access.
  return Stripe.webhooks.constructEvent(body, signature, secret);
}
