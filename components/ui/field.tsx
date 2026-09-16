"use client";

import { useId } from "react";

/**
 * Minimal accessible form primitives.
 *
 * The brief calls for shadcn/ui on Radix. These are shaped like the shadcn
 * `Field` / `Input` / `Select` API on purpose (same props, same class hooks),
 * so `npx shadcn@latest add` can replace this file without touching a single
 * form. What they already do is the part that matters for correctness and is
 * easy to get wrong by hand: label/control association via `useId`, the error
 * wired through `aria-describedby`, `aria-invalid` on the control, and the
 * error text in a live region so a screen reader announces a failed save.
 *
 * Tap targets are 44px tall — the brief expects staff using this on a phone,
 * in a shop, one-handed.
 */

const controlClasses =
  "w-full min-h-11 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base " +
  "text-zinc-900 shadow-sm outline-none transition " +
  "placeholder:text-zinc-400 " +
  "focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 " +
  "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 " +
  "aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/20 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 " +
  "dark:focus:border-zinc-400 dark:disabled:bg-zinc-800";

export interface FieldProps {
  label: string;
  /** Rendered under the control when there is no error. */
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    className: string;
  }) => React.ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        className: controlClasses,
      })}

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        ) : null}
      </div>
      {/* One column on a phone, two from `sm` up — the brief's mobile-first
          rule, expressed once here rather than per field. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 " +
    "text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
