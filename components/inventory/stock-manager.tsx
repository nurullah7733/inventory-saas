"use client";

import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { errorMessage, formatDateTime, formatMoney } from "@/lib/client/format.ts";
import { isCalendarDate, localToday } from "@/lib/dates.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { money, optionalRef, optionalText, quantity } from "@/lib/inventory/fields.ts";
import type {
  StockMovementListResponse,
  StockMovementResponse,
} from "@/lib/inventory/stock.ts";
import type { SupplierResponse } from "@/lib/inventory/suppliers.ts";
import { fromCents, MONEY_PATTERN, toCents } from "@/lib/numeric.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import {
  EmptyState,
  ErrorState,
  inputClasses,
  ListSkeleton,
  Pager,
  PrimaryAction,
} from "@/components/ui/list-controls.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { ProductPicker, type PickedProduct } from "./product-picker.tsx";
import { SUPPLIERS_QUERY_KEY } from "./suppliers-manager.tsx";

/**
 * Stocks screen: every stock-in entry, newest first, and the Add Stock form.
 * Any shop role can receive stock; each entry records who did it.
 */

const PAGE_SIZE = 20;

export function StockManager() {
  const currency = useCurrencySymbol();
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState("");
  const [adding, setAdding] = useState(false);

  const suppliers = useSuppliers();

  const list = useQuery({
    queryKey: ["inventory", "stock-movements", { type: "in", supplierId, page }],
    queryFn: () => {
      const params = new URLSearchParams({ type: "in", page: String(page), pageSize: String(PAGE_SIZE) });
      if (supplierId) params.set("supplierId", supplierId);
      return apiRequest<StockMovementListResponse>(`/stock-movements?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const movements = list.data?.movements ?? [];

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          aria-label="Filter by supplier"
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setPage(1);
          }}
          className={`${inputClasses} sm:max-w-xs`}
        >
          <option value="">All suppliers</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <div className="sm:ml-auto">
          <PrimaryAction onClick={() => setAdding(true)}>Add stock</PrimaryAction>
        </div>
      </div>

      {list.isPending ? (
        <ListSkeleton label="Loading stock entries…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load stock entries.")}
          onRetry={() => void list.refetch()}
        />
      ) : movements.length === 0 ? (
        <EmptyState>
          {supplierId ? "No stock entries from this supplier yet." : "No stock received yet. Add your first delivery."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {movements.map((movement) => (
            <MovementRow key={movement.id} movement={movement} currency={currency} />
          ))}
        </ul>
      )}

      {list.data ? (
        <Pager
          page={list.data.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          busy={list.isFetching}
          onPageChange={setPage}
        />
      ) : null}

      <AddStockSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function MovementRow({
  movement,
  currency,
}: {
  movement: StockMovementResponse;
  currency: string;
}) {
  const total =
    movement.unitCost && MONEY_PATTERN.test(movement.unitCost)
      ? fromCents(toCents(movement.unitCost) * BigInt(Math.abs(movement.quantity)))
      : null;

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:gap-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {movement.product?.name ?? "Unknown product"}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {movement.product?.sku}
          {movement.supplier ? ` · from ${movement.supplier.name}` : ""}
        </p>
        {movement.note ? (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{movement.note}</p>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:items-end sm:gap-0">
        <p className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
          +{movement.quantity}
        </p>
        {movement.unitCost ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            @ {formatMoney(movement.unitCost, currency)}
            {total ? ` = ${formatMoney(total, currency)}` : ""}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-zinc-500 sm:w-40 sm:text-right dark:text-zinc-400">
        {formatDateTime(movement.createdAt)}
        {movement.createdBy ? ` · ${movement.createdBy.name}` : ""}
      </p>
    </li>
  );
}

function useSuppliers() {
  return useQuery({
    queryKey: SUPPLIERS_QUERY_KEY,
    queryFn: () => apiRequest<{ suppliers: SupplierResponse[] }>("/suppliers?status=all"),
    select: (data) => data.suppliers,
  });
}

const stockFormSchema = z.object({
  supplierId: optionalRef("supplier"),
  quantity: quantity("Quantity"),
  unitCost: money("Unit cost"),
  date: z
    .string()
    .refine(isCalendarDate, "Choose a date.")
    .refine((value) => value <= localToday(), "The date cannot be in the future."),
  note: optionalText(500, "Note"),
  updateCostPrice: z.boolean(),
});

interface StockForm {
  supplierId: string;
  quantity: string;
  unitCost: string;
  date: string;
  note: string;
  updateCostPrice: boolean;
}

interface StockInResult {
  movement: StockMovementResponse;
  product: { id: string; stockQty: number };
}

const STOCK_IN_MUTATION = ["inventory", "stock-in"] as const;

/**
 * Add Stock. `initialProduct` preselects the product — used by the Products
 * and Low Stock screens' "Add stock" buttons.
 *
 * The form is its own component because `Sheet` only mounts its children
 * while open: every opening starts from a blank form, not the last entry.
 */
export function AddStockSheet({
  open,
  onClose,
  initialProduct = null,
}: {
  open: boolean;
  onClose: () => void;
  initialProduct?: PickedProduct | null;
}) {
  const saving = useIsMutating({ mutationKey: STOCK_IN_MUTATION }) > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title="Add stock"
      description="Record goods received. The product's stock goes up by the quantity."
    >
      <AddStockForm initialProduct={initialProduct} onClose={onClose} />
    </Sheet>
  );
}

function AddStockForm({
  initialProduct,
  onClose,
}: {
  initialProduct: PickedProduct | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const activeSuppliers = (suppliers.data ?? []).filter((supplier) => supplier.isActive);

  const [product, setProduct] = useState<PickedProduct | null>(initialProduct);
  const [productError, setProductError] = useState<string | undefined>();

  const form = useForm<StockForm>({
    resolver: zodResolver<StockForm>(stockFormSchema),
    defaultValues: {
      supplierId: "",
      quantity: "",
      unitCost: initialProduct?.costPrice ?? "",
      date: localToday(),
      note: "",
      updateCostPrice: false,
    },
  });

  const save = useMutation({
    mutationKey: STOCK_IN_MUTATION,
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<StockInResult>("/stock-movements", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        if (error.details.productId) setProductError(error.details.productId[0]);
        for (const field of ["supplierId", "quantity", "unitCost", "note"] as const) {
          const message = error.details[field]?.[0];
          if (message) form.setError(field, { type: "server", message });
        }
        if (error.details.receivedAt) {
          form.setError("date", { type: "server", message: error.details.receivedAt[0] });
        }
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!product) {
      setProductError("Choose a product.");
      return;
    }
    // Today → let the server stamp the exact time. An earlier day → noon
    // local time on that day, so no timezone shift can move it across midnight.
    const receivedAt =
      values.date === localToday() ? null : new Date(`${values.date}T12:00:00`).toISOString();

    const body = {
      productId: product.id,
      supplierId: values.supplierId || null,
      quantity: values.quantity,
      unitCost: values.unitCost,
      receivedAt,
      note: values.note,
      updateCostPrice: values.updateCostPrice,
    };
    toast.promise(save.mutateAsync(body), {
      loading: "Adding stock…",
      success: (result: StockInResult) =>
        `Added ${result.movement.quantity} × ${product.name}. Now ${result.product.stockQty} in stock.`,
      error: (error: unknown) => errorMessage(error, "Could not add stock."),
    });
  });

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <ProductPicker
        value={product}
        error={productError}
        disabled={save.isPending}
        onChange={(picked) => {
          setProduct(picked);
          setProductError(undefined);
          // Suggest the product's current cost unless the user typed one.
          if (picked && !form.getFieldState("unitCost").isDirty) {
            form.setValue("unitCost", picked.costPrice);
          }
        }}
      />

      <Field label="Supplier" error={errors.supplierId?.message} hint="Optional.">
        {(props) => (
          <select {...props} {...form.register("supplierId")}>
            <option value="">No supplier</option>
            {activeSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" error={errors.quantity?.message} required>
          {(props) => (
            <input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="0" {...form.register("quantity")} />
          )}
        </Field>
        <Field label="Unit cost" error={errors.unitCost?.message} required>
          {(props) => (
            <input {...props} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" {...form.register("unitCost")} />
          )}
        </Field>
      </div>

      <Field label="Date received" error={errors.date?.message} required>
        {(props) => <input {...props} type="date" max={localToday()} {...form.register("date")} />}
      </Field>

      <Field label="Note" error={errors.note?.message} hint="e.g. invoice number.">
        {(props) => <input {...props} type="text" maxLength={500} {...form.register("note")} />}
      </Field>

      <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" className="h-5 w-5" {...form.register("updateCostPrice")} />
        Also set the product&apos;s cost price to this unit cost
      </label>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Add stock"}
        </Button>
      </div>
    </form>
  );
}
