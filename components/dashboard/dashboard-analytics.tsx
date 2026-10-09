"use client";

import { useState } from "react";
import { useIsFetching, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDashboardInsights, useDashboardSummary, DASHBOARD_QUERY_KEY } from "@/lib/client/dashboard.ts";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { apiRequest } from "@/lib/client/api.ts";
import { formatMoney } from "@/lib/client/format.ts";
import { formatCount } from "@/lib/client/dashboard-format.ts";
import { canViewFinance } from "@/lib/dashboard/permissions.ts";
import { dashboardDay, type DashboardPeriod } from "@/lib/dashboard/types.ts";
import type { InsightSection, InsightsResponse } from "@/lib/dashboard/insights-types.ts";
import { DashboardFilters } from "./dashboard-filters.tsx";
import { KpiCard } from "./kpi-card.tsx";
import { SalesOverviewChart } from "./sales-overview-chart.tsx";
import { CategoryDonut, DuesCard, RecentInvoicesCard, ReturnsSummary, StockAlertsCard, TopProductsTable, type CardState } from "./dashboard-detail-cards.tsx";

export function DashboardAnalytics() {
  const [filter, setFilter] = useState<DashboardPeriod | null>(null);
  const summaryQuery = useDashboardSummary(filter), tenantQuery = useCurrentTenant();
  const today = dashboardDay(), period = filter ?? { from: `${today.slice(0, 7)}-01`, to: today };
  const insights = useDashboardInsights(period), client = useQueryClient();
  const { session } = useSession(), financeVisible = canViewFinance(session?.user.role);
  const fetching = useIsFetching({ queryKey: DASHBOARD_QUERY_KEY }) > 0;
  const summary = summaryQuery.data?.summary, sections = insights.data?.sections;
  const currency = summary?.currency ?? tenantQuery.data?.tenant.currencySymbol ?? "BDT";
  const retry = useMutation({
    mutationFn: (section: InsightSection) => apiRequest<InsightsResponse>(`/dashboard/insights?${new URLSearchParams({ ...period, section })}`),
    onSuccess: (result) => client.setQueryData<InsightsResponse>(["dashboard", "insights", session?.user.id, result.period], (previous) => ({ period: result.period, sections: { ...previous?.sections, ...result.sections } })),
    onError: (error) => toast.error(error.message),
  });
  function cardState(section: InsightSection): CardState {
    return { loading: insights.isPending, error: insights.isError ? insights.error.message : sections?.[section]?.error, onRetry: () => { if (insights.isError) void insights.refetch(); else retry.mutate(section); } };
  }
  const summaryError = summaryQuery.isError ? summaryQuery.error.message : undefined;
  const comparison = sections?.comparison?.data, finance = sections?.finance?.data;
  const cash = (value?: string) => formatMoney(value ?? "0.00", currency);
  const summaryRetry = () => void summaryQuery.refetch();
  return <div className="ui-stack" aria-label="Dashboard analytics">
    <DashboardFilters period={period} onChange={setFilter} refreshing={fetching || tenantQuery.isFetching} onRefresh={() => { void tenantQuery.refetch(); void client.refetchQueries({ queryKey: DASHBOARD_QUERY_KEY }); }} />
    <div className={`grid gap-content sm:grid-cols-2 ${financeVisible ? "xl:grid-cols-4" : ""}`}>
      <KpiCard label="Net sales" amount={summary?.totals.netSales} currency={currency} previous={comparison?.totals.netSales} comparisonError={cardState("comparison").error} onComparisonRetry={cardState("comparison").onRetry} breakdown={`Sales ${cash(summary?.totals.sales)} − Returns ${cash(summary?.totals.salesReturns)}`} helper="Completed invoices including VAT, less customer return credits on the return date." loading={summaryQuery.isPending} error={summaryError} onRetry={summaryRetry} />
      <KpiCard label="Net purchases" amount={summary?.totals.netPurchases} currency={currency} previous={comparison?.totals.netPurchases} comparisonError={cardState("comparison").error} onComparisonRetry={cardState("comparison").onRetry} breakdown={`Purchases ${cash(summary?.totals.purchases)} − Returns ${cash(summary?.totals.purchaseReturns)}`} helper="Stock received at recorded unit cost, less supplier return credits at original receipt cost." loading={summaryQuery.isPending} error={summaryError} onRetry={summaryRetry} />
      {financeVisible && <><KpiCard label="Expenses" amount={finance?.expenses} currency={currency} previous={finance?.previousExpenses} breakdown="Operating expenses in the selected range" helper="Finance expense entries filtered by their expense date in Asia/Dhaka." {...cardState("finance")} expense /><KpiCard label="Gross profit" amount={finance?.grossProfit} currency={currency} previous={finance?.previousGrossProfit} breakdown={`Net sales − COGS ${cash(finance?.cogs)}`} helper="Net sales including VAT minus sale-time cost of goods sold, adjusted for returned units. Uses the existing Profit & Loss calculation." {...cardState("finance")} /></>}
    </div>
    {summary && <p className="text-[11px] text-muted">{formatCount(summary.totals.completedInvoices)} completed invoices · {comparison && `Compared with ${comparison.period.from} to ${comparison.period.to} · `}Updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }).format(new Date(summary.generatedAt))} Asia/Dhaka</p>}
    <div className="ui-card-grid items-start xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="contents xl:grid xl:min-w-0 xl:content-start xl:gap-section">
        <div className="order-1 min-w-0"><SalesOverviewChart period={period} currency={currency} /></div>
        <div className="order-4 min-w-0"><TopProductsTable state={cardState("products")} products={sections?.products?.data} currency={currency} /></div>
      </div>
      <div className="contents xl:grid xl:min-w-0 xl:content-start xl:gap-section">
        <div className="order-2 min-w-0"><StockAlertsCard state={cardState("stock")} wastage={sections?.stock?.data?.wastage} currency={currency} /></div>
        {financeVisible && <div className="order-3 min-w-0"><DuesCard state={cardState("dues")} data={sections?.dues?.data} currency={currency} asOf={period.to} /></div>}
        <div className="order-5 min-w-0"><RecentInvoicesCard state={cardState("invoices")} invoices={sections?.invoices?.data} currency={currency} /></div>
      </div>
    </div>
    <div className="ui-card-grid items-stretch xl:grid-cols-2"><CategoryDonut state={cardState("categories")} categories={sections?.categories?.data} currency={currency} /><ReturnsSummary state={cardState("returns")} counts={sections?.returns?.data} summary={summary} summaryError={summaryError} onSummaryRetry={summaryRetry} /></div>
  </div>;
}