"use client";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useDashboardAlerts } from "@/lib/client/dashboard.ts";
import { AppIcon } from "@/components/ui/app-icon.tsx";

/**
 * The bell's stock-alert menu, built on the Radix dropdown primitive —
 * opening, closing, outside-click, Escape and arrow-key navigation come from
 * the shared shadcn/Radix layer instead of the previous details/summary hack.
 * The panel keeps its `ui-panel` look; every row keeps its 44px tap target.
 */
export function NotificationMenu() {
  const alerts = useDashboardAlerts();
  const total = alerts.lowStock.data && alerts.nearExpiry.data ? alerts.lowStock.data.total + alerts.nearExpiry.data.total : undefined;
  const rows = [
    { label: "Low stock", href: "/inventory/low-stock", query: alerts.lowStock },
    { label: "Near expiry", href: "/inventory/near-expiry", query: alerts.nearExpiry },
  ];
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger aria-label={`Stock alerts${total === undefined ? "" : `: ${total}`}`} className="relative flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full bg-surface-muted data-[state=open]:bg-zinc-200 dark:data-[state=open]:bg-zinc-800">
      <AppIcon name="bell" />
      {total !== undefined && total > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-danger px-compact text-[10px] font-semibold text-surface">{total > 99 ? "99+" : total}</span>}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={8} asChild>
        <div className="ui-panel z-30 w-60 max-w-[calc(100vw-2rem)] p-item motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 duration-150">
          <DropdownMenu.Arrow asChild><span className="fill-surface" aria-hidden="true" /></DropdownMenu.Arrow>
          <h2 className="mb-small text-sm font-semibold">Stock alerts</h2>
          {rows.map(({ label, href, query }) => <div key={href}>
            <DropdownMenu.Item asChild>
              <Link href={href} className="flex min-h-11 items-center justify-between gap-small rounded-lg px-small text-xs outline-none hover:bg-surface-muted focus:bg-surface-muted">
                <span>{label}</span>
                <span>{query.data ? query.data.total.toLocaleString("en-US") : query.isError ? "Unavailable" : "Loading…"}</span>
              </Link>
            </DropdownMenu.Item>
            {query.isError && <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="min-h-11 px-small text-xs text-danger">Retry {label.toLowerCase()}</button>}
          </div>)}
          <p className="mt-small text-[11px] text-muted">Current inventory · expiry within 30 days, including expired stock.</p>
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
