import type { AppIconName } from "../../components/ui/app-icon.tsx";
import { canNavigate, type NavigationPermission } from "../dashboard/permissions.ts";
import type { UserRole } from "../auth/roles.ts";

export interface NavigationItem {
  label: string; icon: AppIconName; href?: string; children?: readonly NavigationItem[];
  permission?: NavigationPermission; badgeKey?: "lowStock" | "nearExpiry";
  action?: "signOut";
}
export const NAVIGATION: readonly NavigationItem[] = [
  { label: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { label: "Products", icon: "inventory", children: [
    { label: "Products", icon: "inventory", href: "/inventory/products" },
    { label: "Variant options", icon: "inventory", href: "/inventory/variants" },
  ] },
  { label: "Categories", icon: "categories", href: "/inventory/categories" },
  { label: "Stock", icon: "stock", children: [
    { label: "Stock", icon: "stock", href: "/inventory/stock" },
    { label: "Low stock", icon: "stock", href: "/inventory/low-stock", badgeKey: "lowStock" },
    { label: "Near expiry", icon: "calendar", href: "/inventory/near-expiry", badgeKey: "nearExpiry" },
    { label: "Wastage", icon: "stock", href: "/inventory/wastage" },
  ] },
  { label: "Purchases", icon: "purchases", children: [
    { label: "Purchase returns", icon: "purchases", href: "/inventory/purchase-returns" },
    { label: "Supplier payments", icon: "finance", href: "/finance/supplier-payments", permission: "finance.read" },
  ] },
  { label: "Sales", icon: "sales", children: [
    { label: "Create invoice", icon: "sales", href: "/sales/create" },
    { label: "Invoices", icon: "sales", href: "/sales/invoices" },
    { label: "Draft invoices", icon: "sales", href: "/sales/drafts" },
    { label: "Returns", icon: "sales", href: "/inventory/returns" },
  ] },
  { label: "People", icon: "people", children: [
    { label: "Customers", icon: "people", href: "/people/customers" },
    { label: "Suppliers", icon: "people", href: "/inventory/suppliers" },
  ] },
  { label: "Finance", icon: "finance", permission: "finance.read", children: [
    { label: "Expenses", icon: "finance", href: "/finance/expenses" },
    { label: "Expense categories", icon: "categories", href: "/finance/expense-categories" },
  ] },
  { label: "Reports", icon: "reports", href: "/reports", permission: "reports.read" },
  { label: "Settings", icon: "settings", children: [
    { label: "Profile", icon: "people", href: "/settings/profile" },
    { label: "Business settings", icon: "settings", href: "/settings/business", permission: "settings.read" },
    { label: "Staff & managers", icon: "people", href: "/people/users", permission: "users.manage" },
    { label: "Subscription & billing", icon: "finance", href: "/settings/billing", permission: "settings.read" },
  ] },
];
export function visibleNavigation(role: UserRole | undefined): NavigationItem[] {
  return NAVIGATION.filter((item) => canNavigate(role, item.permission)).map((item) => ({ ...item, children: item.children?.filter((child) => canNavigate(role, child.permission)) }));
}
export function navigationLinks(role?: UserRole) {
  return visibleNavigation(role).flatMap((item) => item.children ?? [item]).filter((item) => item.href);
}
export function isActiveRoute(pathname: string, href?: string) { return !!href && (pathname === href || pathname.startsWith(`${href}/`)); }
