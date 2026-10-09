"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/client/api.ts";
import { formatDateTime } from "@/lib/client/format.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import type { ReturnList } from "@/lib/sales/types.ts";
import { EmptyState, ErrorState, ListSkeleton, Pager } from "@/components/ui/list-controls.tsx";

export function ReturnsList() {
  const [page, setPage] = useState(1);
  const currency = useCurrencySymbol();
  const query = useQuery({ queryKey: ["sales", "returns", page], queryFn: () => apiRequest<ReturnList>(`/returns?page=${page}&pageSize=20`) });
  return <div className="space-y-content">
    <Link href="/sales/invoices" className="inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-content font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Add return from an invoice</Link>
    {query.isLoading && <ListSkeleton label="Loading returns" />}
    {query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}
    {query.data?.returns.length === 0 && <EmptyState>No returns recorded yet.</EmptyState>}
    {query.data?.returns.map((entry) => <article key={entry.id} className="space-y-small rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
      <h2 className="font-semibold">{entry.productName} · {entry.quantity} returned</h2>
      <Link href={`/sales/invoices/${entry.saleId}`} className="inline-block min-h-11 break-all py-small text-sm underline">{entry.invoiceNo}</Link>
      <p>Return credit: {currency} {entry.refundAmount}</p>
      {entry.reason && <p className="whitespace-pre-wrap break-words text-sm">{entry.reason}</p>}
      <p className="text-sm text-zinc-500">{formatDateTime(entry.createdAt)}</p>
    </article>)}
    {query.data && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onPageChange={setPage} busy={query.isFetching} />}
  </div>;
}
