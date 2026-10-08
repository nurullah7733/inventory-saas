"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useRequireSession, useSignOut } from "@/lib/client/use-session.ts";
import { Button } from "@/components/ui/field.tsx";
import { ApiClientError } from "@/lib/client/api.ts";
import { TenantLogo } from "./tenant-logo.tsx";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sales/create", label: "Create invoice" },
  { href: "/sales/invoices", label: "Invoices" },
  { href: "/sales/drafts", label: "Draft invoices" },
  { href: "/inventory/returns", label: "Returns" },
  { href: "/inventory/purchase-returns", label: "Purchase returns" },
  { href: "/inventory/products", label: "Products" },
  { href: "/inventory/stock", label: "Stock" },
  { href: "/inventory/low-stock", label: "Low stock" },
  { href: "/inventory/near-expiry", label: "Near expiry" },
  { href: "/inventory/wastage", label: "Wastage" },
  { href: "/inventory/suppliers", label: "Suppliers" },
  { href: "/inventory/categories", label: "Categories" },
  { href: "/inventory/variants", label: "Variant options" },
  { href: "/people/customers", label: "Customers" },
  { href: "/finance/expense-categories", label: "Expense categories" },
  { href: "/finance/expenses", label: "Expenses" },
  { href: "/finance/supplier-payments", label: "Supplier payments" },
  { href: "/reports", label: "Reports" },
  { href: "/settings/business", label: "Business settings" },
  { href: "/settings/billing", label: "Subscription & billing" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, session } = useRequireSession();
  const pathname = usePathname();
  const signOut = useSignOut();

  const currentTenant = useCurrentTenant();

  if (status !== "authenticated") {
    // `useRequireSession` is already redirecting; this is the frame in between.
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        Checking your session…
      </div>
    );
  }

  if (session?.user.role === "super_admin") {
    return <main className="mx-auto w-full max-w-4xl p-6"><h1 className="text-xl font-semibold">Platform account</h1><Link className="mt-4 inline-block underline" href="/admin">Open Super Admin panel</Link></main>;
  }

  const tenant = currentTenant.data?.tenant;
  const denied = currentTenant.error instanceof ApiClientError &&
    [401, 403].includes(currentTenant.error.status);

  if (denied) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Workspace unavailable</h1>
        <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">{currentTenant.error?.message}</p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={currentTenant.isFetching} onClick={() => void currentTenant.refetch()}>Retry</Button>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          <TenantLogo key={tenant?.logoUrl ?? "initial"} name={tenant?.name ?? ""} logoUrl={tenant?.logoUrl ?? null} />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={tenant?.name}>
              {tenant?.name ?? (currentTenant.isError ? "Workspace unavailable" : "Loading workspace…")}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {currentTenant.data?.viewer.name}
              {currentTenant.data
                ? ` · ${currentTenant.data.viewer.role.replace("_", " ")}`
                : ""}
            </p>
          </div>

          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>

        {currentTenant.isError && (
          <div role="alert" className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-4 pb-3 text-sm text-red-700 dark:text-red-400">
            <span className="min-w-0 flex-1">Could not refresh workspace information. {currentTenant.error.message}</span>
            <Button variant="ghost" disabled={currentTenant.isFetching} onClick={() => void currentTenant.refetch()}>
              {currentTenant.isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        )}

        <nav className="mx-auto flex w-full max-w-4xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
