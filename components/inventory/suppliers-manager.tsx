"use client";

import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useCanManageInventory } from "@/lib/client/current-tenant.ts";
import { errorMessage, plural } from "@/lib/client/format.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { supplierSchema, type SupplierResponse } from "@/lib/inventory/suppliers.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PrimaryAction,
  SearchInput,
  Segmented,
} from "@/components/ui/list-controls.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

/**
 * Suppliers screen. A shop has tens of suppliers, not thousands, so the whole
 * list is fetched once and searched / filtered on the client.
 */

export const SUPPLIERS_QUERY_KEY = ["inventory", "suppliers"] as const;

interface ListEnvelope {
  suppliers: SupplierResponse[];
}

interface SupplierEnvelope {
  supplier: SupplierResponse;
}

type StatusFilter = "active" | "inactive" | "all";

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
] as const;

function hasHistory(supplier: SupplierResponse): boolean {
  return supplier.stockEntryCount > 0 || supplier.paymentCount > 0;
}

export function SuppliersManager() {
  const queryClient = useQueryClient();
  const canEdit = useCanManageInventory();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [formTarget, setFormTarget] = useState<SupplierResponse | "new" | null>(null);
  const [deleting, setDeleting] = useState<SupplierResponse | null>(null);

  const list = useQuery({
    queryKey: SUPPLIERS_QUERY_KEY,
    queryFn: () => apiRequest<ListEnvelope>("/suppliers?status=all"),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest<SupplierEnvelope>(`/suppliers/${id}`, {
        method: "PATCH",
        body: { isActive },
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY }),
  });

  const remove = useMutation({
    mutationFn: (supplier: SupplierResponse) =>
      apiRequest<{ deleted: { id: string; name: string } }>(`/suppliers/${supplier.id}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });

  function toggleActive(supplier: SupplierResponse) {
    const isActive = !supplier.isActive;
    toast.promise(setActive.mutateAsync({ id: supplier.id, isActive }), {
      loading: isActive ? "Reactivating…" : "Marking inactive…",
      success: isActive
        ? `"${supplier.name}" is active again.`
        : `"${supplier.name}" is inactive. It no longer appears when adding stock.`,
      error: (error: unknown) => errorMessage(error, "Could not update."),
    });
  }

  const all = list.data?.suppliers ?? [];
  const needle = search.trim().toLowerCase();
  const visible = all.filter(
    (supplier) =>
      (filter === "all" || (filter === "active" ? supplier.isActive : !supplier.isActive)) &&
      (needle === "" ||
        supplier.name.toLowerCase().includes(needle) ||
        (supplier.phone ?? "").includes(needle)),
  );

  return (
    <div className="flex flex-col gap-content pb-dock sm:pb-0">
      <div className="flex flex-col gap-item sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Search by name or phone"
          className="sm:flex-1"
        />
        <Segmented value={filter} onChange={setFilter} options={FILTERS} label="Filter by status" />
        {canEdit ? (
          <PrimaryAction onClick={() => setFormTarget("new")}>Add supplier</PrimaryAction>
        ) : null}
      </div>

      {list.isPending ? (
        <ListSkeleton label="Loading suppliers…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load suppliers.")}
          onRetry={() => void list.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState>
          {all.length === 0
            ? canEdit
              ? "No suppliers yet. Add the wholesalers you buy stock from."
              : "No suppliers yet."
            : "No suppliers match this search or filter."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-item sm:grid-cols-2">
          {visible.map((supplier) => (
            <li
              key={supplier.id}
              className="flex flex-col gap-small rounded-xl border border-zinc-200 bg-white p-item shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-small">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {supplier.name}
                  </p>
                  {supplier.phone ? (
                    <a
                      href={`tel:${supplier.phone.replace(/\s/g, "")}`}
                      className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                    >
                      {supplier.phone}
                    </a>
                  ) : null}
                  {supplier.address ? (
                    <p className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {supplier.address}
                    </p>
                  ) : null}
                </div>
                {!supplier.isActive ? <Badge>Inactive</Badge> : null}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {plural(supplier.stockEntryCount, "stock entry", "stock entries")}
                {supplier.paymentCount > 0 ? ` · ${plural(supplier.paymentCount, "payment")}` : ""}
              </p>

              {canEdit ? (
                <div className="flex flex-wrap gap-small">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Edit ${supplier.name}`}
                    onClick={() => setFormTarget(supplier)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`${supplier.isActive ? "Mark inactive" : "Reactivate"} ${supplier.name}`}
                    disabled={setActive.isPending}
                    onClick={() => toggleActive(supplier)}
                  >
                    {supplier.isActive ? "Mark inactive" : "Reactivate"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Delete ${supplier.name}`}
                    className="text-red-600 dark:text-red-400"
                    onClick={() => {
                      if (hasHistory(supplier)) {
                        toast.error(
                          `"${supplier.name}" has purchase history, so it cannot be deleted. Mark it inactive instead.`,
                        );
                        return;
                      }
                      setDeleting(supplier);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <SupplierFormSheet target={formTarget} onClose={() => setFormTarget(null)} />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete supplier?"
        description={
          deleting ? `"${deleting.name}" will be permanently deleted. This cannot be undone.` : ""
        }
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          toast.promise(remove.mutateAsync(deleting), {
            loading: "Deleting…",
            success: (result: { deleted: { name: string } }) => `Deleted "${result.deleted.name}".`,
            error: (error: unknown) => errorMessage(error, "Could not delete."),
          });
        }}
      />
    </div>
  );
}

interface SupplierForm {
  name: string;
  phone: string;
  address: string;
}

const FORM_FIELDS = ["name", "phone", "address"] as const;

const SAVE_SUPPLIER_MUTATION = ["inventory", "supplier-save"] as const;

/** The form remounts on every opening (see `AddStockSheet`), so "Add" starts blank. */
function SupplierFormSheet({
  target,
  onClose,
}: {
  target: SupplierResponse | "new" | null;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: SAVE_SUPPLIER_MUTATION }) > 0;
  const editing = target !== null && target !== "new" ? target : null;
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={editing ? "Edit supplier" : "Add supplier"}
    >
      <SupplierFormBody editing={editing} onClose={onClose} />
    </Sheet>
  );
}

function SupplierFormBody({
  editing,
  onClose,
}: {
  editing: SupplierResponse | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<SupplierForm>({
    resolver: zodResolver<SupplierForm>(supplierSchema),
    defaultValues: {
      name: editing?.name ?? "",
      phone: editing?.phone ?? "",
      address: editing?.address ?? "",
    },
  });

  const save = useMutation({
    mutationKey: SAVE_SUPPLIER_MUTATION,
    mutationFn: (values: SupplierForm) =>
      editing
        ? apiRequest<SupplierEnvelope>(`/suppliers/${editing.id}`, { method: "PATCH", body: values })
        : apiRequest<SupplierEnvelope>("/suppliers", { method: "POST", body: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        for (const field of FORM_FIELDS) {
          const message = error.details[field]?.[0];
          if (message) form.setError(field, { type: "server", message });
        }
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    toast.promise(save.mutateAsync(values), {
      loading: editing ? "Saving supplier…" : "Adding supplier…",
      success: (result: SupplierEnvelope) =>
        editing ? `Saved "${result.supplier.name}".` : `Added "${result.supplier.name}".`,
      error: (error: unknown) => errorMessage(error, "Could not save."),
    });
  });

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-content" noValidate>
      <Field label="Name" error={errors.name?.message} required>
        {(props) => (
          <input
            {...props}
            type="text"
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Rahim Traders"
            {...form.register("name")}
          />
        )}
      </Field>
      <Field label="Phone" error={errors.phone?.message}>
        {(props) => (
          <input
            {...props}
            type="tel"
            inputMode="tel"
            maxLength={32}
            placeholder="+880 1711-000000"
            {...form.register("phone")}
          />
        )}
      </Field>
      <Field label="Address" error={errors.address?.message}>
        {(props) => <textarea {...props} rows={3} maxLength={500} {...form.register("address")} />}
      </Field>

      <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save" : "Add supplier"}
        </Button>
      </div>
    </form>
  );
}
