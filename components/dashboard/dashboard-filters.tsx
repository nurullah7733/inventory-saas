"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Field } from "@/components/ui/field.tsx";
import { AppIcon } from "@/components/ui/app-icon.tsx";
import { dashboardDay, dashboardFilterSchema, dashboardWeek, type DashboardPeriod } from "@/lib/dashboard/types.ts";
import { addDays } from "@/lib/dates.ts";
import { formatCalendarDate } from "@/lib/client/format.ts";

export function DashboardFilters({ period, onChange, refreshing, onRefresh }: { period: DashboardPeriod; onChange: (period: DashboardPeriod) => void; refreshing: boolean; onRefresh: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(period), [error, setError] = useState("");
  const today = dashboardDay();
  const presets = [{ label: "Today", from: today, to: today }, { label: "This week", from: dashboardWeek(today).from, to: today }, { label: "This month", from: `${today.slice(0, 7)}-01`, to: today }, { label: "Last 30 days", from: addDays(today, -29), to: today }];
  function apply(range: DashboardPeriod) {
    const parsed = dashboardFilterSchema.safeParse(range);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (range.to > today) { setError("Choose dates up to today in Asia/Dhaka."); return; }
    setError(""); onChange(range); dialog.current?.close();
  }
  return <div className="space-y-small"><div className="flex flex-wrap items-center gap-small">
    <div role="group" aria-label="Date presets" className="flex max-w-full flex-wrap gap-tight rounded-lg bg-surface-muted p-tight">{presets.map(({ label, from, to }) => { const active = period.from === from && period.to === to; return <button key={label} type="button" aria-pressed={active} onClick={() => apply({ from, to })} className={`min-h-11 rounded-md px-item text-xs transition ${active ? "bg-surface font-semibold text-primary shadow-panel" : "text-muted hover:text-foreground"}`}>{label}</button>; })}</div>
    <Button variant="ghost" className="min-w-0 text-xs" aria-haspopup="dialog" aria-label="Choose date range" onClick={() => { setDraft(period); setError(""); dialog.current?.showModal(); }}><AppIcon name="calendar" className="shrink-0" /><span className="truncate">{formatCalendarDate(period.from)} – {formatCalendarDate(period.to)}</span></Button>
    <Button variant="ghost" disabled={refreshing} aria-label="Refresh dashboard" title="Refresh dashboard" className="px-item" onClick={onRefresh}><AppIcon name="refresh" className={refreshing ? "motion-safe:animate-spin" : ""} /></Button>
    <Link href="/sales/create" className="ml-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-content text-xs font-semibold text-surface">+ Create invoice</Link>
  </div><p role="status" className="text-[11px] text-muted">{period.from} to {period.to} · Asia/Dhaka{refreshing ? " · Updating…" : ""}</p>
    <dialog ref={dialog} aria-label="Choose dashboard date range" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface p-section text-foreground shadow-app backdrop:bg-black/40">
      <form className="space-y-content" onSubmit={(event) => { event.preventDefault(); apply(draft); }}><div className="flex items-center justify-between gap-item"><h2 className="text-sm font-semibold">Date range</h2><button type="button" aria-label="Close date range" onClick={() => dialog.current?.close()} className="flex min-h-11 min-w-11 items-center justify-center"><AppIcon name="close" /></button></div><p className="text-xs text-muted">Select up to 93 days, through today in Asia/Dhaka.</p><div className="grid gap-item sm:grid-cols-2"><Field label="Start date">{(props) => <input {...props} required type="date" max={today} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />}</Field><Field label="End date">{(props) => <input {...props} required type="date" max={today} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />}</Field></div>{error && <p role="alert" className="text-xs text-danger">{error}</p>}<Button type="submit" className="w-full">Use date range</Button></form>
    </dialog>
  </div>;
}
