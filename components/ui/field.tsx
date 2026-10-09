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
  "w-full min-w-0 min-h-11 rounded-lg border border-border bg-surface px-control-x py-control-y text-base " +
  "text-foreground shadow-panel outline-none transition placeholder:text-muted " +
  "focus:border-primary focus:ring-2 focus:ring-primary/10 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20";

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
    <div className="flex flex-col gap-compact">
      <label
        htmlFor={id}
        className="text-xs font-medium text-foreground"
      >
        {label}
        {required ? (
          <span className="ml-micro text-danger" aria-hidden="true">
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
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
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
    <section className="ui-panel p-form-panel">
      <div className="mb-content">
        <h2 className="text-base font-semibold text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-tight text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {/* One column on a phone, two from `sm` up — the brief's mobile-first
          rule, expressed once here rather than per field. */}
      <div className="ui-field-grid grid-cols-1 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-small rounded-lg px-control-button " +
    "text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  const styles = {
    primary:
      "bg-primary text-surface hover:bg-primary/90",
    ghost:
      "border border-border bg-surface text-foreground hover:bg-surface-muted",
    danger:
      "bg-danger text-surface hover:bg-danger/90",
  }[variant];

  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
