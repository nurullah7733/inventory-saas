"use client";

import Link from "next/link";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { Button } from "@/components/ui/field.tsx";

const QUICK_LINKS = [
  { href: "/sales/create", label: "Create invoice" },
  { href: "/sales/invoices", label: "Invoices" },
  { href: "/sales/drafts", label: "Draft invoices" },
  { href: "/inventory/products", label: "Products" },
  { href: "/inventory/stock", label: "Stock movements" },
  { href: "/reports", label: "Reports" },
];

export function DashboardOverview() {
  const query = useCurrentTenant();
  const data = query.data;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 break-words text-sm text-zinc-500 dark:text-zinc-400">
            {data ? `Welcome, ${data.viewer.name}.` : "Your workspace overview"}
          </p>
        </div>
        <Button variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {query.isPending && <div role="status" className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800">Loading workspace information…</div>}
      {data && (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Current workspace">
            <h2 className="break-words text-lg font-semibold">{data.tenant.name}</h2>
            {data.tenant.description && <p className="mt-1 break-words text-sm text-zinc-500">{data.tenant.description}</p>}
            <div className="mt-3 space-y-1 break-words text-sm text-zinc-600 dark:text-zinc-400">
              <p>{data.tenant.email}{data.tenant.phone ? ` · ${data.tenant.phone}` : ""}</p>
              {data.tenant.address && <p>{data.tenant.address}</p>}
            </div>
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary label="Products" value={String(data.usage.products)} detail={`Limit: ${data.usage.maxProducts}`} />
            <Summary label="Active users" value={String(data.usage.staff)} detail={`Limit: ${data.usage.maxStaff} · includes owner`} />
            <Summary label="Subscription" value={data.tenant.subscriptionPlan} detail={data.tenant.subscriptionStatus.replace(/_/g, " ")} />
          </div>
        </>
      )}
      <section aria-label="Quick actions" className="space-y-3">
        <h2 className="text-base font-semibold">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((link) => <Link key={link.href} href={link.href} className="flex min-h-14 items-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800">{link.label}</Link>)}
        </div>
      </section>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/settings/business" className="inline-flex min-h-11 items-center underline">Business settings</Link>
        <Link href="/settings/billing" className="inline-flex min-h-11 items-center underline">Subscription & billing</Link>
      </div>
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 className="text-sm text-zinc-500">{label}</h2>
    <p className="mt-1 text-2xl font-semibold capitalize">{value}</p>
    <p className="mt-1 text-xs text-zinc-500">{detail}</p>
  </section>;
}
