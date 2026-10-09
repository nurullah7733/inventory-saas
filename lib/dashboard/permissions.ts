import { hasAtLeastRole, type UserRole } from "../auth/roles.ts";

export type NavigationPermission = "finance.read" | "reports.read" | "settings.read";
export function canViewFinance(role: UserRole | undefined) {
  return role !== undefined && hasAtLeastRole(role, "manager");
}
export function canNavigate(role: UserRole | undefined, permission?: NavigationPermission) {
  return !permission || canViewFinance(role);
}
