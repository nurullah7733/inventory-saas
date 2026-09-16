"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/lib/client/api.ts";
import { useRequireSession, useSignOut } from "@/lib/client/use-session.ts";
import { Button } from "@/components/ui/field.tsx";

/**
 * The signed-in chrome: header with the shop's identity, and navigation.
 *
 * Deliberately the smallest thing that makes the Business Settings screen
 * reachable and recognisable — the full sidebar, the module navigation and
 * the dashboard summary cards belong to later steps of the build order. What
 * IS implemented properly here is the rule from the brief: the shop's name and
 * logo come from the authenticated `/tenant/current` endpoint, never from a
 * tenant id the client holds.
 */

interface CurrentTenantResponse {
  tenant: {
    id: string;
    name: string;
    logoUrl: string | null;
    currencySymbol: string;
    subscriptionPlan: string;
    subscriptionStatus: string;
  };
  usage: { products: number; maxProducts: number; staff: number; maxStaff: number };
  viewer: { id: string; name: string; role: string };
}

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings/business", label: "Business settings" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useRequireSession();
  const pathname = usePathname();
  const signOut = useSignOut();

  const currentTenant = useQuery({
    queryKey: ["tenant", "current"],
    queryFn: () => apiRequest<CurrentTenantResponse>("/tenant/current"),
    // No point asking who we are before we hold a token.
    enabled: status === "authenticated",
  });

  if (status !== "authenticated") {
    // `useRequireSession` is already redirecting; this is the frame in between.
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        Checking your session…
      </div>
    );
  }

  const tenant = currentTenant.data?.tenant;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          {tenant?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={tenant.logoUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {(tenant?.name ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {tenant?.name ?? "Loading…"}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {currentTenant.data?.viewer.name}
              {currentTenant.data ? ` · ${currentTenant.data.viewer.role.replace("_", " ")}` : ""}
            </p>
          </div>

          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>

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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
