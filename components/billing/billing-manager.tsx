"use client";

import { PlatformLogo } from "@/components/ui/platform-logo.tsx";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { CURRENT_TENANT_QUERY_KEY } from "@/lib/client/current-tenant.ts";
import { Button } from "@/components/ui/field.tsx";
import type {
  BillingInterval,
  BillingSummary,
  PaidPlan,
} from "@/lib/billing/types.ts";

export function BillingManager() {
  const params = useSearchParams(),
    client = useQueryClient();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const returning = params.get("checkout") === "success";
  const query = useQuery({
    queryKey: ["billing"],
    queryFn: () => apiRequest<{ billing: BillingSummary }>("/billing"),
  });
  useEffect(() => {
    if (returning)
      void client.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
  }, [returning, client, query.dataUpdatedAt]);
  const checkout = useMutation({
    mutationFn: (plan: PaidPlan) =>
      apiRequest<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: { plan, interval },
      }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(error.message),
  });
  const check = useMutation({
    mutationFn: (paymentId: string) =>
      apiRequest<{ status: string }>("/billing/check", {
        method: "POST",
        body: { paymentId },
      }),
    onSuccess: ({ status }) => {
      if (status === "pending")
        toast.info(
          "This checkout is not paid yet. Your current subscription has not changed.",
        );
      else
        toast.success(
          status === "success"
            ? "Payment verified. Your plan is active."
            : "Payment was cancelled or expired. You can pay again.",
        );
      void query.refetch();
      void client.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const billing = query.data?.billing;
  const discard = useMutation({
    mutationFn: (paymentId: string) =>
      apiRequest<{ status: string }>("/billing/discard", {
        method: "POST",
        body: { paymentId },
      }),
    onSuccess: ({ status }) => {
      toast.success(
        status === "success"
          ? "Payment was already completed. Your plan is active."
          : "Unpaid checkout discarded. Your current subscription has not changed.",
      );
      void query.refetch();
      void client.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const busy = checkout.isPending || check.isPending || discard.isPending;
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleDateString() : "—";
  return (
    <div className="ui-stack">
      <PlatformLogo />
      <div>
        <h1 className="text-xl font-semibold">Subscription & billing</h1>
        <p className="mt-tight text-sm text-zinc-500">
          Pay with bKash to activate or renew your shop subscription.
        </p>
      </div>
      {returning && (
        <p role="status" className="rounded-xl border p-content text-sm">
          Payment processing finished. Your current subscription status is shown
          below.
        </p>
      )}
      {params.get("checkout") === "pending" && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          Payment confirmation is pending. Check payment status before paying
          again.
        </p>
      )}
      {params.get("checkout") === "cancelled" && (
        <p role="status" className="text-sm text-zinc-500">
          Checkout was cancelled. You can choose a plan again.
        </p>
      )}
      {query.isPending && <p role="status">Loading billing…</p>}
      {query.isError && (
        <div role="alert">
          <p className="text-red-600">{query.error.message}</p>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {billing && (
        <>
          <dl className="grid grid-cols-2 gap-content rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
            <div>
              <dt className="text-sm text-zinc-500">Current plan</dt>
              <dd className="mt-tight font-semibold capitalize">
                {billing.tenant.subscriptionPlan}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Status</dt>
              <dd className="mt-tight font-semibold capitalize">
                {billing.tenant.subscriptionStatus.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Trial ends</dt>
              <dd>{date(billing.tenant.trialEndsAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">
                Subscription period ends
              </dt>
              <dd>{date(billing.tenant.subscriptionEndsAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Product limit</dt>
              <dd>{billing.tenant.maxProducts}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">User limit</dt>
              <dd>{billing.tenant.maxStaff}</dd>
            </div>
          </dl>
          {!billing.configured && (
            <p className="text-sm text-zinc-500">
              Online billing is not available yet. Contact the app owner to
              arrange your subscription.
            </p>
          )}
          {!billing.canManage && (
            <p className="text-sm text-zinc-500">
              Only the shop owner can purchase or manage a subscription.
            </p>
          )}
          <div className="ui-panel" role="group" aria-label="Billing period">
            <div className="flex flex-wrap justify-center gap-small pb-content">
              <Button
                variant={interval === "monthly" ? "primary" : "ghost"}
                aria-pressed={interval === "monthly"}
                disabled={busy}
                onClick={() => setInterval("monthly")}
              >
                Monthly
              </Button>
              <Button
                variant={interval === "yearly" ? "primary" : "ghost"}
                aria-pressed={interval === "yearly"}
                disabled={busy}
                onClick={() => setInterval("yearly")}
              >
                Yearly
              </Button>
            </div>

            <div className="ui-card-grid sm:grid-cols-2">
              {billing.plans.map((plan) => (
                <section key={plan.id} className="ui-panel">
                  <h2 className="text-lg font-semibold">{plan.label}</h2>
                  <p className="mt-small text-xl font-semibold">
                    {(interval === "yearly"
                      ? plan.yearlyAmount
                      : plan.amount) !== null
                      ? `${plan.currency?.toUpperCase()} ${interval === "yearly" ? plan.yearlyAmount : plan.amount}`
                      : "Pricing unavailable"}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {interval === "yearly"
                      ? "One year of access"
                      : "One month of access"}
                  </p>
                  <p className="mt-item text-sm">
                    Up to {plan.maxProducts} products and {plan.maxStaff} users.
                  </p>
                  <div className="mt-content">
                    <Button
                      disabled={
                        !billing.configured ||
                        !billing.canManage ||
                        busy ||
                        !!billing.pendingPaymentId ||
                        (billing.tenant.subscriptionPlan !== plan.id &&
                          !!billing.tenant.subscriptionEndsAt &&
                          new Date(billing.tenant.subscriptionEndsAt) >
                            new Date())
                      }
                      onClick={() => checkout.mutate(plan.id)}
                    >
                      {checkout.isPending
                        ? "Opening checkout…"
                        : billing.tenant.subscriptionPlan === plan.id &&
                            billing.tenant.subscriptionStatus === "active"
                          ? `Renew ${plan.label} with bKash`
                          : `Pay with bKash: ${plan.label}`}
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          </div>
          <p className="text-sm text-zinc-500">
            Each payment buys one calendar month or year, as selected. Renewing
            your current plan adds the selected period after its expiry.
            Payments do not renew automatically. You can change plans after your
            current plan expires.
          </p>
          <div className="flex flex-wrap gap-small">
            {billing.pendingCheckoutUrl && (
              <Button
                disabled={!billing.configured || !billing.canManage || busy}
                onClick={() =>
                  window.location.assign(billing.pendingCheckoutUrl!)
                }
              >
                Continue bKash payment
              </Button>
            )}
            {billing.pendingPaymentId && (
              <Button
                disabled={!billing.configured || !billing.canManage || busy}
                onClick={() => check.mutate(billing.pendingPaymentId!)}
              >
                {check.isPending
                  ? "Checking payment..."
                  : "Check payment status"}
              </Button>
            )}
            {billing.pendingPaymentId && (
              <Button
                variant="ghost"
                disabled={!billing.configured || !billing.canManage || busy}
                onClick={() => discard.mutate(billing.pendingPaymentId!)}
              >
                {discard.isPending
                  ? "Checking checkout..."
                  : "Discard unpaid checkout"}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
                void client.invalidateQueries({
                  queryKey: CURRENT_TENANT_QUERY_KEY,
                });
              }}
            >
              Refresh status
            </Button>
          </div>
          {billing.pendingPaymentId && (
            <p className="text-sm text-zinc-500">
              If the bKash page no longer opens, discard the unpaid checkout
              before starting again. Completed or uncertain payments cannot be
              discarded.
            </p>
          )}
        </>
      )}
    </div>
  );
}
