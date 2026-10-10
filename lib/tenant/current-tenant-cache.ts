/**
 * The query key and response shape for the authenticated "current tenant"
 * endpoint. Lives in a directive-free module so BOTH the client hook
 * (`lib/client/current-tenant.ts`) and Server Components read the identical
 * identity — a shared cache contract, exactly as the TanStack Query SSR guide
 * requires. Client-module exports cannot be read from an RSC.
 */
export const CURRENT_TENANT_QUERY_KEY = ["currentTenant"] as const;

export interface CurrentTenantResponse {
  tenant: {
    id: string;
    name: string;
    logoUrl: string | null;
    description: string | null;
    email: string;
    phone: string | null;
    address: string | null;
    currencySymbol: string;
    vatPercentage: string;
    lowStockThreshold: number;
    subscriptionPlan: string;
    subscriptionStatus: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
  };
  usage: { products: number; maxProducts: number; staff: number; maxStaff: number };
  viewer: { id: string; name: string; email: string; photoUrl: string | null; role: string };
}
