import { z } from "zod";

export const tenantIdSchema = z.string().uuid();
export const tenantListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  access: z.enum(["all", "active", "suspended"]).default("all"),
  status: z.enum(["all", "trial", "active", "past_due", "cancelled"]).default("all"),
}).strict();
export const accessSchema = z.object({
  isActive: z.boolean(),
  expectedIsActive: z.boolean(),
  reason: z.string().trim().min(3).max(500),
}).strict();
export type TenantListFilter = z.infer<typeof tenantListSchema>;
export interface AdminTenant {
  id: string; name: string; email: string; phone: string | null; isActive: boolean;
  subscriptionPlan: string; subscriptionStatus: string; trialEndsAt: string | null;
  subscriptionEndsAt: string | null; maxProducts: number; maxStaff: number; createdAt: string;
}
export interface TenantList { tenants: AdminTenant[]; total: number; page: number; pageSize: number }
export interface TenantDetail { tenant: AdminTenant; usage: { products: number; staff: number }; owners: { id: string; name: string; email: string }[] }
export interface RevenueSummary {
  available: boolean; asOf: string; message?: string;
  currencies: { currency: string; mrr: string; arr: string; subscriptions: number }[];
  excluded: number;
}
