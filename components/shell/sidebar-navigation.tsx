"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon.tsx";
import { isActiveRoute, visibleNavigation, type NavigationItem } from "@/lib/client/navigation.ts";
import { useDashboardAlerts } from "@/lib/client/dashboard.ts";
import type { UserRole } from "@/lib/auth/roles.ts";

export function SidebarNavigation({ pathname, role, collapsed = false, onNavigate, onSignOut }: { pathname: string; role?: UserRole; collapsed?: boolean; onNavigate: () => void; onSignOut: () => void }) {
  const id = useId(), navigation = visibleNavigation(role);
  const alerts = useDashboardAlerts();
  const [flyout, setFlyout] = useState({ left: 0, top: 0, paddingLeft: 12, width: 236 });
  const [expanded, setExpanded] = useState<string | null>(() => collapsed ? null : navigation.find((item) => item.children?.some((child) => isActiveRoute(pathname, child.href)))?.label ?? null);
  function positionFlyout(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const sidebarRight = element.closest("aside")?.getBoundingClientRect().right ?? rect.right;
    const gap = Math.max(12, sidebarRight - rect.right + 12);
    setFlyout({ left: rect.right, top: Math.max(8, Math.min(rect.top, window.innerHeight - 240)), paddingLeft: gap, width: 224 + gap });
  }
  const activeStyle = (active: boolean) => `relative flex min-h-11 w-full items-center gap-item rounded-lg px-item text-[13px] transition ${active ? "bg-primary/8 font-semibold text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground"}`;
  function badge(item: NavigationItem) {
    const count = item.badgeKey === "lowStock" ? alerts.lowStock.data?.total : item.badgeKey === "nearExpiry" ? alerts.nearExpiry.data?.total : undefined;
    return count === undefined ? null : <span className={`ml-auto rounded-full px-compact py-micro text-[10px] ${count === 0 ? "bg-surface-muted text-muted" : item.badgeKey === "nearExpiry" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}>{count.toLocaleString("en-US")}</span>;
  }
  return <nav aria-label="Main navigation" className="space-y-tight px-item py-content" onKeyDown={(event) => { if (collapsed && event.key === "Escape") { setExpanded(null); (event.target as HTMLElement).closest("[data-nav-group]")?.querySelector("button")?.focus(); } }}>
    {navigation.map((item) => {
      if (item.action === "signOut") return <button key={item.label} type="button" title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} onClick={onSignOut} className={`${activeStyle(false)} mt-content border-t border-border ${collapsed ? "justify-center px-0" : ""}`}><AppIcon name={item.icon} />{!collapsed && item.label}</button>;
      const active = isActiveRoute(pathname, item.href) || !!item.children?.some((child) => isActiveRoute(pathname, child.href));
      if (!item.children) return <Link key={item.label} href={item.href!} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} onClick={onNavigate} className={`${activeStyle(active)} ${collapsed ? "justify-center px-0" : ""}`}><AppIcon name={item.icon} className="shrink-0" />{!collapsed && item.label}</Link>;
      const open = expanded === item.label, submenuId = `${id}-${item.label}`;
      return <div key={item.label} data-nav-group className="relative" onMouseEnter={(event) => { if (collapsed) { positionFlyout(event.currentTarget); setExpanded(item.label); } }} onMouseLeave={() => { if (collapsed) setExpanded(null); }} onBlur={(event) => { if (collapsed && !event.currentTarget.contains(event.relatedTarget)) setExpanded(null); }}>
        <button type="button" aria-label={collapsed ? item.label : undefined} title={collapsed ? item.label : undefined} aria-expanded={open} aria-controls={submenuId} className={`${activeStyle(active)} ${collapsed ? "justify-center px-0" : ""}`} onClick={(event) => { if (collapsed) { positionFlyout(event.currentTarget); } setExpanded((previous) => previous === item.label ? null : item.label); }}><AppIcon name={item.icon} className="shrink-0" />{!collapsed && <><span className="flex-1 text-left">{item.label}</span><AppIcon name="chevron" className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} /></>}</button>
        <div id={submenuId} aria-hidden={!open} inert={!open} style={collapsed ? flyout : undefined} className={collapsed ? `fixed z-40 w-56 pl-item ${open ? "block" : "hidden"}` : `grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
          <div className={collapsed ? "ui-panel max-h-[calc(100vh-1rem)] overflow-y-auto p-small shadow-app" : "min-h-0 overflow-hidden"}><ul aria-label={`${item.label} pages`} className={collapsed ? "space-y-tight" : "my-tight ml-section space-y-tight border-l border-border pl-item"}>{item.children.map((child) => <li key={child.href}><Link href={child.href!} aria-current={isActiveRoute(pathname, child.href) ? "page" : undefined} onClick={onNavigate} className={activeStyle(isActiveRoute(pathname, child.href))}><span>{child.label}</span>{badge(child)}</Link></li>)}</ul></div>
        </div>
      </div>;
    })}
  </nav>;
}
