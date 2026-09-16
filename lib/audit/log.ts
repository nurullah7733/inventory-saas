import type { JsonValue } from "@prisma/orm-framework/contract/types";
import { rlsDb } from "../db/rls.ts";

export interface AuditEntry {
  /** Null only for platform-level (super_admin) actions with no shop. */
  tenantId: string | null;
  /** The acting user, always — an audit row with no actor has no value. */
  userId: string;
  /** Dotted verb, e.g. `tenant.settings.update`, `product.delete`. */
  action: string;
  /** The table/entity the action touched, e.g. `tenant`, `product`. */
  entityType: string;
  entityId?: string | null;
  /** Free-form detail. For updates, prefer a before/after of changed keys. */
  metadata?: Record<string, JsonValue> | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await rlsDb().orm.public.AuditLog.create({
    tenantId: entry.tenantId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? null,
  });
}

export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): {
  changed: string[];
  before: Record<string, JsonValue>;
  after: Record<string, JsonValue>;
} {
  const changed: string[] = [];
  const beforeDiff: Record<string, JsonValue> = {};
  const afterDiff: Record<string, JsonValue> = {};

  for (const key of Object.keys(after)) {
    const from = before[key];
    const to = after[key];
    if (String(from ?? "") === String(to ?? "")) continue;

    changed.push(key);
    beforeDiff[key] = (from ?? null) as JsonValue;
    afterDiff[key] = (to ?? null) as JsonValue;
  }

  return { changed, before: beforeDiff, after: afterDiff };
}
