"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { useRequireSession, useSession, useSignOut } from "@/lib/client/use-session.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { TenantList, TenantDetail, RevenueSummary } from "@/lib/admin/types.ts";

function ErrorMessage({ error, retry }: { error: Error | null; retry: () => void }) {
  return error ? <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm"><p>{error.message}</p><Button variant="ghost" onClick={retry}>Retry</Button></div> : null;
}

function TenantInspector({ id, close }: { id: string; close: () => void }) {
  const { session } = useSession();
  const cache = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const detail = useQuery({ queryKey: ["admin", session?.user.id, "tenant", id], queryFn: () => apiRequest<TenantDetail>(`/admin/tenants/${id}`) });
  const change = useMutation({
    mutationFn: async () => {
      const tenant = detail.data!.tenant;
      return apiRequest(`/admin/tenants/${id}/access`, { method: "PATCH", body: { isActive: !tenant.isActive, expectedIsActive: tenant.isActive, reason: reason.trim() } });
    },
    onSuccess: async () => {
      setConfirm(false); setReason(""); toast.success("Workspace access updated.");
      await cache.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => { toast.error(error.message); void detail.refetch(); },
  });
  const data = detail.data;
  return <section className="rounded-xl border border-zinc-300 p-5 dark:border-zinc-700" aria-label="Workspace details">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Workspace details</h2><Button variant="ghost" onClick={close}>Close</Button></div>
    {detail.isPending && <p role="status">Loading details…</p>}
    <ErrorMessage error={detail.error} retry={() => void detail.refetch()} />
    {data && <div className="mt-4 space-y-4">
      <div className="break-words"><h3 className="font-semibold">{data.tenant.name}</h3><p className="text-sm text-zinc-500">{data.tenant.email} {data.tenant.phone && `· ${data.tenant.phone}`}</p></div>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-zinc-500">Access</dt><dd>{data.tenant.isActive ? "Active" : "Suspended"}</dd></div>
        <div><dt className="text-zinc-500">Subscription</dt><dd>{data.tenant.subscriptionPlan} · {data.tenant.subscriptionStatus}</dd></div>
        <div><dt className="text-zinc-500">Products</dt><dd>{data.usage.products} / {data.tenant.maxProducts}</dd></div>
        <div><dt className="text-zinc-500">Active users (including owner)</dt><dd>{data.usage.staff} / {data.tenant.maxStaff}</dd></div>
        <div className="col-span-2"><dt className="text-zinc-500">Subscription / trial end</dt><dd>{data.tenant.subscriptionEndsAt ?? data.tenant.trialEndsAt ?? "—"}</dd></div>
      </dl>
      <div><p className="text-sm font-medium">Owners</p>{data.owners.map((o) => <p className="break-words text-sm text-zinc-500" key={o.id}>{o.name} · {o.email}</p>)}</div>
      {!confirm ? <Button disabled={change.isPending} variant="ghost" onClick={() => setConfirm(true)}>{data.tenant.isActive ? "Suspend workspace" : "Reactivate workspace"}</Button> :
        <form className="space-y-3 rounded-lg bg-zinc-100 p-4 dark:bg-zinc-900" onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 3) change.mutate(); }}>
          <p className="text-sm">{data.tenant.isActive ? "Suspend this workspace and sign out all its users?" : "Reactivate this workspace? Users will need to sign in again."} Stripe billing continues independently.</p>
          <Field label="Reason" required hint="Recorded in the platform audit log.">{(props) => <textarea {...props} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={change.isPending || reason.trim().length < 3}>{change.isPending ? "Updating…" : "Confirm change"}</Button><Button type="button" variant="ghost" disabled={change.isPending} onClick={() => setConfirm(false)}>Cancel</Button></div>
        </form>}
    </div>}
  </section>;
}

