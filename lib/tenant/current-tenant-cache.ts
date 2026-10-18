/** Shared query key and response shape for the authenticated current-tenant client query. */
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
    invoiceType: string;
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
