"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { CURRENT_TENANT_QUERY_KEY } from "@/lib/client/current-tenant.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import {
  businessSettingsSchema,
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  type BusinessSettingsResponse,
  type InvoiceType,
} from "@/lib/tenant/settings.ts";
import { ImageUploadField } from "@/components/ui/image-upload.tsx";
import { Button, Field, FormSection } from "@/components/ui/field.tsx";

/**
 * Business Settings screen — the tenant-level configuration form.
 *
 * Data flow follows the brief: TanStack Query owns the server state (this is
 * database-backed, so it does not belong in Zustand or component state), React
 * Hook Form owns the in-progress edit, and the SAME Zod schema the API
 * validates with drives the client-side errors.
 */

export const SETTINGS_QUERY_KEY = ["tenant", "settings"] as const;

interface SettingsEnvelope {
  settings: BusinessSettingsResponse;
}

interface SaveResult extends SettingsEnvelope {
  changed: string[];
}

/**
 * The form's value type is not the schema's output type.
 *
 * A text input can only hold a string, so a cleared optional field is `""`
 * here; the schema folds that to `null` on the way to the database. Keeping
 * the two shapes separate is what stops the form from ever putting a literal
 * `"null"` in the phone box.
 */
interface FormValues {
  name: string;
  description: string;
  logoUrl: string;
  email: string;
  phone: string;
  address: string;
  vatPercentage: number;
  lowStockThreshold: number;
  currencySymbol: string;
  invoiceType: InvoiceType;
}

function toFormValues(settings: BusinessSettingsResponse): FormValues {
  return {
    name: settings.name,
    description: settings.description ?? "",
    logoUrl: settings.logoUrl ?? "",
    email: settings.email,
    phone: settings.phone ?? "",
    address: settings.address ?? "",
    // `vatPercentage` crosses the wire as an exact decimal string; the number
    // input needs a number. The schema re-checks the 2-decimal limit on save.
    vatPercentage: Number(settings.vatPercentage),
    lowStockThreshold: settings.lowStockThreshold,
    currencySymbol: settings.currencySymbol,
    invoiceType: isInvoiceType(settings.invoiceType)
      ? settings.invoiceType
      : "standard",
  };
}

function isInvoiceType(value: string): value is InvoiceType {
  return (INVOICE_TYPES as readonly string[]).includes(value);
}

