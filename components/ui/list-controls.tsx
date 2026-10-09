"use client";

import { Button } from "./field.tsx";

/**
 * The pieces every inventory list screen repeats: a search box, a segmented
 * filter, a pager, and the loading / error / empty states. Same classes as the
 * Categories screen, which predates this file.
 */

export const inputClasses =
  "min-h-11 w-full rounded-lg border border-border bg-surface px-control-x py-control-y text-base text-foreground " +
  "shadow-panel outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";

export function SearchInput({
  value,
  onChange,
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={label}
      aria-label={label}
      className={`${inputClasses} ${className}`}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-tight overflow-x-auto rounded-xl bg-surface-muted p-tight"
    >
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={`min-h-9 flex-1 whitespace-nowrap rounded-lg px-item text-sm font-medium transition ${
            value === item.value
              ? "bg-surface text-foreground shadow-panel"
              : "text-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Pinned to the bottom on a phone, inline from `sm` up. */
export function PrimaryAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 p-item backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
      <Button type="button" className="w-full sm:w-auto" onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  busy,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-small text-sm text-muted"
    >
      <Button
        type="button"
        variant="ghost"
        disabled={page <= 1 || busy}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite">
        {first}–{last} of {total.toLocaleString()}
      </span>
      <Button
        type="button"
        variant="ghost"
        disabled={page >= pages || busy}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-panel border border-danger/20 bg-danger/5 p-panel text-sm text-danger">
      <p className="font-medium">{message}</p>
      <Button type="button" variant="ghost" className="mt-item" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-dashed border-border p-large text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-item" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="h-20 motion-safe:animate-pulse rounded-panel bg-surface-muted" />
      ))}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning" | "danger" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "bg-surface-muted text-foreground",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
    success: "bg-success/10 text-success",
  }[tone];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-small py-micro text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

/** Square thumbnail, or the first letter of the name when there is no image. */
export function Thumb({
  src,
  name,
  size = "md",
}: {
  src: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-10 w-10 text-sm" : "h-14 w-14 text-lg";
  if (src) {
    return (
      // A plain <img>: the URL is tenant data (Blob or a pasted host), so
      // next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        className={`${box} shrink-0 rounded-lg border border-border bg-surface object-cover`}
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-surface-muted font-semibold text-muted`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
