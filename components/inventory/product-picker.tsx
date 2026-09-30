"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { apiRequest } from "@/lib/client/api.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import type { ProductListResponse, ProductResponse } from "@/lib/inventory/products.ts";
import { Button } from "@/components/ui/field.tsx";
import { inputClasses, Thumb } from "@/components/ui/list-controls.tsx";

/**
 * Choose one product by typing part of its name or SKU. A shop can have
 * thousands of products, so this searches the server (debounced) instead of
 * loading them all into a `<select>`. Deleted products never appear.
 *
 * Rendered inline rather than as a floating popover: it lives inside a bottom
 * sheet on a phone, where a popover would fight the on-screen keyboard.
 */

/** Just what the stock forms need to know about the choice. */
export type PickedProduct = Pick<
  ProductResponse,
  "id" | "name" | "sku" | "stockQty" | "costPrice" | "imageUrl"
> & { unit: { name: string } | null };

export function ProductPicker({
  value,
  onChange,
  error,
  disabled,
}: {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 250);

  const results = useQuery({
    queryKey: ["inventory", "products", "picker", term],
    queryFn: () =>
      apiRequest<ProductListResponse>(
        `/products?pageSize=8&search=${encodeURIComponent(term)}`,
      ),
    enabled: value === null,
    staleTime: 10_000,
  });

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Product</span>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
          <Thumb src={value.imageUrl} name={value.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {value.sku} · {value.stockQty} {value.unit?.name ?? "in stock"}
              {value.unit ? " in stock" : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setSearch("");
              onChange(null);
            }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  const products = results.data?.products ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Product<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
      </label>
      <input
        id={id}
        type="search"
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or SKU"
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClasses}
      />
      <ul
        aria-label="Matching products"
        aria-busy={results.isFetching}
        className="max-h-60 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
      >
        {results.isPending ? (
          <li className="p-3 text-sm text-zinc-500">Searching…</li>
        ) : results.isError ? (
          <li className="p-3 text-sm text-red-600">Could not search products.</li>
        ) : products.length === 0 ? (
          <li className="p-3 text-sm text-zinc-500">
            {term ? "No products match." : "No products yet — add one on the Products screen."}
          </li>
        ) : (
          products.map((product) => (
            <li key={product.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(product)}
                className="flex min-h-11 w-full items-center gap-3 px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <Thumb src={product.imageUrl} name={product.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{product.name}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {product.sku} · stock {product.stockQty}
                  </span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
