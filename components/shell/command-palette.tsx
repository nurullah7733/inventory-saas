"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { navigationLinks } from "@/lib/client/navigation.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { AppIcon } from "@/components/ui/app-icon.tsx";

/**
 * The ⌘/Ctrl-K page search, on the shared Radix dialog layer — focus trap,
 * Escape and backdrop dismissal come from the primitive instead of the
 * previous hand-rolled showModal handling. The keyboard shortcut, the result
 * count and the ArrowDown-into-results behaviour are unchanged.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const results = useRef<HTMLUListElement>(null);
  const { session } = useSession();
  const links = navigationLinks(session?.user.role).filter((item) => `${item.label} ${item.href}`.toLowerCase().includes(term.toLowerCase().trim()));
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setTerm(""); }}>
    <Dialog.Trigger aria-label="Search" className="flex h-10 w-10 shrink-0 items-center justify-center gap-small rounded-full bg-surface-muted text-xs text-muted lg:h-11 lg:w-56 lg:px-item"><AppIcon name="search" className="shrink-0" /><span className="hidden flex-1 text-left lg:inline">Search pages…</span><kbd className="hidden shrink-0 rounded border border-border px-compact py-micro text-[10px] lg:inline">⌘/Ctrl K</kbd></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 duration-150" />
      <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-40 m-auto flex flex-col gap-content w-[calc(100%-2rem)] max-w-lg h-fit rounded-xl border border-border bg-surface p-content text-foreground shadow-app outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95 duration-150">
        <div className="flex items-center justify-between gap-small">
          <Dialog.Title className="text-sm font-semibold">Pages &amp; quick actions</Dialog.Title>
          <Dialog.Close aria-label="Close search" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-muted"><AppIcon name="close" /></Dialog.Close>
        </div>
        <input type="search" autoFocus aria-label="Search pages" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search products, invoices, reports…" className="min-h-11 w-full rounded-lg border border-border bg-surface px-item text-base" onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); results.current?.querySelector<HTMLAnchorElement>("a")?.focus(); } }} />
        <p role="status" className="my-small text-xs text-muted">{links.length} matching pages</p>
        <ul ref={results} className="max-h-[50dvh] space-y-tight overflow-y-auto">{links.map((item) => <li key={item.href}><Link href={item.href!} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-item rounded-lg px-item text-sm outline-none hover:bg-primary/5 focus:bg-primary/5"><AppIcon name={item.icon} className="shrink-0 text-primary" />{item.label}</Link></li>)}</ul>
        {links.length === 0 && <p className="py-section text-center text-sm text-muted">No matching pages. Try another search.</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
