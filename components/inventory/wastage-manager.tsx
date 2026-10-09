"use client";

import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { errorMessage, formatDateTime, formatMoney, plural } from "@/lib/client/format.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { optionalText, quantity } from "@/lib/inventory/fields.ts";
import {
  WASTAGE_REASONS,
  type WastageListResponse,
  type WastageResponse,
} from "@/lib/inventory/stock.ts";
import { fromCents, MONEY_PATTERN, toCents } from "@/lib/numeric.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pager,
  PrimaryAction,
} from "@/components/ui/list-controls.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { ProductPicker, type PickedProduct } from "./product-picker.tsx";

/**
 * Wastage screen: damaged / expired stock written off, newest first, with the
 * total loss. The loss is valued server-side at the product's cost price.
 */

const PAGE_SIZE = 20;

export function WastageManager() {
  const currency = useCurrencySymbol();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: ["inventory", "wastage", { page }],
    queryFn: () =>
      apiRequest<WastageListResponse>(`/wastage?page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });

  const rows = list.data?.wastage ?? [];

  return (
    <div className="flex flex-col gap-content pb-dock sm:pb-0">
      <div className="flex flex-col gap-item sm:flex-row sm:items-center">
        {list.data ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-content py-item dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total loss</p>
            <p className="text-lg font-semibold text-red-700 dark:text-red-400">
              {formatMoney(list.data.totalLoss, currency)}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {plural(list.data.total, "entry", "entries")} · shown separately from net profit
            </p>
          </div>
        ) : null}
        <div className="sm:ml-auto">
          <PrimaryAction onClick={() => setAdding(true)}>Record wastage</PrimaryAction>
        </div>
      </div>

      {list.isPending ? (
        <ListSkeleton label="Loading wastage…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load wastage.")}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState>No wastage recorded. Nothing damaged or expired so far.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-item">
          {rows.map((row) => (
            <WastageRow key={row.id} row={row} currency={currency} />
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

      <WastageSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function WastageRow({ row, currency }: { row: WastageResponse; currency: string }) {
  return (
    <li className="flex flex-col gap-tight rounded-xl border border-zinc-200 bg-white p-item shadow-sm sm:flex-row sm:items-center sm:gap-content dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {row.product?.name ?? "Unknown product"}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {row.product?.sku}
          {row.reason ? ` · ${row.reason}` : ""}
        </p>
      </div>
      <div className="flex items-baseline justify-between gap-content sm:flex-col sm:items-end sm:gap-0">
        <p className="text-base font-semibold text-red-700 dark:text-red-400">−{row.quantity}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          loss {formatMoney(row.lossAmount, currency)}
        </p>
      </div>
      <p className="text-xs text-zinc-500 sm:w-40 sm:text-right dark:text-zinc-400">
        {formatDateTime(row.createdAt)}
        {row.createdBy ? ` · ${row.createdBy.name}` : ""}
      </p>
    </li>
  );
}

const wastageFormSchema = z.object({
  quantity: quantity("Quantity"),
  reason: optionalText(200, "Reason"),
});

interface WastageForm {
  quantity: string;
  reason: string;
}

interface WastageResult {
  wastage: WastageResponse;
  product: { id: string; stockQty: number };
}

const WASTAGE_MUTATION = ["inventory", "wastage-create"] as const;

/**
 * Record wastage. `initialProduct` / `initialReason` preselect — the
 * Near-Expiry screen opens this with the product and "Expired". As with Add
 * Stock, the form remounts on every opening.
 */
export function WastageSheet({
  open,
  onClose,
  initialProduct = null,
  initialReason = "",
}: {
  open: boolean;
  onClose: () => void;
  initialProduct?: PickedProduct | null;
  initialReason?: string;
}) {
  const saving = useIsMutating({ mutationKey: WASTAGE_MUTATION }) > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title="Record wastage"
      description="Write off damaged or expired stock. The product's stock goes down by the quantity."
    >
      <WastageForm initialProduct={initialProduct} initialReason={initialReason} onClose={onClose} />
    </Sheet>
  );
}

function WastageForm({
  initialProduct,
  initialReason,
  onClose,
}: {
  initialProduct: PickedProduct | null;
  initialReason: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const currency = useCurrencySymbol();

  const [product, setProduct] = useState<PickedProduct | null>(initialProduct);
  const [productError, setProductError] = useState<string | undefined>();

  const form = useForm<WastageForm>({
    resolver: zodResolver<WastageForm>(wastageFormSchema),
    defaultValues: { quantity: "", reason: initialReason },
  });
  const qty = useWatch({ control: form.control, name: "quantity" });

  const save = useMutation({
    mutationKey: WASTAGE_MUTATION,
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<WastageResult>("/wastage", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        if (error.details.productId) setProductError(error.details.productId[0]);
        for (const field of ["quantity", "reason"] as const) {
          const message = error.details[field]?.[0];
          if (message) form.setError(field, { type: "server", message });
        }
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!product) {
      setProductError("Choose a product.");
      return;
    }
    if (Number(values.quantity) > product.stockQty) {
      form.setError("quantity", { type: "manual", message: `Only ${product.stockQty} in stock.` });
      return;
    }
    toast.promise(save.mutateAsync({ productId: product.id, ...values }), {
      loading: "Recording wastage…",
      success: (result: WastageResult) =>
        `Wrote off ${result.wastage.quantity} × ${product.name} (loss ${formatMoney(result.wastage.lossAmount, currency)}).`,
      error: (error: unknown) => errorMessage(error, "Could not record wastage."),
    });
  });

  // Preview of what the server will compute: quantity × current cost price.
  const estimate =
    product && /^\d+$/.test(qty ?? "") && MONEY_PATTERN.test(product.costPrice)
      ? fromCents(toCents(product.costPrice) * BigInt(qty))
      : null;

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-content" noValidate>
      <ProductPicker
        value={product}
        error={productError}
        disabled={save.isPending}
        onChange={(picked) => {
          setProduct(picked);
          setProductError(undefined);
        }}
      />

      <Field
        label="Quantity"
        error={errors.quantity?.message}
        hint={
          product
            ? `${product.stockQty} in stock${estimate ? ` · loss ≈ ${formatMoney(estimate, currency)}` : ""}`
            : undefined
        }
        required
      >
        {(props) => (
          <input {...props} type="text" inputMode="numeric" autoComplete="off" placeholder="0" {...form.register("quantity")} />
        )}
      </Field>

      <div className="flex flex-col gap-compact">
        <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-small">
          {WASTAGE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => form.setValue("reason", reason, { shouldDirty: true })}
              className="min-h-9 rounded-full border border-zinc-300 px-item text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {reason}
            </button>
          ))}
        </div>
        <Field label="Reason" error={errors.reason?.message}>
          {(props) => (
            <input {...props} type="text" maxLength={200} placeholder="e.g. Expired, torn box" {...form.register("reason")} />
          )}
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Write off"}
        </Button>
      </div>
    </form>
  );
}
