import type { TenantRequestContext } from "../api/guard.ts";
import { ApiProblem } from "../api/response.ts";
import { recordAudit } from "../audit/log.ts";
import { rawSql, rlsDb, withRequestRls } from "../db/rls.ts";
import { numeric } from "../numeric.ts";
import { tenantScope } from "../tenant/scope.ts";
import { billingConfig, billingConfigured, planLimits, type BillingConfig } from "./config.ts";
import { BILLING_APP, stripeGateway, type BillingGateway, type BillingSubscription } from "./stripe.ts";
import { managed, projectSubscription, stripeAmount, terminal, validatePrice } from "./subscriptions.ts";
import { PAID_PLANS, type BillingSummary, type PaidPlan } from "./types.ts";

/** Lock shared by checkout and webhook so retries/concurrent workers cannot create duplicate history rows. */
export async function lockBillingTenant(tenantId: string) {
  await rlsDb().execute(rawSql`SELECT id FROM public.tenants WHERE id = ${tenantId}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
}
export async function billingSummary(auth: TenantRequestContext): Promise<BillingSummary> {
  const tenant = await auth.db.orm.public.Tenant.where({ id: auth.tenantId })
    .select("subscriptionPlan", "subscriptionStatus", "trialEndsAt", "subscriptionEndsAt", "maxProducts", "maxStaff").first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  const customer = await auth.scope.Subscription.where((r) => r.stripeCustomerId.isNotNull()).select("id").first();
  const configured = billingConfigured(), limits = planLimits();
  const plans: BillingSummary["plans"] = [];
  const gateway = configured ? stripeGateway() : null;
  for (const id of PAID_PLANS) {
    const price = gateway ? await gateway.price(billingConfig().prices[id]) : null;
    if (price) validatePrice(price);
    plans.push({ id, label: id === "basic" ? "Basic" : "Pro", ...limits[id], amount: price ? stripeAmount(price.amount!, price.currency) : null,
      currency: price?.currency ?? null, interval: price?.interval ?? null, intervalCount: price?.intervalCount ?? null });
  }
  if (plans[0].currency && plans[0].currency !== plans[1].currency) throw new ApiProblem("BILLING_UNAVAILABLE", "Subscription plans are temporarily unavailable.", 503);
  return { configured, canManage: auth.user.role === "shop_owner", hasCustomer: !!customer, tenant, plans };
}
async function ensureCustomer(auth: TenantRequestContext, gateway: BillingGateway) {
  const existing = await auth.scope.Subscription.where((r) => r.stripeCustomerId.isNotNull()).select("stripeCustomerId").first();
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;
  const tenant = await auth.db.orm.public.Tenant.where({ id: auth.tenantId })
    .select("name", "email", "subscriptionPlan", "subscriptionStatus", "trialEndsAt", "createdAt").first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  const customerId = await gateway.customer({ tenantId: auth.tenantId, name: tenant.name, email: tenant.email });
  const trial = await auth.scope.Subscription.where((r) => r.stripeSubscriptionId.isNull()).select("id").first();
  if (trial) await auth.scope.Subscription.where({ id: trial.id }).update({ stripeCustomerId: customerId });
  else await auth.scope.Subscription.create(auth.scope.own({ stripeCustomerId: customerId, plan: tenant.subscriptionPlan,
    status: tenant.subscriptionStatus, amount: numeric("0.00"), startedAt: tenant.createdAt, endsAt: tenant.trialEndsAt }));
  return customerId;
}
export async function createCheckout(auth: TenantRequestContext, plan: PaidPlan,
  gateway: BillingGateway = stripeGateway(), config: BillingConfig = billingConfig()) {
  await lockBillingTenant(auth.tenantId);
  const price = await gateway.price(config.prices[plan]); validatePrice(price);
  const otherPrice = await gateway.price(config.prices[plan === "basic" ? "pro" : "basic"]); validatePrice(otherPrice);
  if (price.currency !== otherPrice.currency) throw new ApiProblem("BILLING_UNAVAILABLE", "Subscription plans are temporarily unavailable.", 503);
  const customerId = await ensureCustomer(auth, gateway);
  const subscriptions = await gateway.subscriptions(customerId);
  // Block all unfinished subscriptions, including incomplete payments, to prevent double billing.
  if (subscriptions.some((s) => !terminal(s))) throw new ApiProblem("CONFLICT", "You already have a subscription or pending payment. Use Manage billing to continue.", 409);
  const open = await gateway.openCheckouts(customerId);
  const reusable = open.find((s) => s.tenantId === auth.tenantId && s.plan === plan && s.priceId === price.id && s.url);
  for (const session of open) if (session.id !== reusable?.id) await gateway.expireCheckout(session.id);
  if (reusable?.url) return { sessionId: reusable.id, url: reusable.url };
  const session = await gateway.checkout({ tenantId: auth.tenantId, customerId, plan, priceId: price.id, appUrl: config.appUrl });
  await recordAudit({ tenantId: auth.tenantId, userId: auth.user.id, action: "billing.checkout.create", entityType: "tenant",
    entityId: auth.tenantId, metadata: { plan, sessionId: session.id } });
  return { sessionId: session.id, url: session.url };
}
export async function createPortal(auth: TenantRequestContext, gateway: BillingGateway = stripeGateway(), config: BillingConfig = billingConfig()) {
  const customer = await auth.scope.Subscription.where((r) => r.stripeCustomerId.isNotNull()).select("stripeCustomerId").first();
  if (!customer?.stripeCustomerId) throw new ApiProblem("CONFLICT", "Start checkout before opening billing management.", 409);
  return { url: await gateway.portal(customer.stripeCustomerId, config.appUrl) };
}

async function savePeriod(tenantId: string, subscription: BillingSubscription, config: BillingConfig) {
  const scope = tenantScope(tenantId), projection = projectSubscription(subscription, config);
  const current = await scope.Subscription.where({ stripeSubscriptionId: subscription.id, startedAt: projection.startedAt }).select("id").first();
  const values = { stripeCustomerId: subscription.customerId, stripeSubscriptionId: subscription.id,
    plan: projection.plan, status: projection.status, amount: numeric<10, 2>(projection.amount),
    startedAt: projection.startedAt, endsAt: projection.endsAt };
  if (current) await scope.Subscription.where({ id: current.id }).update(values);
  else await scope.Subscription.create(scope.own(values));
  return projection;
}
/** The verified event identifies a resource; current Stripe state determines access, not event order. */
export async function syncSubscription(subscriptionId: string, gateway: BillingGateway = stripeGateway(), config: BillingConfig = billingConfig()) {
  const incoming = await gateway.subscription(subscriptionId);
  if (incoming.metadata.app !== BILLING_APP) return { ignored: true };
  return withRequestRls(async (rls) => {
    // Resolve tenant from the persisted customer mapping, never from the event's metadata alone.
    const mappings = await rls.session.orm.public.Subscription.where({ stripeCustomerId: incoming.customerId }).select("tenantId").all();
    const ids = [...new Set(mappings.map((r) => r.tenantId))];
    if (!ids.length) throw new ApiProblem("BILLING_UNAVAILABLE", "Checkout mapping is not ready. Retry this event.", 503);
    if (ids.length !== 1 || incoming.metadata.tenantId !== ids[0]) throw new Error("Stripe customer/tenant mapping mismatch.");
    const tenantId = ids[0]; await rls.pinToTenant(tenantId); await lockBillingTenant(tenantId);
    const all = (await gateway.subscriptions(incoming.customerId)).filter((s) => managed(s, tenantId));
    // Retrieve inside the lock too if Stripe's list omitted the resource.
    if (!all.some((s) => s.id === subscriptionId)) all.push(await gateway.subscription(subscriptionId));
    if (!all.every((s) => managed(s, tenantId) && s.customerId === incoming.customerId)) throw new Error("Subscription tenant mismatch.");
    all.sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
    const latest = all.find((s) => !terminal(s)) ?? all[0];
    const triggering = all.find((s) => s.id === subscriptionId)!;
    await savePeriod(tenantId, triggering, config);
    const projection = triggering.id === latest.id ? projectSubscription(latest, config) : await savePeriod(tenantId, latest, config);
    await rls.session.orm.public.Tenant.where({ id: tenantId }).update({ subscriptionPlan: projection.plan,
      subscriptionStatus: projection.status, subscriptionEndsAt: projection.endsAt,
      trialEndsAt: projection.trialEndsAt, maxProducts: projection.maxProducts, maxStaff: projection.maxStaff });
    return { ignored: false };
  });
}
