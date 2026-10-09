"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { errorMessage, formatDateTime, formatMoney } from "@/lib/client/format.ts";
import { localToday, addDays } from "@/lib/dates.ts";
import { fromCents, toCents } from "@/lib/numeric.ts";
import type { PurchaseReceipt, PurchaseReceiptList, PurchaseReturnList } from "@/lib/inventory/purchase-returns.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { EmptyState, ErrorState, ListSkeleton, Pager } from "@/components/ui/list-controls.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

export function PurchaseReturnsManager() {
  const { session } = useSession();
  const currency = useCurrencySymbol();
  const [tab, setTab] = useState<"purchases" | "returns">("purchases");
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [selected, setSelected] = useState<PurchaseReceipt | null>(null);
  const canWrite = session?.user.role === "shop_owner" || session?.user.role === "manager";
  const datesValid = !from || !to || from <= to;
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (from) params.set("from", `${from}T00:00:00+06:00`);
  if (to) params.set("to", `${addDays(to, 1)}T00:00:00+06:00`);
  const purchases = useQuery({ queryKey: ["inventory", "purchase-receipts", params.toString()],
    queryFn: () => apiRequest<PurchaseReceiptList>(`/purchase-returns/purchases?${params}`), enabled: tab === "purchases" && datesValid });
  const history = useQuery({ queryKey: ["inventory", "purchase-returns", params.toString()],
    queryFn: () => apiRequest<PurchaseReturnList>(`/purchase-returns?${params}`), enabled: tab === "returns" && datesValid });
  const query = tab === "purchases" ? purchases : history;
  return <div className="space-y-content">
    <div className="flex flex-wrap gap-item">
      <Button variant={tab === "purchases" ? "primary" : "ghost"} onClick={() => { setTab("purchases"); setPage(1); }}>Purchase entries</Button>
      <Button variant={tab === "returns" ? "primary" : "ghost"} onClick={() => { setTab("returns"); setPage(1); }}>Return history</Button>
      <Link href="/inventory/stock" className="inline-flex min-h-11 items-center underline">Receive stock</Link>
    </div>
    <div className="grid gap-item sm:grid-cols-2">
      <Field label="From date">{(props) => <input {...props} type="date" value={from} max={localToday()} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />}</Field>
      <Field label="To date">{(props) => <input {...props} type="date" value={to} max={localToday()} onChange={(e) => { setTo(e.target.value); setPage(1); }} />}</Field>
    </div>
    {!datesValid && <p role="alert" className="text-sm text-red-600">End date must be on or after start date.</p>}
    {datesValid && query.isLoading && <ListSkeleton label="Loading purchase returns" />}
    {datesValid && query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}
    {datesValid && tab === "purchases" && purchases.data?.purchases.length === 0 && <EmptyState>No supplier purchases in this range. Receive stock with a supplier first.</EmptyState>}
    {datesValid && tab === "purchases" && purchases.data?.purchases.map((entry) => <article key={entry.id} className="space-y-small rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
      <h2 className="font-semibold">{entry.product?.name} · {entry.supplier?.name}</h2>
      <p className="text-sm text-zinc-500">{entry.product?.sku} · {formatDateTime(entry.createdAt)}</p>
      {entry.note && <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
      <p className="text-sm">Received: {entry.quantity} · Returned: {entry.returnedQuantity} · Remaining: {entry.returnableQuantity} · On-hand: {entry.stockQty}</p>
      <p className="text-sm">Original unit cost: {formatMoney(entry.unitCost ?? "0.00", currency)}</p>
      {canWrite && <Button disabled={!entry.productAvailable || entry.returnableQuantity === 0 || entry.stockQty === 0} onClick={() => setSelected(entry)}>Return to supplier</Button>}
      {!entry.productAvailable && <p className="text-sm text-zinc-500">Restore the product before returning stock.</p>}
    </article>)}
    {datesValid && tab === "returns" && history.data?.returns.length === 0 && <EmptyState>No purchase returns recorded in this range.</EmptyState>}
    {datesValid && tab === "returns" && history.data?.returns.map((entry) => <article key={entry.id} className="space-y-small rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
      <h2 className="font-semibold">{entry.product?.name} · {entry.supplier?.name}</h2>
      <p>Returned: {entry.returnedQuantity} · Credit: {formatMoney(entry.creditAmount, currency)}</p>
      {entry.note && <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
      <p className="text-sm text-zinc-500">{formatDateTime(entry.createdAt)} · {entry.createdBy?.name}</p>
    </article>)}
    {datesValid && query.data && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} busy={query.isFetching} onPageChange={setPage} />}
    {selected && <ReturnPurchaseSheet key={selected.id} purchase={selected} currency={currency} onClose={() => setSelected(null)} />}
  </div>;
}

function ReturnPurchaseSheet({ purchase, currency, onClose }: { purchase: PurchaseReceipt; currency: string; onClose: () => void }) {
  const client = useQueryClient();
  const [quantity, setQuantity] = useState("1"), [reason, setReason] = useState("");
  // Keep the exact payload on a failed request so a lost response can be retried
  // with the same ID, without returning the goods a second time.
  const [retry, setRetry] = useState<{ requestId: string; sourceMovementId: string; quantity: number; reason: string | null } | null>(null);
  const max = Math.min(purchase.returnableQuantity, purchase.stockQty);
  const count = Number(quantity), valid = Number.isInteger(count) && count >= 1 && count <= max && reason.trim().length <= 500;
  const mutation = useMutation({ mutationFn: (body: NonNullable<typeof retry>) => apiRequest("/purchase-returns", { method: "POST", body }),
    onSuccess: async () => {
      toast.success("Purchase return recorded. Stock and supplier payable updated.");
      await Promise.all([client.invalidateQueries({ queryKey: ["inventory"] }), client.invalidateQueries({ queryKey: ["reports"] })]);
      onClose();
    }, onError: (error) => {
      if (error instanceof ApiClientError && [400, 401, 403, 404, 409, 422].includes(error.status)) setRetry(null);
      toast.error(errorMessage(error, "Could not record purchase return."));
    } });
  return <Sheet open title="Return to supplier" description={`${purchase.product?.name} · ${purchase.supplier?.name}`} onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <form className="space-y-content" onSubmit={(event) => {
      event.preventDefault(); if (!retry && !valid) return;
      const body = retry ?? { requestId: crypto.randomUUID(), sourceMovementId: purchase.id, quantity: count, reason: reason.trim() || null };
      setRetry(body); mutation.mutate(body);
    }}>
      <p className="text-sm">Maximum return: {max}. Credit uses the original purchase unit cost and reduces supplier payable.</p>
      <Field label="Return quantity" required>{(props) => <input {...props} type="number" min="1" max={max} step="1" value={quantity} disabled={mutation.isPending || !!retry} onChange={(e) => setQuantity(e.target.value)} />}</Field>
      <Field label="Reason">{(props) => <textarea {...props} maxLength={500} value={reason} disabled={mutation.isPending || !!retry} onChange={(e) => setReason(e.target.value)} />}</Field>
      <p>Return credit: {valid ? formatMoney(fromCents(toCents(purchase.unitCost ?? "0.00") * BigInt(count)), currency) : "—"}</p>
      {mutation.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(mutation.error, "Could not record purchase return.")}</p>}
      <div className="flex justify-end gap-small">
        <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={onClose}>Close</Button>
        <Button type="submit" disabled={mutation.isPending || (!retry && !valid)}>{mutation.isPending ? "Saving…" : retry ? "Retry same return" : "Confirm return"}</Button>
      </div>
    </form>
  </Sheet>;
}
