import type { JsonValue } from "@prisma/orm-framework/contract/types";
import { currentRlsMode, rlsDb } from "../db/rls.ts";
import { auditJson } from "./metadata.ts";
import { currentAuditActor } from "./context.ts";
export { changedFields } from "./metadata.ts";

export interface AuditEntry {
  /** Null only for platform-level (super_admin) actions with no shop. */
  tenantId: string | null;
  /** Verified human actor, or null with an explicitly declared system source. */
  userId: string | null;
  source?: "stripe";
  /** Dotted verb, e.g. `tenant.settings.update`, `product.delete`. */
  action: string;
  /** The table/entity the action touched, e.g. `tenant`, `product`. */
  entityType: string;
  entityId?: string | null;
  /** Free-form detail. For updates, prefer a before/after of changed keys. */
  metadata?: Record<string, JsonValue> | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const mode = currentRlsMode();
  const actor = currentAuditActor();
  if (actor && entry.userId !== actor.id) throw new Error("Audit actor does not match the verified request user.");
  if (!mode || (mode.kind === "tenant" && entry.tenantId !== mode.tenantId))
    throw new Error("Audit scope does not match the current transaction.");
  if (entry.userId === null && entry.source !== "stripe")
    throw new Error("Automated audit events require a declared system source.");
  const metadata = entry.metadata || entry.source
    ? auditJson({ ...entry.metadata, actorType: entry.userId ? "user" : "system", ...(entry.source ? { source: entry.source } : {}) })
    : { actorType: "user" };
  await rlsDb().orm.public.AuditLog.create({
    tenantId: entry.tenantId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata,
  });
}
