import { hasAtLeastRole, type UserRole } from "../auth/roles.ts";

export type NavigationPermission = "finance.read" | "reports.read" | "settings.read" | "users.manage";
export function canViewFinance(role: UserRole | undefined) {
  return role !== undefined && hasAtLeastRole(role, "manager");
}
export function canNavigate(role: UserRole | undefined, permission?: NavigationPermission) {
  if (permission === "users.manage") return role === "shop_owner";
  return !permission || canViewFinance(role);
}
