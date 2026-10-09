"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/client/api.ts";
import { formatDateTime } from "@/lib/client/format.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import type { InvoiceList as InvoiceListData } from "@/lib/sales/types.ts";
import { EmptyState, ErrorState, ListSkeleton, Pager, SearchInput } from "@/components/ui/list-controls.tsx";
import { Field } from "@/components/ui/field.tsx";

export function InvoiceList({ status }: { status: "draft" | "completed" }) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search.trim(), 250);
  const currency = useCurrencySymbol();
  const params = new URLSearchParams({ status, search: term, page: String(page), pageSize: "20" });
  if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    params.set("to", end.toISOString());
  }
  const query = useQuery({ queryKey: ["sales", "invoices", params.toString()], queryFn: () => apiRequest<InvoiceListData>(`/invoices?${params}`) });
  return <div className="space-y-content">
    <Link href="/sales/create" className="inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-content font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create invoice</Link>
    <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} label="Search invoice number" />
    <div className="grid gap-item sm:grid-cols-2">
      <Field label="From date">{(props) => <input {...props} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />}</Field>
      <Field label="Through date">{(props) => <input {...props} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />}</Field>
    </div>
    {query.isLoading && <ListSkeleton label="Loading invoices" />}
    {query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}
    {query.data?.invoices.length === 0 && <EmptyState>No {status === "draft" ? "drafts" : "invoices"} found.</EmptyState>}
    {query.data?.invoices.map((invoice) => <Link key={invoice.id} href={`/sales/invoices/${invoice.id}`} className="block space-y-small rounded-xl border border-zinc-200 p-content hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <div className="flex flex-col justify-between gap-small sm:flex-row"><p className="break-all font-semibold">{invoice.invoiceNo}</p><p className="shrink-0 font-semibold">{currency} {invoice.totalAmount}</p></div>
      <p>{invoice.customer?.name ?? "Walk-in customer"}</p>
      <p className="text-sm text-zinc-500">{formatDateTime(invoice.createdAt)} · {status === "draft" ? "Open to edit or complete" : `Due: ${currency} ${invoice.dueAmount} · Return credit: ${currency} ${invoice.creditAmount}`}</p>
    </Link>)}
    {query.data && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onPageChange={setPage} busy={query.isFetching} />}
  </div>;
}
