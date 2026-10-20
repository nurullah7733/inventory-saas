import type { SubscriptionStatus } from "./types.ts";

/** Prepaid access expires without needing a gateway webhook or scheduled job. */
export function subscriptionStatus(tenant: {
  subscriptionStatus: SubscriptionStatus; trialEndsAt: string | null; subscriptionEndsAt: string | null;
}, now = Date.now()): SubscriptionStatus {
  const status = tenant.subscriptionStatus;
  const end = status === "trial" ? tenant.trialEndsAt : status === "active" ? tenant.subscriptionEndsAt : null;
  return end && !(new Date(end).getTime() > now) ? "past_due" : status;
}
