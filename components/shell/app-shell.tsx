"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useRequireSession, useSignOut } from "@/lib/client/use-session.ts";
import { Button } from "@/components/ui/field.tsx";
import { ApiClientError } from "@/lib/client/api.ts";
import { TenantLogo } from "./tenant-logo.tsx";
import { useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon.tsx";
import { SidebarNavigation } from "./sidebar-navigation.tsx";
import { SidebarPlanCard } from "./sidebar-plan-card.tsx";
import { ThemeSwitch } from "./theme-switch.tsx";
import { CommandPalette } from "./command-palette.tsx";
import { NotificationMenu } from "./notification-menu.tsx";
import { navigationLinks, isActiveRoute } from "@/lib/client/navigation.ts";
import { canNavigate, canViewFinance } from "@/lib/dashboard/permissions.ts";

function ProfileMenu({
  name,
  role,
  showBilling,
  showUsers,
  onSignOut,
}: {
  name: string;
  role: string;
  showBilling: boolean;
  showUsers: boolean;
  onSignOut: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const billingItem = useRef<HTMLAnchorElement>(null);
  const signOutItem = useRef<HTMLButtonElement>(null);
  const initialItem = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;
    const items = Array.from(
      container.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="switch"]',
      ) ?? [],
    ).filter((item) => item.getClientRects().length > 0);
    (initialItem.current === "last" ? items.at(-1) : items[0])?.focus();
    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open, showBilling, showUsers]);

  return (
    <div
      ref={container}
      className="relative min-w-0 shrink-0 lg:ml-auto lg:border-l lg:border-border lg:pl-item"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          initialItem.current = "first";
          setOpen((previous) => !previous);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialItem.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
            if (open) {
              const items = Array.from(
                container.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"], [role="switch"]',
                ) ?? [],
              ).filter((item) => item.getClientRects().length > 0);
              (initialItem.current === "last"
                ? items.at(-1)
                : items[0]
              )?.focus();
            }
          }
        }}
        className="flex min-h-11 min-w-10 max-w-full items-center gap-micro rounded-lg lg:gap-small lg:px-small text-left transition hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:h-9 lg:w-9 bg-primary/10 text-sm font-semibold text-primary"
        >
          {Array.from(name)[0]?.toUpperCase()}
        </span>
        <span className="hidden min-w-0 max-w-36 lg:block">
          <span className="block truncate text-xs font-medium" title={name}>
            {name}
          </span>
          <span className="block truncate text-[11px] capitalize text-muted">
            {role.replace(/_/g, " ")}
          </span>
        </span>
        <AppIcon
          name="chevron"
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>
      {open && (
        <ul
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          className="ui-panel absolute right-0 top-full z-30 mt-small w-60 max-w-[calc(100vw-2rem)] p-tight"
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="menuitem"], [role="switch"]',
                ),
              ).filter((item) => item.getClientRects().length > 0);
              const current = items.findIndex(
                (item) => item === document.activeElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          <li
            role="none"
            className="border-b border-border px-item py-small lg:hidden"
          >
            <p className="truncate text-xs font-medium" title={name}>
              {name}
            </p>
            <p className="truncate text-[11px] capitalize text-muted">
              {role.replace(/_/g, " ")}
            </p>
          </li>
          <li
            role="none"
            className="flex min-h-11 items-center justify-between gap-item px-item text-xs min-[400px]:hidden"
          >
            <span>Dark mode</span>
            <ThemeSwitch />
          </li>
          {showUsers && (
            <li role="none">
              <Link
                href="/people/users"
                role="menuitem"
                tabIndex={-1}
                className="flex min-h-11 w-full items-center gap-item rounded-lg px-item text-xs text-foreground transition hover:bg-surface-muted"
                onClick={() => setOpen(false)}
              >
                <AppIcon name="people" className="shrink-0" />
                Staff &amp; managers
              </Link>
            </li>
          )}
          {showBilling && (
            <li role="none">
              <Link
                ref={billingItem}
                href="/settings/billing"
                role="menuitem"
                tabIndex={-1}
                className="flex min-h-11 w-full items-center gap-item rounded-lg px-item text-xs text-foreground transition hover:bg-surface-muted"
                onClick={() => setOpen(false)}
              >
                <AppIcon name="finance" className="shrink-0" />
                Subscription &amp; billing
              </Link>
            </li>
          )}
          <li role="none" className="mt-tight border-t border-border pt-tight">
            <button
              ref={signOutItem}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="flex min-h-11 w-full items-center gap-item rounded-lg px-item text-xs text-danger transition hover:bg-danger/5"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              <AppIcon name="logout" />
              Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, session } = useRequireSession();
  const pathname = usePathname();
  const signOut = useSignOut();

  const currentTenant = useCurrentTenant();
  const dialog = useRef<HTMLDialogElement>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!navigationOpen) return;
    const panel = dialog.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setNavigationOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      panel.close();
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [navigationOpen]);

  if (status !== "authenticated") {
    // `useRequireSession` is already redirecting; this is the frame in between.
    return (
      <div className="flex flex-1 items-center justify-center p-large text-sm text-zinc-500">
        Checking your session…
      </div>
    );
  }

  if (session?.user.role === "super_admin") {
    return (
      <main className="mx-auto w-full max-w-4xl p-roomy">
        <h1 className="text-xl font-semibold">Platform account</h1>
        <Link className="mt-content inline-block underline" href="/admin">
          Open Super Admin panel
        </Link>
      </main>
    );
  }

  const tenant = currentTenant.data?.tenant;
  const denied =
    currentTenant.error instanceof ApiClientError &&
    [401, 403].includes(currentTenant.error.status);

  if (denied) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-content p-roomy">
        <h1 className="text-xl font-semibold">Workspace unavailable</h1>
        <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">
          {currentTenant.error?.message}
        </p>
        <div className="flex flex-wrap gap-item">
          <Button
            disabled={currentTenant.isFetching}
            onClick={() => void currentTenant.refetch()}
          >
            Retry
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  const workspaceName =
    tenant?.name ??
    (currentTenant.isError ? "Workspace unavailable" : "Loading workspace…");
  const navigation = (
    <SidebarNavigation
      key={pathname}
      pathname={pathname}
      role={session?.user.role}
      onNavigate={() => setNavigationOpen(false)}
      onSignOut={() => {
        setNavigationOpen(false);
        void signOut();
      }}
    />
  );
  const brand = (
    <Link href="/dashboard">
      <div className="flex min-w-0 items-center gap-item">
        <TenantLogo
          key={tenant?.logoUrl ?? "initial"}
          name={tenant?.name ?? ""}
          logoUrl={tenant?.logoUrl ?? null}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={workspaceName}>
            {workspaceName}
          </p>
          <p className="text-[11px] text-muted">Inventory &amp; accounting</p>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="min-h-dvh flex-1 bg-surface">
      <a
        href="#app-content"
        className="sr-only z-50 rounded-lg bg-surface p-item focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div
        className={`grid min-h-dvh w-full grid-cols-[minmax(0,1fr)] bg-surface ${sidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[230px_minmax(0,1fr)]"}`}
      >
        <aside className="hidden border-r border-border lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div
              className={`flex min-h-20 shrink-0 items-center border-b border-border ${sidebarCollapsed ? "justify-center" : "px-section"}`}
            >
              {sidebarCollapsed ? (
                <Link href="/dashboard">
                  <TenantLogo
                    name={tenant?.name ?? ""}
                    logoUrl={tenant?.logoUrl ?? null}
                  />
                </Link>
              ) : (
                brand
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <SidebarNavigation
                key={`${pathname}:${sidebarCollapsed}`}
                pathname={pathname}
                role={session?.user.role}
                collapsed={sidebarCollapsed}
                onNavigate={() => setNavigationOpen(false)}
                onSignOut={() => void signOut()}
              />
            </div>
            <SidebarPlanCard
              collapsed={sidebarCollapsed}
              onNavigate={() => setNavigationOpen(false)}
            />
            <button
              type="button"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((previous) => !previous)}
              className="mx-item mb-item flex min-h-11 shrink-0 items-center justify-center gap-small rounded-lg border border-border text-xs text-muted hover:bg-surface-muted"
            >
              <AppIcon
                name="chevron"
                className={sidebarCollapsed ? "" : "rotate-180"}
              />
              {!sidebarCollapsed && "Collapse sidebar"}
            </button>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex min-h-20 flex-col justify-center gap-item border-b border-border bg-surface px-small py-item sm:px-content lg:static lg:z-auto lg:px-roomy">
            <div className="flex w-full min-w-0 items-center gap-tight lg:gap-item">
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-muted lg:hidden"
                aria-label="Open navigation"
                aria-expanded={navigationOpen}
                aria-controls="mobile-navigation"
                onClick={() => setNavigationOpen(true)}
              >
                <AppIcon name="menu" />
              </button>
              <div className="shrink-0 lg:hidden">
                <TenantLogo
                  key={tenant?.logoUrl ?? "initial"}
                  name={tenant?.name ?? ""}
                  logoUrl={tenant?.logoUrl ?? null}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-medium tracking-tight sm:text-lg">
                  {pathname === "/dashboard" ? (
                    <>
                      <span className="lg:hidden">Dashboard</span>
                      <span className="hidden lg:inline">
                        Dashboard overview
                      </span>
                    </>
                  ) : (
                    (navigationLinks(session?.user.role).find((item) =>
                      isActiveRoute(pathname, item.href),
                    )?.label ?? "Workspace")
                  )}
                </h1>
                <p className="mt-micro hidden truncate text-xs text-muted sm:block">
                  {pathname === "/dashboard"
                    ? `Welcome, ${currentTenant.data?.viewer.name ?? session?.user.name ?? ""}. Your business, at a glance.`
                    : workspaceName}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-micro lg:gap-small">
                <div className="hidden shrink-0 min-[400px]:block">
                  <ThemeSwitch />
                </div>
                <CommandPalette />
                <NotificationMenu />
                <ProfileMenu
                  key={pathname}
                  name={
                    currentTenant.data?.viewer.name ?? session?.user.name ?? ""
                  }
                  role={
                    currentTenant.data?.viewer.role ?? session?.user.role ?? ""
                  }
                  showBilling={canViewFinance(session?.user.role)}
                  showUsers={canNavigate(session?.user.role, "users.manage")}
                  onSignOut={() => void signOut()}
                />
              </div>
            </div>
            {currentTenant.isError && (
              <div
                role="alert"
                className="flex w-full flex-wrap items-center gap-small text-sm text-danger"
              >
                <span className="min-w-0 flex-1 break-words">
                  Could not refresh workspace information.{" "}
                  {currentTenant.error.message}
                </span>
                <Button
                  variant="ghost"
                  disabled={currentTenant.isFetching}
                  onClick={() => void currentTenant.refetch()}
                >
                  {currentTenant.isFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            )}
          </header>
          <main
            id="app-content"
            tabIndex={-1}
            className="ui-page w-full min-w-0 outline-none"
          >
            {children}
          </main>
        </div>
      </div>
      <dialog
        ref={dialog}
        id="mobile-navigation"
        aria-label="Workspace navigation"
        className="navigation-dialog"
        onCancel={() => setNavigationOpen(false)}
        onClose={() => setNavigationOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              setNavigationOpen(false);
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-item border-b border-border p-content">
          <div className="min-w-0">{brand}</div>
          <Button
            variant="ghost"
            className="shrink-0 px-item"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
          >
            <AppIcon name="close" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
        <SidebarPlanCard onNavigate={() => setNavigationOpen(false)} />
      </dialog>
    </div>
  );
}