export function BusinessSettingsForm() {
  const queryClient = useQueryClient();
  const [logoUploading, setLogoUploading] = useState(false);
  const { session } = useSession();

  // Only the shop owner may write. The API enforces this (403 for anyone
  // else); the UI reflects it so a manager is not invited to fill in a form
  // that was always going to be refused.
  const canEdit = session?.user.role === "shop_owner";

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest<SettingsEnvelope>("/tenant/settings", { signal }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver<FormValues>(businessSettingsSchema),
    mode: "onBlur",
  });

  const { reset, formState } = form;
  const { dirtyFields } = formState;
  const settings = settingsQuery.data?.settings;

  useEffect(() => {
    // Background refetches must not replace an uploaded logo or other edits.
    if (settings) reset(toFormValues(settings), { keepDirtyValues: true, keepDirty: true });
  }, [settings, reset]);

  const save = useMutation({
    onMutate: async () => {
      // A read started before saving must not put the previous logo back.
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
    },
    mutationFn: (patch: Partial<FormValues>) =>
      apiRequest<SaveResult>("/tenant/settings", {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: (result) => {
      // Seed the cache from the server's own copy rather than from the form —
      // `updated_at` and any server-side normalisation come back with it.
      queryClient.setQueryData<SettingsEnvelope>(SETTINGS_QUERY_KEY, {
        settings: result.settings,
      });
      // The header shows the shop name and logo from `/tenant/current`, which
      // reads the same row — it is now stale.
      void queryClient.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
      reset(toFormValues(result.settings));
    },
    onError: (error) => {
      // Field-level messages from the server's Zod run land on the inputs, so
      // a rule the client somehow skipped still shows up next to the cause.
      if (error instanceof ApiClientError && error.details) {
        for (const [path, messages] of Object.entries(error.details)) {
          if (path in form.getValues()) {
            form.setError(path as keyof FormValues, {
              type: "server",
              message: messages[0],
            });
          }
        }
      }
    },
  });

  const saveLogo = useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
    },
    mutationFn: (logoUrl: string) => apiRequest<SaveResult>("/tenant/settings", {
      method: "PATCH",
      body: { logoUrl },
    }),
    onSuccess: (result) => {
      // Persist only the logo; keep unrelated settings edits in the form.
      form.resetField("logoUrl", { defaultValue: result.settings.logoUrl ?? "" });
      queryClient.setQueryData<SettingsEnvelope>(SETTINGS_QUERY_KEY, { settings: result.settings });
      void queryClient.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
      toast.success(result.settings.logoUrl ? "Logo saved." : "Logo removed.");
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (logoUploading) return;
    // PATCH means partial: send only what the user actually touched. A field
    // they never opened is not echoed back, so two people editing different
    // sections cannot overwrite each other.
    const dirty = Object.keys(dirtyFields) as (keyof FormValues)[];
    const patch: Partial<FormValues> = {};
    for (const key of dirty) {
      patch[key] = values[key] as never;
    }

    if (Object.keys(patch).length === 0) {
      toast.info("Nothing to save — no settings were changed.");
      return;
    }

    // `toast.promise` for async CRUD, per the brief: loading → success/error
    // without hand-rolling three states.
    toast.promise(save.mutateAsync(patch), {
      loading: "Saving business settings…",
      success: (result: SaveResult) =>
        `Saved ${result.changed.length} setting${result.changed.length === 1 ? "" : "s"}.`,
      error: (error: unknown) =>
        error instanceof Error ? error.message : "Could not save settings.",
    });
  });

  if (settingsQuery.isPending) {
    return <SettingsSkeleton />;
  }

  if (settingsQuery.isError) {
    const message =
      settingsQuery.error instanceof Error
        ? settingsQuery.error.message
        : "Could not load your business settings.";
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-content text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">{message}</p>
        <Button
          variant="ghost"
          className="mt-item"
          onClick={() => settingsQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const errors = formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-content pb-dock sm:pb-roomy">
      {!canEdit ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-item text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You have read-only access to these settings. Ask the shop owner to
          make changes.
        </p>
      ) : null}

      <FormSection
        title="Business identity"
        description="Shown in the dashboard header and printed on every invoice."
      >
        <Field label="Business name" error={errors.name?.message} required>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="organization"
              disabled={!canEdit}
              {...form.register("name")}
            />
          )}
        </Field>

        <Controller
          name="logoUrl"
          control={form.control}
          render={({ field, fieldState }) => <ImageUploadField
            label="Business logo"
            purpose="logo"
            value={field.value ?? ""}
            allowUrl={false}
            disabled={!canEdit || save.isPending}
            error={fieldState.error?.message}
            onUploadingChange={setLogoUploading}
            onChange={async (url) => { await saveLogo.mutateAsync(url); }}
          />}
        />
        <p className="text-xs text-muted sm:col-span-2">Logo changes are saved automatically.</p>

        <div className="sm:col-span-2">
          <Field label="Description" error={errors.description?.message}>
            {(props) => (
              <textarea
                {...props}
                rows={2}
                disabled={!canEdit}
                {...form.register("description")}
              />
            )}
          </Field>
        </div>

      </FormSection>

      <FormSection
        title="Contact details"
        description="Where customers and suppliers reach this shop."
      >
        <Field label="Email" error={errors.email?.message} required>
          {(props) => (
            <input
              {...props}
              type="email"
              inputMode="email"
              autoComplete="email"
              disabled={!canEdit}
              {...form.register("email")}
            />
          )}
        </Field>

        <Field label="Phone" error={errors.phone?.message}>
          {(props) => (
            <input
              {...props}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              disabled={!canEdit}
              {...form.register("phone")}
            />
          )}
        </Field>

        <div className="sm:col-span-2">
          <Field label="Address" error={errors.address?.message}>
            {(props) => (
              <textarea
                {...props}
                rows={2}
                disabled={!canEdit}
                {...form.register("address")}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Sales & inventory configuration"
        description="Applies to new invoices and to the low-stock alert list."
      >
        <Field
          label="VAT percentage"
          hint="Added to invoice subtotals. Use 0 if this shop does not charge VAT."
          error={errors.vatPercentage?.message}
          required
        >
          {(props) => (
            <input
              {...props}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              disabled={!canEdit}
              {...form.register("vatPercentage", { valueAsNumber: true })}
            />
          )}
        </Field>

        <Field
          label="Low stock threshold"
          hint="A product at or below this quantity shows in the Low Stock list."
          error={errors.lowStockThreshold?.message}
          required
        >
          {(props) => (
            <input
              {...props}
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              disabled={!canEdit}
              {...form.register("lowStockThreshold", { valueAsNumber: true })}
            />
          )}
        </Field>

        <Field
          label="Currency symbol"
          hint="Prefixed to every amount shown in the app."
          error={errors.currencySymbol?.message}
          required
        >
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={8}
              disabled={!canEdit}
              {...form.register("currencySymbol")}
            />
          )}
        </Field>

        <Field
          label="Invoice type"
          hint="The layout used when printing or sharing an invoice."
          error={errors.invoiceType?.message}
          required
        >
          {(props) => (
            <select {...props} disabled={!canEdit} {...form.register("invoiceType")}>
              {INVOICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INVOICE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FormSection>

      {canEdit ? (
        /* Sticky action bar on a phone — the form is taller than a handset
           screen, and the brief expects staff saving this one-handed without
           scrolling back down to find the button. */
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-end gap-item border-t border-zinc-200 bg-white/95 p-item backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-950/95 sm:dark:bg-transparent">
          {formState.isDirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending || logoUploading}
              onClick={() => settings && reset(toFormValues(settings))}
            >
              Discard changes
            </Button>
          ) : null}
          <Button type="submit" disabled={save.isPending || logoUploading || !formState.isDirty}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-content" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading business settings…</span>
      {[0, 1, 2].map((section) => (
        <div
          key={section}
          className="rounded-xl border border-zinc-200 bg-white p-content sm:p-roomy dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-content h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid grid-cols-1 gap-content sm:grid-cols-2">
            {[0, 1].map((field) => (
              <div
                key={field}
                className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
