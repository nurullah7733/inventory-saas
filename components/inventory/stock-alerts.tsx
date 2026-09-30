"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/client/api.ts";
import { errorMessage, formatCalendarDate, plural } from "@/lib/client/format.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { localToday } from "@/lib/dates.ts";
import type {
  AlertProduct,
  LowStockResponse,
  NearExpiryProduct,
  NearExpiryResponse,
} from "@/lib/inventory/stock.ts";
import { Button } from "@/components/ui/field.tsx";
import {
  Badge,
  EmptyState,
  ErrorState,
  inputClasses,
  ListSkeleton,
  Pager,
  SearchInput,
  Segmented,
  Thumb,
} from "@/components/ui/list-controls.tsx";
import type { PickedProduct } from "./product-picker.tsx";
import { AddStockSheet } from "./stock-manager.tsx";
import { WastageSheet } from "./wastage-manager.tsx";

/**
 * The two alert views from the brief: stock at or below a threshold, and
 * stock approaching (or past) its expiry date. Both act on what they show —
 * restock a low product, write off an expired one — without leaving the list.
 */

const PAGE_SIZE = 50;

function toPicked(product: AlertProduct): PickedProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    stockQty: product.stockQty,
    costPrice: product.costPrice,
    imageUrl: product.imageUrl,
    unit: product.unit,
  };
}

function AlertRow({
  product,
  badge,
  detail,
  action,
}: {
  product: AlertProduct;
  badge: React.ReactNode;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <Thumb src={product.imageUrl} name={product.name} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{product.name}</span>
          {badge}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {product.sku}
          {product.category ? ` · ${product.category.name}` : ""}
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{detail}</p>
      </div>
      {action}
    </li>
  );
}

export function LowStockList() {
  const [search, setSearch] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [page, setPage] = useState(1);
  const [restocking, setRestocking] = useState<PickedProduct | null>(null);

  const term = useDebouncedValue(search.trim(), 300);
  const threshold = useDebouncedValue(thresholdInput.trim(), 400);
  const validThreshold = /^\d{1,7}$/.test(threshold) ? threshold : "";

  const list = useQuery({
    queryKey: ["inventory", "alerts", "low-stock", { term, threshold: validThreshold, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (term) params.set("search", term);
      if (validThreshold) params.set("threshold", validThreshold);
      return apiRequest<LowStockResponse>(`/alerts/low-stock?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const data = list.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search by name or SKU"
          className="sm:flex-1"
        />
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 sm:w-48 dark:text-zinc-300">
          Threshold
          <input
            type="text"
            inputMode="numeric"
            value={thresholdInput}
            placeholder={data ? String(data.defaultThreshold) : "10"}
            onChange={(event) => {
              setThresholdInput(event.target.value);
              setPage(1);
            }}
            className={inputClasses}
          />
        </label>
      </div>
      {data ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {plural(data.total, "product")} at or below {data.threshold} in stock
          {data.threshold === data.defaultThreshold ? " (your shop's threshold)" : ""}.
        </p>
      ) : null}

      {list.isPending ? (
        <ListSkeleton label="Loading low stock…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load low stock.")}
          onRetry={() => void list.refetch()}
        />
      ) : data && data.products.length === 0 ? (
        <EmptyState>{term ? "No low-stock products match." : "Nothing is running low."}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data?.products.map((product) => (
            <AlertRow
              key={product.id}
              product={product}
              badge={
                product.stockQty === 0 ? <Badge tone="danger">Out of stock</Badge> : <Badge tone="warning">Low</Badge>
              }
              detail={`${product.stockQty} ${product.unit?.name ?? ""} left`.replace(/\s+/g, " ")}
              action={
                <Button type="button" variant="ghost" onClick={() => setRestocking(toPicked(product))}>
                  Add stock
                </Button>
              }
            />
          ))}
        </ul>
      )}

      {data ? (
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} busy={list.isFetching} onPageChange={setPage} />
      ) : null}

      <AddStockSheet
        open={restocking !== null}
        initialProduct={restocking}
        onClose={() => setRestocking(null)}
      />
    </div>
  );
}

const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
] as const;

type WindowValue = (typeof WINDOWS)[number]["value"];

function expiryBadge(product: NearExpiryProduct) {
  if (product.daysLeft < 0) return <Badge tone="danger">Expired</Badge>;
  if (product.daysLeft === 0) return <Badge tone="danger">Expires today</Badge>;
  if (product.daysLeft <= 7) return <Badge tone="warning">{plural(product.daysLeft, "day")} left</Badge>;
  return <Badge>{plural(product.daysLeft, "day")} left</Badge>;
}

export function NearExpiryList() {
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<WindowValue>("30");
  const [page, setPage] = useState(1);
  const [writingOff, setWritingOff] = useState<NearExpiryProduct | null>(null);

  const term = useDebouncedValue(search.trim(), 300);
  // The shop's own "today", not the server's — see the API route.
  const asOf = localToday();

  const list = useQuery({
    queryKey: ["inventory", "alerts", "near-expiry", { term, days, asOf, page }],
    queryFn: () => {
      const params = new URLSearchParams({ days, asOf, page: String(page), pageSize: String(PAGE_SIZE) });
      if (term) params.set("search", term);
      return apiRequest<NearExpiryResponse>(`/alerts/near-expiry?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const data = list.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search by name or SKU"
          className="sm:flex-1"
        />
        <Segmented
          value={days}
          onChange={(value) => {
            setDays(value);
            setPage(1);
          }}
          options={WINDOWS}
          label="Expiring within"
        />
      </div>
      {data ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {plural(data.total, "product")} in stock expired or expiring within {data.days} days.
        </p>
      ) : null}

      {list.isPending ? (
        <ListSkeleton label="Loading near-expiry products…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load near-expiry products.")}
          onRetry={() => void list.refetch()}
        />
      ) : data && data.products.length === 0 ? (
        <EmptyState>
          {term ? "No near-expiry products match." : `Nothing in stock expires within ${days} days.`}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data?.products.map((product) => (
            <AlertRow
              key={product.id}
              product={product}
              badge={expiryBadge(product)}
              detail={`Expiry ${formatCalendarDate(product.expiryDate)} · ${product.stockQty} in stock`}
              action={
                <Button type="button" variant="ghost" onClick={() => setWritingOff(product)}>
                  Write off
                </Button>
              }
            />
          ))}
        </ul>
      )}

      {data ? (
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} busy={list.isFetching} onPageChange={setPage} />
      ) : null}

      <WastageSheet
        open={writingOff !== null}
        initialProduct={writingOff ? toPicked(writingOff) : null}
        initialReason={writingOff && writingOff.daysLeft < 0 ? "Expired" : ""}
        onClose={() => setWritingOff(null)}
      />
    </div>
  );
}
