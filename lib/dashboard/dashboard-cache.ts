import type { DashboardPeriod } from "./types.ts";

/**
 * Dashboard query keys, shared by the client hooks (`lib/client/dashboard.ts`)
 * and the Server-Component prefetch so both sides address the identical cache
 * entries. Client-module exports cannot be read from an RSC, hence this
 * directive-free contract module.
 */
export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

export function dashboardSummaryKey(userId: string | undefined, period: DashboardPeriod | null) {
  return ["dashboard", "summary", userId, period] as const;
}

export function dashboardInsightsKey(userId: string | undefined, period: DashboardPeriod) {
  return ["dashboard", "insights", userId, period] as const;
}
