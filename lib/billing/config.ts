import { ApiProblem } from "../api/response.ts";
import { MONEY_PATTERN, normalizeMoney, toCents } from "../numeric.ts";
import type { BillingInterval, PaidPlan, PlanLimits } from "./types.ts";

export interface BillingConfig {
  username: string; password: string; appKey: string; appSecret: string;
  baseUrl: string; appUrl: string; prices: Record<PaidPlan, Record<BillingInterval, string>>;
  limits: Record<PaidPlan, PlanLimits>;
}
export function billingUnavailable(): never {
  throw new ApiProblem("BILLING_UNAVAILABLE", "bKash billing is unavailable. Please contact the app owner.", 503);
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
export function planPrices(): Record<PaidPlan, Record<BillingInterval, string | null>> {
  const price = (name: string) => {
    const value = process.env[name]?.trim() ?? "";
    return MONEY_PATTERN.test(value) && toCents(value) > BigInt(0) ? normalizeMoney(value) : null;
  };
  return { basic: { monthly: price("BILLING_BASIC_PRICE_BDT"), yearly: price("BILLING_BASIC_YEARLY_PRICE_BDT") },
    pro: { monthly: price("BILLING_PRO_PRICE_BDT"), yearly: price("BILLING_PRO_YEARLY_PRICE_BDT") } };
}
export function billingConfigured(): boolean {
  try { billingConfig(); return true; } catch { return false; }
}
export function billingConfig(): BillingConfig {
  const read = (name: string) => process.env[name]?.trim() || billingUnavailable();
  const environment = process.env.BKASH_ENV ?? "sandbox";
  if (!["sandbox", "live"].includes(environment)) billingUnavailable();
  const prices = planPrices();
  if (!prices.basic.monthly || !prices.basic.yearly || !prices.pro.monthly || !prices.pro.yearly) billingUnavailable();
  let origin: URL;
  try { origin = new URL(read("APP_URL")); } catch { return billingUnavailable(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(environment === "sandbox" && local && origin.protocol === "http:")) ||
    origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") billingUnavailable();
  return { username: read("BKASH_USERNAME"), password: read("BKASH_PASSWORD"),
    appKey: read("BKASH_APP_KEY"), appSecret: read("BKASH_APP_SECRET"),
    baseUrl: environment === "sandbox" ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta" : "https://tokenized.pay.bka.sh/v1.2.0-beta",
    appUrl: origin.origin, prices: { basic: { monthly: prices.basic.monthly, yearly: prices.basic.yearly }, pro: { monthly: prices.pro.monthly, yearly: prices.pro.yearly } }, limits: planLimits() };
}
