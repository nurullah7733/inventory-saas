"use client";
import Link from "next/link";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { canViewFinance } from "@/lib/dashboard/permissions.ts";
import { AppIcon } from "@/components/ui/app-icon.tsx";

export function SidebarPlanCard({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate: () => void }) {
  const query = useCurrentTenant(), { session } = useSession();
  if (!query.data || !canViewFinance(session?.user.role)) return null;
  const { tenant, usage } = query.data;
  if (collapsed) return <Link href="/settings/billing" aria-label="Subscription & billing" title={`${tenant.subscriptionPlan} · Products ${usage.products}/${usage.maxProducts}`} onClick={onNavigate} className="mx-item mb-item flex shrink-0 min-h-11 items-center justify-center rounded-lg bg-primary/8 text-primary"><AppIcon name="finance" /></Link>;
  return <section className="mx-item mb-item shrink-0 rounded-xl border border-primary/15 bg-primary/5 p-item" aria-label="Workspace plan"><div className="flex justify-between gap-small text-xs"><span className="font-semibold capitalize">{tenant.subscriptionPlan} plan</span>{tenant.subscriptionStatus.toLowerCase() !== tenant.subscriptionPlan.toLowerCase() && <span className="capitalize text-muted">{tenant.subscriptionStatus.replace(/_/g, " ")}</span>}</div><p className="mt-small text-xs text-muted">Products {usage.products.toLocaleString("en-US")}/{usage.maxProducts.toLocaleString("en-US")}</p><Link href="/settings/billing" onClick={onNavigate} className="mt-item flex min-h-11 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-surface">Upgrade</Link></section>;
}
