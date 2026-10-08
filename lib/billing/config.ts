import { ApiProblem } from "../api/response.ts";
import type { PaidPlan, PlanLimits } from "./types.ts";

export interface BillingConfig {
  secretKey: string; webhookSecret: string; appUrl: string;
  prices: Record<PaidPlan, string>; limits: Record<PaidPlan, PlanLimits>;
}
export function billingUnavailable(message = "Billing is not available yet. Please contact the app owner."): never {
  throw new ApiProblem("BILLING_UNAVAILABLE", message, 503);
}
export function planLimits(): Record<PaidPlan, PlanLimits> {
  const integer = (name: string, fallback: number) => {
    const raw = process.env[name]; if (!raw?.trim()) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 1_000_000) billingUnavailable();
    return Number(raw);
  };
  return { basic: { maxProducts: integer("BILLING_BASIC_MAX_PRODUCTS", 100), maxStaff: integer("BILLING_BASIC_MAX_STAFF", 5) },
    pro: { maxProducts: integer("BILLING_PRO_MAX_PRODUCTS", 1000), maxStaff: integer("BILLING_PRO_MAX_STAFF", 20) } };
}
export function billingConfigured() {
  return ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_BASIC_PRICE_ID", "STRIPE_PRO_PRICE_ID", "APP_URL"]
    .every((name) => !!process.env[name]?.trim());
}
export function billingWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret?.startsWith("whsec_")) return billingUnavailable();
  return secret;
}
/** Read lazily: missing billing credentials must not break auth or next build. */
export function billingConfig(): BillingConfig {
  if (!billingConfigured()) billingUnavailable();
  const secretKey = process.env.STRIPE_SECRET_KEY!.trim(), webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!.trim();
  const prices = { basic: process.env.STRIPE_BASIC_PRICE_ID!.trim(), pro: process.env.STRIPE_PRO_PRICE_ID!.trim() };
  if (!/^(sk|rk)_(test|live)_/.test(secretKey) || !webhookSecret.startsWith("whsec_") ||
    !Object.values(prices).every((id) => /^price_[A-Za-z0-9_]+$/.test(id)) || prices.basic === prices.pro) billingUnavailable();
  let origin: URL;
  try { origin = new URL(process.env.APP_URL!.trim()); } catch { return billingUnavailable(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
    origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") billingUnavailable();
  return { secretKey, webhookSecret, prices, appUrl: origin.origin, limits: planLimits() };
}
