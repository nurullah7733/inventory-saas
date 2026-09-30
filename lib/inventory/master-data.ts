import type { UserRole } from "../auth/roles.ts";

export const MASTER_DATA_WRITE_ROLES = [
  "shop_owner",
  "manager",
] as const satisfies readonly UserRole[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && "sqlState" in current) {
      const state = (current as { sqlState?: unknown }).sqlState;
      if (typeof state === "string") return state;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return sqlStateOf(error) === "23503";
}

export function productsPhrase(count: number): string {
  return `${count} product${count === 1 ? "" : "s"}`;
}
