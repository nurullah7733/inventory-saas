import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { TenantRequestContext } from "../api/guard.ts";
import { ApiProblem } from "../api/response.ts";
import { recordAudit } from "../audit/log.ts";
import { rawSql, rlsDb, withRequestRls } from "../db/rls.ts";
import { numeric } from "../numeric.ts";
import { billingConfig, billingConfigured, planLimits, planPrices, type BillingConfig } from "./config.ts";
import { bkashCheckoutUrl, bkashGateway, type BkashGateway } from "./bkash.ts";
import { nextMonth, verifyPayment, verifyPaymentReference } from "./payments.ts";
import { subscriptionStatus } from "./access.ts";
import { PAID_PLANS, type BillingSummary, type PaidPlan, type BillingInterval } from "./types.ts";

async function lockTenant(tenantId: string) {
  await rlsDb().execute(rawSql`SELECT id FROM public.tenants WHERE id = ${tenantId}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
}
export async function billingSummary(auth: TenantRequestContext): Promise<BillingSummary> {
  const tenant = await auth.db.orm.public.Tenant.where({ id: auth.tenantId })
    .select("subscriptionPlan", "subscriptionStatus", "trialEndsAt", "subscriptionEndsAt", "maxProducts", "maxStaff").first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  const pending = await auth.scope.Subscription.where({ status: "past_due" }).where((s) => s.paymentId.isNotNull())
    .orderBy((s) => s.createdAt.desc()).select("paymentId", "checkoutUrl").first();
  const prices = planPrices(), limits = planLimits();
  return { configured: billingConfigured(), canManage: auth.user.role === "shop_owner", pendingPaymentId: pending?.paymentId ?? null, pendingCheckoutUrl: auth.user.role === "shop_owner" ? pending?.checkoutUrl ?? null : null, tenant: { ...tenant, subscriptionStatus: subscriptionStatus(tenant) },
    plans: PAID_PLANS.map((id) => ({ id, label: id === "basic" ? "Basic" : "Pro", ...limits[id], amount: prices[id].monthly, yearlyAmount: prices[id].yearly, currency: "BDT" })) };
}
export async function createCheckout(auth: TenantRequestContext, plan: PaidPlan, interval: BillingInterval = "monthly",
  gateway: BkashGateway = bkashGateway(), config: BillingConfig = billingConfig()) {
  await lockTenant(auth.tenantId);
  const tenant = await auth.db.orm.public.Tenant.where({ id: auth.tenantId }).select("subscriptionPlan", "subscriptionEndsAt").first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  if (tenant.subscriptionEndsAt && new Date(tenant.subscriptionEndsAt) > new Date() && tenant.subscriptionPlan !== plan)
    throw new ApiProblem("CONFLICT", "Renew your current plan, or wait until it expires to change plans.", 409);
  const pending = await auth.scope.Subscription.where({ status: "past_due" }).where((s) => s.paymentId.isNotNull()).select("id").first();
  if (pending) throw new ApiProblem("CONFLICT", "Check your pending payment before starting another checkout.", 409);
  const id = randomUUID(), token = randomBytes(32).toString("hex");
  const callback = new URL(`${config.appUrl}/api/v1/billing/callback`);
  callback.searchParams.set("reference", id); callback.searchParams.set("token", token);
  const amount = config.prices[plan][interval], durationMonths = interval === "yearly" ? 12 : 1;
  const payment = await gateway.create(id, amount, callback.toString());
  const url = bkashCheckoutUrl(payment, config.baseUrl.includes("sandbox"));
  await auth.scope.Subscription.create(auth.scope.own({ id, plan, status: "past_due", amount: numeric<10, 2>(amount), durationMonths,
    startedAt: new Date().toISOString(), paymentId: payment.paymentID, callbackToken: token, checkoutUrl: url }));
  await recordAudit({ tenantId: auth.tenantId, userId: auth.user.id, action: "billing.checkout.create", entityType: "subscription", entityId: id, metadata: { plan, interval, durationMonths } });
  return { url };
}

// The callback secret identifies a persisted checkout; the gateway proves payment.
export async function completeCallback(reference: string, token: string, paymentId: string, execute: boolean) {
  if (!/^[a-f0-9-]{36}$/.test(reference) || !/^[a-f0-9]{64}$/.test(token) || !paymentId || paymentId.length > 200)
    throw new ApiProblem("VALIDATION_ERROR", "Invalid payment callback.", 400);
  return withRequestRls(async (rls) => {
    const row = await rls.session.orm.public.Subscription.where({ id: reference }).select("tenantId", "callbackToken", "paymentId").first();
    if (!row?.callbackToken || row.callbackToken.length !== token.length || !timingSafeEqual(Buffer.from(row.callbackToken), Buffer.from(token)) || row.paymentId !== paymentId)
      throw new ApiProblem("FORBIDDEN", "Invalid payment callback.", 403);
    await rls.pinToTenant(row.tenantId);
    return settlePayment(row.tenantId, reference, execute);
  });
}
export async function checkPayment(auth: TenantRequestContext, paymentId: string) {
  const row = await auth.scope.Subscription.where({ paymentId }).select("id").first();
  if (!row) throw new ApiProblem("NOT_FOUND", "Payment not found.", 404);
  // Checking status must never execute another wallet charge.
  return settlePayment(auth.tenantId, row.id, false, auth.user.id);
}
export async function discardCheckout(tenantId: string, paymentId: string, actorId: string,
  gateway: BkashGateway = bkashGateway(), config: BillingConfig = billingConfig()) {
  await lockTenant(tenantId);
  const orm = rlsDb().orm.public;
  const row = await orm.Subscription.where({ tenantId, paymentId }).first();
  if (!row) throw new ApiProblem("NOT_FOUND", "Payment not found.", 404);
  if (row.paidAt) return { status: "success" };
  if (row.status === "cancelled") return { status: "cancelled" };
  const payment = await gateway.query(paymentId);
  if (payment.transactionStatus === "Completed") return settlePayment(tenantId, row.id, false, actorId, gateway, config);
  // Only an unapproved wallet checkout can be discarded. Unknown outcomes stay pending.
  verifyPaymentReference(payment, row);
  if (payment.transactionStatus !== "Initiated" || payment.verificationStatus !== "Incomplete")
    throw new ApiProblem("CONFLICT", "This payment cannot be discarded safely. Check its status or contact support.", 409);
  await orm.Subscription.where({ id: row.id, tenantId }).update({ status: "cancelled", checkoutUrl: null, callbackToken: null });
  await recordAudit({ tenantId, userId: actorId, action: "billing.checkout.discard", entityType: "subscription", entityId: row.id });
  return { status: "cancelled" };
}
export async function settlePayment(tenantId: string, id: string, execute: boolean, actorId: string | null = null,
  gateway: BkashGateway = bkashGateway(), config: BillingConfig = billingConfig()) {
  await lockTenant(tenantId);
  const orm = rlsDb().orm.public;
  const row = await orm.Subscription.where({ id, tenantId }).first();
  if (!row?.paymentId) throw new ApiProblem("NOT_FOUND", "Payment not found.", 404);
  if (row.paidAt) return { status: "success" };
  let payment = await gateway.query(row.paymentId);
  if (payment.transactionStatus !== "Completed" && execute && row.status !== "cancelled" && payment.statusCode === "0000" && payment.transactionStatus === "Initiated") {
    // An execute timeout may still charge the wallet. Query instead of executing twice.
    try { payment = await gateway.execute(row.paymentId); } catch { payment = await gateway.query(row.paymentId); }
    if (payment.transactionStatus !== "Completed") payment = await gateway.query(row.paymentId);
  }
  if (payment.statusCode === "0000" && ["Cancelled", "Failed", "Expired"].includes(payment.transactionStatus ?? "")) {
    await orm.Subscription.where({ id, tenantId }).update({ status: "cancelled", checkoutUrl: null });
    return { status: "cancelled" };
  }
  if (payment.statusCode === "0000" && payment.transactionStatus === "Initiated") return { status: "pending" };
  const transactionId = verifyPayment(payment, row);
  if (row.plan !== "basic" && row.plan !== "pro") throw new Error("Invalid paid plan");
  const tenant = await orm.Tenant.where({ id: tenantId }).select("subscriptionEndsAt", "subscriptionPlan").first();
  if (!tenant) throw new Error("Workspace not found");
  const now = new Date();
  const start = tenant.subscriptionPlan === row.plan && tenant.subscriptionEndsAt && new Date(tenant.subscriptionEndsAt) > now ? new Date(tenant.subscriptionEndsAt) : now;
  const endsAt = nextMonth(start, row.durationMonths);
  await orm.Subscription.where({ id, tenantId }).update({ status: "active", paidAt: now.toISOString(), transactionId,
    startedAt: start.toISOString(), endsAt, checkoutUrl: null });
  await orm.Tenant.where({ id: tenantId }).update({ subscriptionPlan: row.plan, subscriptionStatus: "active",
    subscriptionEndsAt: endsAt, trialEndsAt: null, ...config.limits[row.plan] });
  await recordAudit({ tenantId, userId: actorId, ...(actorId ? {} : { source: "bkash" as const }), action: "billing.payment.complete",
    entityType: "subscription", entityId: id, metadata: { plan: row.plan, durationMonths: row.durationMonths, amount: String(row.amount), transactionId, endsAt } });
  return { status: "success" };
}
