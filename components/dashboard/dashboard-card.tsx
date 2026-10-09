"use client";
import Link from "next/link";
import { useId } from "react";
import { AppIcon } from "@/components/ui/app-icon.tsx";

export function CardHeader({ title, subtitle, action, info }: { title: string; subtitle?: string; action?: { label: string; href: string }; info?: string }) {
  const id = useId();
  return <div className="mb-section flex items-start justify-between gap-item"><div className="min-w-0"><div className="flex items-center gap-small"><h2 className="text-sm font-semibold">{title}</h2>{info && <span className="group relative"><button type="button" aria-label={`About ${title}`} aria-describedby={id} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-muted"><AppIcon name="info" className="h-4 w-4" /></button><span id={id} role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 hidden w-52 -translate-x-1/2 max-w-[calc(100vw-4rem)] rounded-lg border border-border bg-surface p-item text-xs shadow-app group-hover:block group-focus-within:block">{info}</span></span>}</div>{subtitle && <p className="mt-tight text-xs leading-relaxed text-muted">{subtitle}</p>}</div>{action && <Link href={action.href} className="shrink-0 text-xs font-medium text-primary hover:underline">{action.label}</Link>}</div>;
}
export function CardSkeleton({ compact = false }: { compact?: boolean }) {
  return <div role="status" aria-label="Loading card" className="space-y-item motion-safe:animate-pulse"><div className="h-3 w-1/3 rounded bg-surface-muted" /><div className={`${compact ? "h-10" : "h-28"} rounded-lg bg-surface-muted`} /><div className="h-3 w-2/3 rounded bg-surface-muted" /></div>;
}
export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-lg bg-danger/5 p-item"><p className="text-xs text-danger">{message}</p><button type="button" onClick={onRetry} className="mt-small inline-flex min-h-11 items-center gap-small text-xs font-semibold text-primary"><AppIcon name="refresh" />Retry</button></div>;
}
export function DashboardCard({ title, subtitle, action, loading, error, onRetry, children, info, stretch = true }: { title: string; subtitle?: string; action?: { label: string; href: string }; info?: string; loading?: boolean; error?: string; onRetry: () => void; children: React.ReactNode; stretch?: boolean }) {
  return <section className={`ui-panel flex min-h-0 flex-col ${stretch ? "h-full" : "h-auto self-start"}`}><CardHeader title={title} subtitle={subtitle} action={action} info={info} />{loading ? <CardSkeleton /> : error ? <CardError message={error} onRetry={onRetry} /> : children}</section>;
}
export function DashboardEmpty({ message, invoice = false }: { message: string; invoice?: boolean }) {
  return <div className="flex flex-col items-center justify-center gap-item rounded-lg bg-surface-muted p-content text-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><AppIcon name="reports" /></span><p className="text-xs text-muted">{message}</p>{invoice && <Link href="/sales/create" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-item text-xs font-semibold text-surface">Create your first invoice</Link>}</div>;
}
