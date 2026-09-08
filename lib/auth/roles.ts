/**
 * The three privilege levels from the project brief, plus `staff` as the
 * lower half of the "Manager/Staff" tier.
 */
export const USER_ROLES = [
  "super_admin",
  "shop_owner",
  "manager",
  "staff",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

export const TENANT_ASSIGNABLE_ROLES = [
  "manager",
  "staff",
] as const satisfies readonly UserRole[];

const ROLE_RANK: Record<UserRole, number> = {
  staff: 1,
  manager: 2,
  shop_owner: 3,
  super_admin: 4,
};

export function hasAtLeastRole(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isPlatformRole(role: UserRole): boolean {
  return role === "super_admin";
}
