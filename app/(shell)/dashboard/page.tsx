import { HydrationBoundary } from "@tanstack/react-query";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview.tsx";
import {
  defaultDashboardPeriod,
  loadServerSession,
  prefetchDashboard,
} from "@/lib/server/first-paint.ts";

/**
 * The dashboard is the main first-paint surface: the summary and insight
 * sections are prefetched server-side through the authenticated API and
 * hydrated into TanStack Query, so the KPI cards render real numbers as soon
 * as the client takes over — with the current date-range respected, and no
 * tenant data kept anywhere beyond this single request.
 */
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await loadServerSession();
  const state = session ? await prefetchDashboard(session, defaultDashboardPeriod()) : null;
  return (
    <HydrationBoundary state={state}>
      <DashboardOverview />
    </HydrationBoundary>
  );
}