function PlatformDashboard() {
  const { session } = useSession();
  const [search, setSearch] = useState(""), [draft, setDraft] = useState("");
  const [access, setAccess] = useState("all"), [status, setStatus] = useState("all"), [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ search, access, status, page: String(page), pageSize: "20" });
  const list = useQuery({ queryKey: ["admin", session?.user.id, "tenants", search, access, status, page], queryFn: () => apiRequest<TenantList>(`/admin/tenants?${params}`) });
  const revenue = useQuery({ queryKey: ["admin", session?.user.id, "revenue"], queryFn: () => apiRequest<RevenueSummary>("/admin/revenue"), staleTime: 60000, retry: false });
  return <div className="space-y-6">
    <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Recurring revenue</h2><Button variant="ghost" disabled={revenue.isFetching} onClick={() => void revenue.refetch()}>Refresh MRR</Button></div>
      <p className="mt-1 text-sm text-zinc-500">Base MRR before discounts, tax and fees. Annual prices are normalized to a month. Suspended workspaces remain billable until their Stripe subscription ends.</p>
      {revenue.isPending && <p role="status" className="mt-3">Loading Stripe revenue…</p>}
      <ErrorMessage error={revenue.error} retry={() => void revenue.refetch()} />
      {revenue.data && <div className="mt-4 space-y-3">
        {!revenue.data.available ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{revenue.data.message}</p> : revenue.data.currencies.length === 0 ? <p className="text-sm">No eligible active paid subscriptions. Base MRR is zero.</p> :
          <div className="grid gap-3 sm:grid-cols-2">{revenue.data.currencies.map((c) => <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-900" key={c.currency}><p className="text-xs uppercase text-zinc-500">{c.currency} · {c.subscriptions} subscriptions</p><p className="mt-1 text-2xl font-semibold">{c.mrr} <span className="text-sm font-normal">/ month</span></p><p className="text-sm text-zinc-500">ARR {c.arr}</p></div>)}</div>}
        {revenue.data.excluded > 0 && <p role="status" className="text-sm text-amber-700">{revenue.data.excluded} unsupported subscriptions excluded; total is partial.</p>}
        <p className="text-xs text-zinc-500">As of {new Date(revenue.data.asOf).toLocaleString()}</p>
      </div>}
    </section>
    <section className="space-y-4" aria-label="Tenants">
      <h2 className="text-lg font-semibold">Workspaces {list.data ? `(${list.data.total})` : ""}</h2>
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); setSearch(draft.trim()); setPage(1); }}>
        <div className="min-w-0 flex-1"><Field label="Search workspace name">{(props) => <input {...props} maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Shop name" />}</Field></div>
        <Button type="submit">Search</Button>
        <Field label="Access">{(props) => <select {...props} value={access} onChange={(e) => { setAccess(e.target.value); setPage(1); }}><option value="all">All access</option><option value="active">Active</option><option value="suspended">Suspended</option></select>}</Field>
        <Field label="Subscription">{(props) => <select {...props} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{["all", "trial", "active", "past_due", "cancelled"].map((s) => <option key={s} value={s}>{s === "all" ? "All subscriptions" : s}</option>)}</select>}</Field>
      </form>
      {list.isPending && <p role="status">Loading workspaces…</p>}
      <ErrorMessage error={list.error} retry={() => void list.refetch()} />
      {list.data && <><div className="grid gap-3 sm:grid-cols-2">{list.data.tenants.map((t) => <article key={t.id} className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><h3 className="break-words font-semibold">{t.name}</h3><p className="break-words text-sm text-zinc-500">{t.email}</p><div className="my-3 flex flex-wrap gap-2 text-xs"><span className={`rounded-full px-2 py-1 ${t.isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{t.isActive ? "Active access" : "Suspended"}</span><span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700">{t.subscriptionPlan} · {t.subscriptionStatus}</span></div><Button variant="ghost" onClick={() => setSelected(t.id)}>View & manage</Button></article>)}</div>
        {list.data.tenants.length === 0 && <p className="text-sm text-zinc-500">No workspaces match these filters.</p>}
        <div className="flex items-center justify-between gap-2"><Button variant="ghost" disabled={page === 1 || list.isFetching} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">Page {page} / {Math.max(1, Math.ceil(list.data.total / 20))}</span><Button variant="ghost" disabled={page * 20 >= list.data.total || list.isFetching} onClick={() => setPage(page + 1)}>Next</Button></div></>}
    </section>
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} title="Manage workspace" size="lg">
      {selected && <TenantInspector key={selected} id={selected} close={() => setSelected(null)} />}
    </Sheet>
  </div>;
}

export function AdminPanel() {
  const { status, session } = useRequireSession();
  const signOut = useSignOut();
  const identity = useQuery({ queryKey: ["admin", "identity", session?.user.id], queryFn: () => apiRequest<{ user: { role: string; tenantId: string | null; name: string } }>("/auth/me"), enabled: status === "authenticated", staleTime: 0 });
  if (status !== "authenticated") return <p className="p-6" role="status">Checking session…</p>;
  const platform = !identity.error && identity.data?.user.role === "super_admin" && identity.data.user.tenantId === null;
  return <div className="mx-auto w-full max-w-5xl px-4 py-6">
    <header className="mb-6 flex items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800"><div><h1 className="text-2xl font-semibold">Super Admin</h1><p className="text-sm text-zinc-500">Platform management · {identity.data?.user.name ?? session?.user.name}</p></div><Button variant="ghost" onClick={() => void signOut()}>Sign out</Button></header>
    <ErrorMessage error={identity.error} retry={() => void identity.refetch()} />
    {identity.isPending ? <p role="status">Checking platform access…</p> : platform ? <PlatformDashboard /> : !identity.error && <p role="alert">Super Admin access is required to manage the platform.</p>}
  </div>;
}
