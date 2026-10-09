"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { navigationLinks } from "@/lib/client/navigation.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { AppIcon } from "@/components/ui/app-icon.tsx";

export function CommandPalette() {
  const dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const { session } = useSession(), id = useId();
  const links = navigationLinks(session?.user.role).filter((item) => `${item.label} ${item.href}`.toLowerCase().includes(term.toLowerCase().trim()));
  function show() { setTerm(""); dialog.current?.showModal(); search.current?.focus(); }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setTerm("");
        if (dialog.current?.open) dialog.current.close(); else { dialog.current?.showModal(); search.current?.focus(); }
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return <>
    <button type="button" onClick={show} aria-haspopup="dialog" aria-label="Search" className="flex h-10 w-10 shrink-0 items-center justify-center gap-small rounded-full bg-surface-muted text-xs text-muted lg:h-11 lg:w-56 lg:px-item"><AppIcon name="search" className="shrink-0" /><span className="hidden flex-1 text-left lg:inline">Search pages…</span><kbd className="hidden shrink-0 rounded border border-border px-compact py-micro text-[10px] lg:inline">⌘/Ctrl K</kbd></button>
    <dialog ref={dialog} aria-labelledby={id} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-content text-foreground shadow-app backdrop:bg-black/40" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close(); } }}>
      <div className="mb-item flex items-center justify-between gap-small"><h2 id={id} className="text-sm font-semibold">Pages &amp; quick actions</h2><button type="button" aria-label="Close search" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-muted" onClick={() => dialog.current?.close()}><AppIcon name="close" /></button></div>
      <label htmlFor={`${id}-search`} className="sr-only">Search pages</label><input ref={search} id={`${id}-search`} type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search products, invoices, reports…" className="min-h-11 w-full rounded-lg border border-border bg-surface px-item text-base" onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); dialog.current?.querySelector<HTMLAnchorElement>("a")?.focus(); } }} />
      <p role="status" className="my-small text-xs text-muted">{links.length} matching pages</p><ul className="max-h-[50dvh] space-y-tight overflow-y-auto">{links.map((item) => <li key={item.href}><Link href={item.href!} onClick={() => dialog.current?.close()} className="flex min-h-11 items-center gap-item rounded-lg px-item text-sm hover:bg-primary/5"><AppIcon name={item.icon} className="shrink-0 text-primary" />{item.label}</Link></li>)}</ul>
      {links.length === 0 && <p className="py-section text-center text-sm text-muted">No matching pages. Try another search.</p>}
    </dialog>
  </>;
}
