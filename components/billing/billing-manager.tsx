"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { CURRENT_TENANT_QUERY_KEY } from "@/lib/client/current-tenant.ts";
import { Button } from "@/components/ui/field.tsx";
import type { BillingSummary, PaidPlan } from "@/lib/billing/types.ts";

export function BillingManager() {
  const params = useSearchParams(), client = useQueryClient();
  const returning = params.get("checkout") === "success";
  const [pollUntil] = useState(() => Date.now() + 30_000);
  const query = useQuery({ queryKey: ["billing"], queryFn: () => apiRequest<{ billing: BillingSummary }>("/billing"),
    // A redirect doesn't prove payment. Poll briefly for the verified webhook result.
    refetchInterval: () => returning && Date.now() < pollUntil ? 2000 : false });
  useEffect(() => { if (returning) void client.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY }); }, [returning, client, query.dataUpdatedAt]);
  const checkout = useMutation({ mutationFn: (plan: PaidPlan) => apiRequest<{ url: string }>("/billing/checkout", { method: "POST", body: { plan } }),
    onSuccess: ({ url }) => window.location.assign(url), onError: (error) => toast.error(error.message) });
  const portal = useMutation({ mutationFn: () => apiRequest<{ url: string }>("/billing/portal", { method: "POST", body: {} }),
    onSuccess: ({ url }) => window.location.assign(url), onError: (error) => toast.error(error.message) });
  const billing = query.data?.billing;
  const busy = checkout.isPending || portal.isPending;
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : "—";
  return <div className="flex flex-col gap-5">
    <div><h1 className="text-xl font-semibold">Subscription & billing</h1><p className="mt-1 text-sm text-zinc-500">Choose a plan and manage your shop subscription.</p></div>
    {returning && <p role="status" className="rounded-xl border p-4 text-sm">Checkout finished. Your subscription status updates after payment confirmation. Refresh if the status has not updated yet.</p>}
    {params.get("checkout") === "cancelled" && <p role="status" className="text-sm text-zinc-500">Checkout was cancelled. You can choose a plan again.</p>}
    {query.isPending && <p role="status">Loading billing…</p>}
    {query.isError && <div role="alert"><p className="text-red-600">{query.error.message}</p><Button variant="ghost" onClick={() => void query.refetch()}>Try again</Button></div>}
    {billing && <>
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div><dt className="text-sm text-zinc-500">Current plan</dt><dd className="mt-1 font-semibold capitalize">{billing.tenant.subscriptionPlan}</dd></div>
        <div><dt className="text-sm text-zinc-500">Status</dt><dd className="mt-1 font-semibold capitalize">{billing.tenant.subscriptionStatus.replaceAll("_", " ")}</dd></div>
        <div><dt className="text-sm text-zinc-500">Trial ends</dt><dd>{date(billing.tenant.trialEndsAt)}</dd></div>
        <div><dt className="text-sm text-zinc-500">Subscription period ends</dt><dd>{date(billing.tenant.subscriptionEndsAt)}</dd></div>
        <div><dt className="text-sm text-zinc-500">Product limit</dt><dd>{billing.tenant.maxProducts}</dd></div>
        <div><dt className="text-sm text-zinc-500">User limit</dt><dd>{billing.tenant.maxStaff}</dd></div>
      </dl>
      {!billing.configured && <p className="text-sm text-zinc-500">Online billing is not available yet. Contact the app owner to arrange your subscription.</p>}
      {!billing.canManage && <p className="text-sm text-zinc-500">Only the shop owner can purchase or manage a subscription.</p>}
      <div className="grid gap-4 sm:grid-cols-2">{billing.plans.map((plan) => <section key={plan.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">{plan.label}</h2>
        <p className="mt-2 text-xl font-semibold">{plan.amount !== null ? `${plan.currency?.toUpperCase()} ${plan.amount}` : "Pricing unavailable"}</p>
        {plan.interval && <p className="text-sm text-zinc-500">Every {plan.intervalCount === 1 ? "" : `${plan.intervalCount} `}{plan.interval}{plan.intervalCount !== 1 ? "s" : ""}</p>}
        <p className="mt-3 text-sm">Up to {plan.maxProducts} products and {plan.maxStaff} users.</p>
        <div className="mt-4"><Button disabled={!billing.configured || !billing.canManage || busy || ["active", "past_due"].includes(billing.tenant.subscriptionStatus)}
          onClick={() => checkout.mutate(plan.id)}>{checkout.isPending ? "Opening checkout…" : `Choose ${plan.label}`}</Button></div>
      </section>)}</div>
      <p className="text-sm text-zinc-500">Starting checkout purchases a paid subscription at the displayed recurring price. Existing trial access is replaced only after Stripe confirms your subscription. Use Manage billing for plan changes, payment details and cancellation.</p>
      <div className="flex flex-wrap gap-2"><Button disabled={!billing.configured || !billing.canManage || !billing.hasCustomer || busy} onClick={() => portal.mutate()}>
        {portal.isPending ? "Opening billing…" : "Manage billing"}</Button><Button variant="ghost" disabled={query.isFetching} onClick={() => { void query.refetch(); void client.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY }); }}>Refresh status</Button></div>
    </>}
  </div>;
}
