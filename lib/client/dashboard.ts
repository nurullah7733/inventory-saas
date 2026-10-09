"use client";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api.ts";
import { useSession } from "./use-session.ts";
import { dashboardDay, type DashboardPeriod, type DashboardSummary } from "../dashboard/types.ts";
import type { InsightsResponse, ChartWindow, SalesChartResponse } from "../dashboard/insights-types.ts";

export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;
export function useDashboardSummary(period: DashboardPeriod | null) {
  const { session } = useSession();
  return useQuery({ queryKey: ["dashboard", "summary", session?.user.id, period], queryFn: ({ signal }) => apiRequest<{ summary: DashboardSummary }>(`/dashboard/summary${period ? `?${new URLSearchParams({ ...period })}` : ""}`, { signal }), enabled: !!session && session.user.role !== "super_admin", staleTime: 30_000, refetchOnMount: "always" });
}
export function useDashboardInsights(period: DashboardPeriod) {
  const { session } = useSession();
  return useQuery({ queryKey: ["dashboard", "insights", session?.user.id, period], queryFn: ({ signal }) => apiRequest<InsightsResponse>(`/dashboard/insights?${new URLSearchParams({ ...period })}`, { signal }), enabled: !!session && session.user.role !== "super_admin", staleTime: 30_000 });
}
export function useSalesChart(period: DashboardPeriod, window: ChartWindow) {
  const { session } = useSession();
  return useQuery({ queryKey: ["dashboard", "chart", session?.user.id, period, window], queryFn: ({ signal }) => apiRequest<SalesChartResponse>(`/dashboard/chart?${new URLSearchParams({ ...period, window })}`, { signal }), enabled: !!session && session.user.role !== "super_admin", staleTime: 30_000 });
}
export function useDashboardAlerts() {
  const { session } = useSession();
  const enabled = !!session && session.user.role !== "super_admin";
  const today = dashboardDay();
  const lowStock = useQuery({ queryKey: ["dashboard", "alerts", "low-stock", session?.user.id], queryFn: ({ signal }) => apiRequest<{ total: number }>("/alerts/low-stock?pageSize=1", { signal }), enabled, staleTime: 30_000 });
  const nearExpiry = useQuery({ queryKey: ["dashboard", "alerts", "near-expiry", session?.user.id, today], queryFn: ({ signal }) => apiRequest<{ total: number }>(`/alerts/near-expiry?pageSize=1&asOf=${today}`, { signal }), enabled, staleTime: 30_000 });
  return { lowStock, nearExpiry };
}
