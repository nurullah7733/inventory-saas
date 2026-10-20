import { z } from "zod";
export const PAID_PLANS = ["basic", "pro"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";
export const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(BILLING_INTERVALS).default("monthly") }).strict();
export const paymentSchema = z.object({ paymentId: z.string().min(1).max(200) }).strict();
export interface PlanLimits { maxProducts: number; maxStaff: number }
export interface BillingPlan extends PlanLimits {
  id: PaidPlan; label: string; amount: string | null; currency: string | null;
  yearlyAmount: string | null;
}
export interface BillingSummary {
  configured: boolean; canManage: boolean; pendingPaymentId: string | null; pendingCheckoutUrl: string | null;
  tenant: { subscriptionPlan: string; subscriptionStatus: string; trialEndsAt: string | null;
    subscriptionEndsAt: string | null; maxProducts: number; maxStaff: number };
  plans: BillingPlan[];
}
