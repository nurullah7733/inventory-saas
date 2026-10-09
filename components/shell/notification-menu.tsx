"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useDashboardAlerts } from "@/lib/client/dashboard.ts";
import { AppIcon } from "@/components/ui/app-icon.tsx";

export function NotificationMenu() {
  const alerts = useDashboardAlerts(), container = useRef<HTMLDetailsElement>(null);
  const total = alerts.lowStock.data && alerts.nearExpiry.data ? alerts.lowStock.data.total + alerts.nearExpiry.data.total : undefined;
  useEffect(() => {
    function outside(event: PointerEvent) { if (event.target instanceof Node && !container.current?.contains(event.target) && container.current) container.current.open = false; }
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && container.current?.open) { container.current.open = false; container.current.querySelector("summary")?.focus(); } }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={container} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
    <summary aria-label={`Stock alerts${total === undefined ? "" : `: ${total}`}`} className="relative flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full bg-surface-muted [&::-webkit-details-marker]:hidden"><AppIcon name="bell" />{total !== undefined && total > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-danger px-compact text-[10px] font-semibold text-surface">{total > 99 ? "99+" : total}</span>}</summary>
    <div className="ui-panel absolute right-0 top-full z-30 mt-small w-60 max-w-[calc(100vw-2rem)] p-item"><h2 className="mb-small text-sm font-semibold">Stock alerts</h2>{[
      { label: "Low stock", href: "/inventory/low-stock", query: alerts.lowStock },
      { label: "Near expiry", href: "/inventory/near-expiry", query: alerts.nearExpiry },
    ].map(({ label, href, query }) => <div key={href}><Link href={href} onClick={() => { if (container.current) container.current.open = false; }} className="flex min-h-11 items-center justify-between gap-small rounded-lg px-small text-xs hover:bg-surface-muted"><span>{label}</span><span>{query.data ? query.data.total.toLocaleString("en-US") : query.isError ? "Unavailable" : "Loading…"}</span></Link>{query.isError && <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="min-h-11 px-small text-xs text-danger">Retry {label.toLowerCase()}</button>}</div>)}<p className="mt-small text-[11px] text-muted">Current inventory · expiry within 30 days, including expired stock.</p></div>
  </details>;
}
