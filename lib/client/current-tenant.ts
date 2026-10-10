"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api.ts";
import { useSession } from "./use-session.ts";
import { CURRENT_TENANT_QUERY_KEY, type CurrentTenantResponse } from "../tenant/current-tenant-cache.ts";

/**
 * The signed-in shop, from `/tenant/current` — the brief's rule is that the
 * shop's identity comes from this authenticated endpoint, never from a tenant
 * id the client holds. Shared by the header and by every screen that needs
 * the currency symbol or the viewer's role; TanStack Query dedupes the fetch.
 */

export { CURRENT_TENANT_QUERY_KEY } from "../tenant/current-tenant-cache.ts";
export type { CurrentTenantResponse } from "../tenant/current-tenant-cache.ts";

export function useCurrentTenant() {
  const { status, session } = useSession();
  return useQuery({
    queryKey: CURRENT_TENANT_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest<CurrentTenantResponse>("/tenant/current", { signal }),
    // No point asking who we are before we hold a token.
    enabled: status === "authenticated" && session?.user.role !== "super_admin",
  });
}

/** The shop's currency symbol, "BDT" until the tenant has loaded. */
export function useCurrencySymbol(): string {
  return useCurrentTenant().data?.tenant.currencySymbol ?? "BDT";
}

/** Owners and managers edit master data (products, suppliers, categories). */
export function useCanManageInventory(): boolean {
  const { session } = useSession();
  const role = session?.user.role;
  return role === "shop_owner" || role === "manager";
}
