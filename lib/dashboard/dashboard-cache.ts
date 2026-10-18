import type { DashboardPeriod } from "./types.ts";

/** Dashboard query keys shared by client hooks and cache invalidation. */
export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

export function dashboardSummaryKey(userId: string | undefined, period: DashboardPeriod | null) {
  return ["dashboard", "summary", userId, period] as const;
}

export function dashboardInsightsKey(userId: string | undefined, period: DashboardPeriod) {
  return ["dashboard", "insights", userId, period] as const;
}
