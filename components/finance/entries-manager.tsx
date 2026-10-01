"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import {
  useCanManageInventory,
  useCurrencySymbol,
} from "@/lib/client/current-tenant.ts";
import {
  expenseSchema,
  paymentSchema,
  type ExpenseResponse,
  type PaymentResponse,
} from "@/lib/finance/schemas.ts";
import type { CategoryResponse } from "@/lib/finance/categories.ts";
import type { SupplierResponse } from "@/lib/inventory/suppliers.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { Sheet, ConfirmSheet } from "@/components/ui/sheet.tsx";

type Entry = ExpenseResponse | PaymentResponse;
type Choice = { id: string; name: string; isActive: boolean };
type FormValues = {
  title?: string;
  categoryId?: string;
  supplierId?: string;
  amount: string;
  expenseDate?: string;
  paymentDate?: string;
  note: string;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";

export function EntriesManager({
  kind,
}: {
  kind: "expenses" | "supplier-payments";
}) {
  const expense = kind === "expenses";
  const canEdit = useCanManageInventory();
  const currency = useCurrencySymbol();
  const client = useQueryClient();
  const [target, setTarget] = useState<Entry | "new" | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ from: "", to: "", reference: "" });
  const params = new URLSearchParams({ page: String(page) });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.reference)
    params.set(expense ? "categoryId" : "supplierId", filters.reference);
  const list = useQuery({
    queryKey: ["finance", kind, params.toString()],
    queryFn: () =>
      apiRequest<{
        expenses?: ExpenseResponse[];
        payments?: PaymentResponse[];
        total: number;
        limit: number;
      }>(`/${kind}?${params}`),
  });
  const choices = useQuery({
    queryKey: expense ? ["finance", "categories"] : ["inventory", "suppliers"],
    queryFn: async (): Promise<{
      categories?: CategoryResponse[];
      suppliers?: SupplierResponse[];
    }> =>
      expense
        ? apiRequest("/expense-categories?status=all")
        : apiRequest("/suppliers?status=all"),
  });
  const options: Choice[] =
    choices.data?.categories ?? choices.data?.suppliers ?? [];
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["finance"] }),
      client.invalidateQueries({ queryKey: ["inventory", "suppliers"] }),
    ]);
  };
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/${kind}/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleting(null);
      setPage(1);
      await refresh();
    },
  });
  const rows = list.data?.expenses ?? list.data?.payments ?? [];
  function filter(key: keyof typeof filters, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From">
          {(props) => (
            <input
              {...props}
              type="date"
              value={filters.from}
              onChange={(e) => filter("from", e.target.value)}
            />
          )}
        </Field>
        <Field label="To">
          {(props) => (
            <input
              {...props}
              type="date"
              value={filters.to}
              onChange={(e) => filter("to", e.target.value)}
            />
          )}
        </Field>
        <Field label={expense ? "Category" : "Supplier"}>
          {(props) => (
            <select
              {...props}
              value={filters.reference}
              onChange={(e) => filter("reference", e.target.value)}
            >
              <option value="">All</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {choices.isError && (
        <p role="alert">
          {message(choices.error)}{" "}
          <Button variant="ghost" onClick={() => void choices.refetch()}>
            Retry choices
          </Button>
        </p>
      )}
      {canEdit && (
        <Button onClick={() => setTarget("new")}>
          Add {expense ? "expense" : "payment"}
        </Button>
      )}
      {list.isPending ? (
        <p role="status">Loading...</p>
      ) : list.isError ? (
        <p role="alert">
          {message(list.error)}{" "}
          <Button onClick={() => void list.refetch()}>Retry</Button>
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {list.data?.total ?? 0} records
          </p>
          {rows.length === 0 && (
            <p className="rounded-xl border border-dashed p-8 text-center">
              No records for these filters.
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => {
              const reference =
                "categoryId" in row ? row.categoryId : row.supplierId;
              const name =
                options.find((o) => o.id === reference)?.name ??
                (reference ? "Loading name..." : "Uncategorized");
              return (
                <li
                  key={row.id}
                  className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <h2 className="break-words font-semibold">
                    {"title" in row ? row.title : name}
                  </h2>
                  {expense && <p className="text-sm text-zinc-500">{name}</p>}
                  <p className="mt-2 font-medium">
                    {currency} {row.amount}
                  </p>
                  <p className="text-sm">
                    {"expenseDate" in row ? row.expenseDate : row.paymentDate}
                  </p>
                  {row.note && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-500">
                      {row.note}
                    </p>
                  )}
                  {canEdit && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="ghost" onClick={() => setTarget(row)}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setDeleting(row)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="ghost"
              disabled={
                page * (list.data?.limit ?? 20) >= (list.data?.total ?? 0)
              }
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
      {target !== null && (
        <EntryForm
          kind={kind}
          target={target}
          options={options}
          choicesReady={choices.isSuccess}
          close={() => setTarget(null)}
          refresh={refresh}
        />
      )}
      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete this record?"
        description="This permanently removes the entry and changes your finance totals. An audit record will be retained."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting)
            toast.promise(remove.mutateAsync(deleting.id), {
              loading: "Deleting...",
              success: "Deleted.",
              error: message,
            });
        }}
      />
    </div>
  );
}

function EntryForm({
  kind,
  target,
  options,
  choicesReady,
  close,
  refresh,
}: {
  kind: "expenses" | "supplier-payments";
  target: Entry | "new";
  options: Choice[];
  choicesReady: boolean;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const expense = kind === "expenses";
  const editing = target === "new" ? null : target;
  const ref = expense ? "categoryId" : "supplierId";
  const date = expense ? "expenseDate" : "paymentDate";
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const form = useForm<FormValues>({
    resolver: zodResolver(expense ? expenseSchema : paymentSchema),
    defaultValues: {
      ...(expense
        ? {
            title: editing && "title" in editing ? editing.title : "",
            categoryId:
              editing && "categoryId" in editing
                ? (editing.categoryId ?? "")
                : "",
            expenseDate:
              editing && "expenseDate" in editing ? editing.expenseDate : today,
          }
        : {
            supplierId:
              editing && "supplierId" in editing ? editing.supplierId : "",
            paymentDate:
              editing && "paymentDate" in editing ? editing.paymentDate : today,
          }),
      amount: editing?.amount ?? "",
      note: editing?.note ?? "",
    },
  });
  const originalRef =
    editing && "categoryId" in editing
      ? editing.categoryId
      : editing && "supplierId" in editing
        ? editing.supplierId
        : null;
  const save = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest(`/${kind}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST",
        body: values,
      }),
    onSuccess: async () => {
      await refresh();
      close();
    },
    onError: (error) => form.setError("root", { message: message(error) }),
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
      title={`${editing ? "Edit" : "Add"} ${expense ? "expense" : "payment"}`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => {
          toast.promise(save.mutateAsync(values), {
            loading: "Saving...",
            success: "Saved.",
            error: message,
          });
        })}
      >
        {expense && (
          <Field
            label="Title"
            required
            error={form.formState.errors.title?.message}
          >
            {(props) => (
              <input {...props} maxLength={160} {...form.register("title")} />
            )}
          </Field>
        )}
        <Field
          label={expense ? "Category" : "Supplier"}
          required={!expense}
          error={form.formState.errors[ref]?.message}
        >
          {(props) => (
            <select {...props} {...form.register(ref)} disabled={!choicesReady}>
              <option value="">
                {expense ? "Uncategorized" : "Choose supplier"}
              </option>
              {options
                .filter((o) => o.isActive || o.id === originalRef)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.isActive ? "" : " (inactive)"}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field
          label="Amount"
          required
          error={form.formState.errors.amount?.message}
        >
          {(props) => (
            <input
              {...props}
              inputMode="decimal"
              placeholder="0.00"
              {...form.register("amount")}
            />
          )}
        </Field>
        <Field
          label="Date"
          required
          error={form.formState.errors[date]?.message}
        >
          {(props) => <input {...props} type="date" {...form.register(date)} />}
        </Field>
        <Field label="Note" error={form.formState.errors.note?.message}>
          {(props) => (
            <textarea
              {...props}
              rows={3}
              maxLength={2000}
              {...form.register("note")}
            />
          )}
        </Field>
        {form.formState.errors.root && (
          <p role="alert" className="text-red-600">
            {form.formState.errors.root.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !choicesReady}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
