"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { formatMoney } from "@/lib/client/format.ts";
import { addDays } from "@/lib/dates.ts";
import { toCents } from "@/lib/numeric.ts";
import { dashboardDay, dashboardFilterSchema, dashboardWeek, type DashboardSummary, type DashboardTrend } from "@/lib/dashboard/types.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, ListSkeleton } from "@/components/ui/list-controls.tsx";

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
export function DashboardAnalytics() {
  const { session } = useSession();
  const [filter, setFilter] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["dashboard", "summary", session?.user.id, filter],
    queryFn: ({ signal }) => apiRequest<{ summary: DashboardSummary }>(`/dashboard/summary${filter ? `?${new URLSearchParams(filter)}` : ""}`, { signal }),
    enabled: !!session && session.user.role !== "super_admin", staleTime: 30_000, refetchOnMount: "always" });
  const summary = query.data?.summary;
  const today = summary?.today ?? dashboardDay();
  const visible = draft ?? summary?.period ?? { from: `${today.slice(0, 7)}-01`, to: today };
  function apply(period: { from: string; to: string }) {
    const parsed = dashboardFilterSchema.safeParse(period);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (period.to > today) { setError("Choose dates up to today."); return; }
    setError(""); setDraft(period); setFilter(period);
  }
  return <section className="space-y-4" aria-label="Sales and purchase overview">
    <form className={`${card} space-y-3`} onSubmit={(event) => { event.preventDefault(); apply(visible); }}>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="From date">{(props) => <input {...props} type="date" required value={visible.from} max={today} onChange={(e) => setDraft({ ...visible, from: e.target.value })} />}</Field>
        <Field label="To date">{(props) => <input {...props} type="date" required value={visible.to} max={today} onChange={(e) => setDraft({ ...visible, to: e.target.value })} />}</Field>
        <Button type="submit" disabled={query.isFetching}>Apply range</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={() => apply({ from: today, to: today })}>Today</Button>
        <Button type="button" variant="ghost" onClick={() => apply({ from: dashboardWeek(today).from, to: today })}>This week</Button>
        <Button type="button" variant="ghost" onClick={() => apply({ from: `${today.slice(0, 7)}-01`, to: today })}>This month</Button>
        <Button type="button" variant="ghost" onClick={() => apply({ from: addDays(today, -29), to: today })}>Last 30 days</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
    {query.isPending && <ListSkeleton label="Loading dashboard totals" />}
    {query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}
    {summary && <>
      <p className="text-sm text-zinc-500">{summary.period.from} to {summary.period.to} · {summary.timeZone} · {summary.totals.completedInvoices} completed invoices{query.isFetching ? " · Updating…" : ""}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Total sales", summary.totals.sales, "Completed invoices, including VAT"],
          ["Total purchases", summary.totals.purchases, "Stock received at recorded unit cost"],
          ["Sales returns", summary.totals.salesReturns, "Customer return credits in this period"],
          ["Purchase returns", summary.totals.purchaseReturns, "Supplier return credits in this period"],
          ["Net sales", summary.totals.netSales, "Total sales minus sales returns"],
          ["Net purchases", summary.totals.netPurchases, "Total purchases minus purchase returns"],
        ].map(([label, amount, detail]) => <article key={label} className={card} aria-label={label}>
          <h2 className="text-sm text-zinc-500">{label}</h2>
          <p className="mt-2 break-words text-2xl font-semibold" data-dashboard-amount>{formatMoney(amount, summary.currency)}</p>
          <p className="mt-1 text-xs text-zinc-500">{detail}</p>
        </article>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SalesOverview trend={summary.trend} currency={summary.currency} />
        <WeeklyComparison summary={summary} />
      </div>
      <section className={card} aria-label="Top-selling products">
        <h2 className="font-semibold">Top-selling products</h2><p className="mt-1 text-sm text-zinc-500">Top 5 by units sold minus units returned during the selected period.</p>
        {summary.topProducts.length === 0 ? <p className="mt-4 text-sm text-zinc-500">No net product sales in this period.</p> : <ol className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {summary.topProducts.map((p, i) => <li key={p.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0"><p className="break-words font-medium">{i + 1}. {p.name}{p.isDeleted ? " (archived)" : ""}</p><p className="break-words text-xs text-zinc-500">{p.sku} · Sold: {p.soldQuantity} · Returned: {p.returnedQuantity}</p></div>
            <p className="shrink-0 text-right font-semibold">{p.netQuantity}<span className="block text-xs font-normal text-zinc-500">net units</span></p>
          </li>)}
        </ol>}
      </section>
    </>}
  </section>;
}

