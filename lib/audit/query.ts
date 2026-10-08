import { z } from "zod";
import { isCalendarDate } from "../dates.ts";
import { rlsDb } from "../db/rls.ts";
import { auditJson } from "./metadata.ts";

const date = z.string().refine(isCalendarDate, "Use a calendar date (YYYY-MM-DD).");
export const auditFilterSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/).optional(),
  entityType: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).optional(),
  entityId: z.string().uuid().optional(),
  from: date.optional(), to: date.optional(),
}).strict().refine((f) => !f.from || !f.to || f.from <= f.to, "Start date must not follow end date.");

export async function listAuditLogs(tenantId: string | null, filter: z.output<typeof auditFilterSchema>) {
  let query = rlsDb().orm.public.AuditLog.where({ tenantId });
  if (filter.action) query = query.where({ action: filter.action });
  if (filter.entityType) query = query.where({ entityType: filter.entityType });
  if (filter.entityId) query = query.where({ entityId: filter.entityId });
  if (filter.from) query = query.where((a) => a.createdAt.gte(`${filter.from}T00:00:00Z`));
  if (filter.to) query = query.where((a) => a.createdAt.lte(`${filter.to}T23:59:59.999Z`));
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const logs = await query.select("id", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
    .orderBy([(a) => a.createdAt.desc(), (a) => a.id.desc()])
    .offset((filter.page - 1) * filter.pageSize).limit(filter.pageSize).all();
  // Redact legacy rows written before the central helper too.
  return { logs: logs.map((row) => ({ ...row, metadata: auditJson(row.metadata) })), total: count.total, page: filter.page, pageSize: filter.pageSize };
}
