"use client";
import { useId } from "react";
import { formatMoney } from "@/lib/client/format.ts";
import { kpiComparison } from "@/lib/dashboard/insights-calculations.ts";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon.tsx";
import { CardError, CardSkeleton } from "./dashboard-card.tsx";

const KPI_VISUALS: Record<string, { icon: AppIconName; colors: string; decreaseIsBetter?: boolean }> = {
  "Net sales": { icon: "sales", colors: "from-purple-100 to-purple-50 text-purple-600 dark:from-purple-900/50 dark:to-purple-950/30 dark:text-purple-400" },
  "Net purchases": { icon: "purchases", colors: "from-amber-100 to-amber-50 text-amber-600 dark:from-amber-900/50 dark:to-amber-950/30 dark:text-amber-400", decreaseIsBetter: true },
  "Expenses": { icon: "wallet", colors: "from-rose-100 to-rose-50 text-rose-600 dark:from-rose-900/50 dark:to-rose-950/30 dark:text-rose-400", decreaseIsBetter: true },
  "Gross profit": { icon: "reports", colors: "from-emerald-100 to-emerald-50 text-emerald-600 dark:from-emerald-900/50 dark:to-emerald-950/30 dark:text-emerald-400" },
};

export function KpiCard({ label, amount, currency, previous, comparisonError, onComparisonRetry, breakdown, helper, loading, error, onRetry, expense = false }: { label: string; amount?: string; currency: string; previous?: string; comparisonError?: string; onComparisonRetry?: () => void; breakdown: string; helper: string; loading: boolean; error?: string; onRetry: () => void; expense?: boolean }) {
  const visual = KPI_VISUALS[label] ?? KPI_VISUALS["Net sales"];
  const id = useId(), change = amount !== undefined && previous !== undefined ? kpiComparison(amount, previous, expense || visual.decreaseIsBetter) : undefined;
  return <section className="ui-panel"><div className="mb-content flex items-center justify-between gap-item"><div className="flex min-w-0 items-center gap-item"><span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br ${visual.colors}`}><AppIcon name={visual.icon} className="h-5 w-5" /></span><h2 className="text-xs font-medium text-muted">{label}</h2></div><span className="group relative shrink-0"><button type="button" aria-label={`About ${label}`} aria-describedby={id} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-muted"><AppIcon name="info" className="h-4 w-4" /></button><span id={id} role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 hidden w-52 rounded-lg border border-border bg-surface p-item text-xs shadow-app group-hover:block group-focus-within:block">{helper}</span></span></div>
    {loading ? <CardSkeleton compact /> : error ? <CardError message={error} onRetry={onRetry} /> : <><p className="break-words text-2xl font-semibold tracking-tight" data-dashboard-amount>{formatMoney(amount ?? "0.00", currency)}</p><p className="mt-small break-words text-[11px] text-muted">{breakdown}</p>
      {comparisonError ? <button type="button" onClick={onComparisonRetry} className="mt-item min-h-11 text-left text-[11px] text-danger">Comparison unavailable · Retry</button> : <p title={change?.label} className={`mt-item text-[11px] tracking-tight sm:truncate ${change?.tone === "positive" ? "text-success" : change?.tone === "negative" ? "text-danger" : "text-muted"}`}>{change?.label ?? "Loading comparison..."}</p>}
    </>}
  </section>;
}
