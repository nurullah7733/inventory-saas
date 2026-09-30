import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Placeholder. The real dashboard — summary cards for today's sales, profit
 * snapshot, low stock count and dues — is step 14 of the build order. This
 * exists because `proxy.ts` sends a signed-in visitor here, so the route has
 * to resolve to something.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Sales, stock and profit summaries land here later in the build order.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/sales/create" className="inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">Create invoice</Link>
        <Link href="/sales/invoices" className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-4 text-sm font-semibold dark:border-zinc-700">Invoices</Link>
        <Link href="/sales/drafts" className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-4 text-sm font-semibold dark:border-zinc-700">Draft invoices</Link>
        <Link href="/inventory/returns" className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-4 text-sm font-semibold dark:border-zinc-700">Returns</Link>
      </div>
      <Link
        href="/settings/business"
        className="inline-flex w-fit min-h-11 items-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Open business settings
      </Link>
    </div>
  );
}
