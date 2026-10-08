import { z } from "zod";
export const PAID_PLANS = ["basic", "pro"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";
export const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS) }).strict();
export interface PlanLimits { maxProducts: number; maxStaff: number }
export interface BillingPlan extends PlanLimits {
  id: PaidPlan; label: string; amount: string | null; currency: string | null;
  interval: string | null; intervalCount: number | null;
}
export interface BillingSummary {
  configured: boolean; canManage: boolean; hasCustomer: boolean;
  tenant: { subscriptionPlan: string; subscriptionStatus: string; trialEndsAt: string | null;
    subscriptionEndsAt: string | null; maxProducts: number; maxStaff: number };
  plans: BillingPlan[];
}
