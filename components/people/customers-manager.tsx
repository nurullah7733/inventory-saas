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
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useCanManageInventory } from "@/lib/client/current-tenant.ts";
import { errorMessage, plural } from "@/lib/client/format.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { customerSchema, type CustomerResponse } from "@/lib/people/customers.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pager,
  PrimaryAction,
  SearchInput,
  Segmented,
} from "@/components/ui/list-controls.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

/**
 * Customers screen. A shop collects customers at the counter, so the list
 * can grow into the thousands — it is paged and searched on the server.
 * Everyone adds and edits customers; owners and managers also deactivate
 * and delete them.
 */

export const CUSTOMERS_QUERY_KEY = ["people", "customers"] as const;

const PAGE_SIZE = 20;

interface ListEnvelope {
  customers: CustomerResponse[];
  page: number;
  pageSize: number;
  total: number;
}

interface CustomerEnvelope {
  customer: CustomerResponse;
}

type StatusFilter = "active" | "inactive" | "all";

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
] as const;

export function CustomersManager() {
  const queryClient = useQueryClient();
  const canAdmin = useCanManageInventory();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [page, setPage] = useState(1);
  const [formTarget, setFormTarget] = useState<CustomerResponse | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomerResponse | null>(null);

  const term = useDebouncedValue(search.trim(), 300);

  const list = useQuery({
    queryKey: [...CUSTOMERS_QUERY_KEY, "list", { term, filter, page }],
    queryFn: () => {
      const params = new URLSearchParams({
        status: filter,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (term) params.set("search", term);
      return apiRequest<ListEnvelope>(`/customers?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest<CustomerEnvelope>(`/customers/${id}`, {
        method: "PATCH",
        body: { isActive },
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY }),
  });

  const remove = useMutation({
    mutationFn: (customer: CustomerResponse) =>
      apiRequest<{ deleted: { id: string; name: string } }>(`/customers/${customer.id}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
    },
  });

  function toggleActive(customer: CustomerResponse) {
    const isActive = !customer.isActive;
    toast.promise(setActive.mutateAsync({ id: customer.id, isActive }), {
      loading: isActive ? "Reactivating…" : "Marking inactive…",
      success: isActive
        ? `"${customer.name}" is active again.`
        : `"${customer.name}" is inactive. They no longer appear when creating an invoice.`,
      error: (error: unknown) => errorMessage(error, "Could not update."),
    });
  }

  const customers = list.data?.customers ?? [];

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search by name or phone"
          className="sm:flex-1"
        />
        <Segmented
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          options={FILTERS}
          label="Filter by status"
        />
        <PrimaryAction onClick={() => setFormTarget("new")}>Add customer</PrimaryAction>
      </div>

      {list.isPending ? (
        <ListSkeleton label="Loading customers…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load customers.")}
          onRetry={() => void list.refetch()}
        />
      ) : customers.length === 0 ? (
        <EmptyState>
          {term !== ""
            ? "No customers match this search."
            : filter === "inactive"
              ? "No inactive customers."
              : "No customers yet. Add the people you sell to."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {customers.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {customer.name}
                  </p>
                  {customer.phone ? (
                    <a
                      href={`tel:${customer.phone}`}
                      className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                    >
                      {customer.phone}
                    </a>
                  ) : (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No phone</p>
                  )}
                </div>
                {!customer.isActive ? <Badge>Inactive</Badge> : null}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {plural(customer.saleCount, "invoice")}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Edit ${customer.name}`}
                  onClick={() => setFormTarget(customer)}
                >
                  Edit
                </Button>
                {canAdmin ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${customer.isActive ? "Mark inactive" : "Reactivate"} ${customer.name}`}
                      disabled={setActive.isPending}
                      onClick={() => toggleActive(customer)}
                    >
                      {customer.isActive ? "Mark inactive" : "Reactivate"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Delete ${customer.name}`}
                      className="text-red-600 dark:text-red-400"
                      onClick={() => {
                        if (customer.saleCount > 0) {
                          toast.error(
                            `"${customer.name}" has invoice history, so they cannot be deleted. Mark them inactive instead.`,
                          );
                          return;
                        }
                        setDeleting(customer);
                      }}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
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

      <CustomerFormSheet target={formTarget} onClose={() => setFormTarget(null)} />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete customer?"
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

interface CustomerForm {
  name: string;
  phone: string;
}

const FORM_FIELDS = ["name", "phone"] as const;

const SAVE_CUSTOMER_MUTATION = ["people", "customer-save"] as const;

/** The form remounts on every opening, so "Add" always starts blank. */
function CustomerFormSheet({
  target,
  onClose,
}: {
  target: CustomerResponse | "new" | null;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: SAVE_CUSTOMER_MUTATION }) > 0;
  const editing = target !== null && target !== "new" ? target : null;
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={editing ? "Edit customer" : "Add customer"}
    >
      <CustomerFormBody editing={editing} onClose={onClose} />
    </Sheet>
  );
}

function CustomerFormBody({
  editing,
  onClose,
}: {
  editing: CustomerResponse | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<CustomerForm>({
    resolver: zodResolver<CustomerForm>(customerSchema),
    defaultValues: {
      name: editing?.name ?? "",
      phone: editing?.phone ?? "",
    },
  });

  const save = useMutation({
    mutationKey: SAVE_CUSTOMER_MUTATION,
    mutationFn: (values: CustomerForm) =>
      editing
        ? apiRequest<CustomerEnvelope>(`/customers/${editing.id}`, { method: "PATCH", body: values })
        : apiRequest<CustomerEnvelope>("/customers", { method: "POST", body: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
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
      loading: editing ? "Saving customer…" : "Adding customer…",
      success: (result: CustomerEnvelope) =>
        editing ? `Saved "${result.customer.name}".` : `Added "${result.customer.name}".`,
      error: (error: unknown) => errorMessage(error, "Could not save."),
    });
  });

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="Name" error={errors.name?.message} required>
        {(props) => (
          <input
            {...props}
            type="text"
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Karim Hossain"
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
            placeholder="01711-000000"
            {...form.register("phone")}
          />
        )}
      </Field>
      <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        One phone number per customer in your shop. Spaces and dashes are ignored.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save" : "Add customer"}
        </Button>
      </div>
    </form>
  );
}