function SalesOverview({ trend, currency }: { trend: DashboardTrend[]; currency: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const titleId = useId();
  const peak = trend.reduce((max, day) => {
    const value = toCents(day.sales) > toCents(day.salesReturns) ? toCents(day.sales) : toCents(day.salesReturns);
    return value > max ? value : max;
  }, BigInt(1));
  const width = 720, height = 220, step = width / Math.max(1, trend.length), barWidth = Math.max(1, step * 0.3);
  const scale = (value: string) => Number(toCents(value) * BigInt(10000) / peak) / 10000 * height;
  const active = trend.find((day) => day.date === selected) ?? trend.at(-1);
  const hasActivity = trend.some((day) => toCents(day.sales) > BigInt(0) || toCents(day.salesReturns) > BigInt(0));
  return <section className={card} aria-label="Sales overview bar chart">
    <h2 id={titleId} className="font-semibold">Sales overview</h2>
    <p className="mt-1 text-sm text-zinc-500"><span className="text-emerald-600">■ Sales</span> · <span className="text-orange-600">■ Return credits</span> · Hover or focus a day for details.</p>
    {!hasActivity && <p className="mt-4 text-sm text-zinc-500">No sales or returns in this period.</p>}
    <svg viewBox={`0 0 ${width} ${height + 35}`} className="mt-4 w-full" role="group" aria-labelledby={titleId}>
      <line x1="0" x2={width} y1={height} y2={height} stroke="currentColor" className="text-zinc-300" />
      {trend.map((day, i) => <g key={day.date} tabIndex={0} role="button" aria-label={`${day.date}: sales ${formatMoney(day.sales, currency)}, returns ${formatMoney(day.salesReturns, currency)}, net ${formatMoney(day.netSales, currency)}`}
        onMouseEnter={() => setSelected(day.date)} onFocus={() => setSelected(day.date)} onClick={() => setSelected(day.date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(day.date); } }} className="cursor-pointer outline-emerald-600">
        <title>{day.date}: sales {formatMoney(day.sales, currency)}, returns {formatMoney(day.salesReturns, currency)}</title>
        <rect x={i * step} y="0" width={step} height={height + 30} fill="transparent" />
        <rect x={i * step + step * .12} y={height - scale(day.sales)} width={barWidth} height={scale(day.sales)} fill="#059669" rx="1" />
        <rect x={i * step + step * .52} y={height - scale(day.salesReturns)} width={barWidth} height={scale(day.salesReturns)} fill="#ea580c" rx="1" />
        {(i === 0 || i === trend.length - 1 || (i % Math.max(1, Math.ceil(trend.length / 6)) === 0 && i < trend.length - 2)) &&
          <text x={i * step + step / 2} y={height + 23} textAnchor="middle" fontSize="12" fill="currentColor">{day.date.slice(5)}</text>}
      </g>)}
    </svg>
    <p className="mt-2 min-h-10 text-sm" aria-live="polite">{active && <>{active.date} · Sales: {formatMoney(active.sales, currency)} · Returns: {formatMoney(active.salesReturns, currency)} · Net: {formatMoney(active.netSales, currency)}</>}</p>
  </section>;
}

function WeeklyComparison({ summary }: { summary: DashboardSummary }) {
  const { week, currency } = summary;
  const sales = toCents(week.sales), purchases = toCents(week.purchases), total = sales + purchases;
  const salesPercent = total === BigInt(0) ? 0 : Number(sales * BigInt(10000) / total) / 100;
  const [highlight, setHighlight] = useState<"sales" | "purchases" | null>(null);
  return <section className={card} aria-label="This week's sales and purchases">
    <h2 className="font-semibold">This week: sales &amp; purchases</h2>
    <p className="mt-1 text-xs text-zinc-500">{week.from} to {week.to} · Monday–Sunday · Gross amounts</p>
    <div role="img" aria-label={`Weekly sales ${formatMoney(week.sales, currency)}; purchases ${formatMoney(week.purchases, currency)}`}
      className="relative mx-auto my-5 flex h-44 w-44 items-center justify-center rounded-full"
      style={{ background: total === BigInt(0) ? "#d4d4d8" : `conic-gradient(#059669 0% ${salesPercent}%, #2563eb ${salesPercent}% 100%)` }}>
      <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white text-center dark:bg-zinc-900">
        <span className="text-2xl font-semibold">{total === BigInt(0) ? "0" : `${highlight === "purchases" ? (100 - salesPercent).toFixed(1) : salesPercent.toFixed(1)}%`}</span>
        <span className="text-xs text-zinc-500">{total === BigInt(0) ? "No activity" : highlight === "purchases" ? "Purchases share" : "Sales share"}</span>
      </div>
    </div>
    <div className="space-y-2">
      <Button variant="ghost" className="w-full justify-between" onMouseEnter={() => setHighlight("sales")} onFocus={() => setHighlight("sales")} onClick={() => setHighlight("sales")}><span className="text-emerald-600">● Sales</span><span className="break-all">{formatMoney(week.sales, currency)}</span></Button>
      <Button variant="ghost" className="w-full justify-between" onMouseEnter={() => setHighlight("purchases")} onFocus={() => setHighlight("purchases")} onClick={() => setHighlight("purchases")}><span className="text-blue-600">● Purchases</span><span className="break-all">{formatMoney(week.purchases, currency)}</span></Button>
    </div>
    <p className="mt-3 text-xs text-zinc-500">Current week stays the same when the date filter changes. Return credits appear separately in the cards.</p>
  </section>;
}
