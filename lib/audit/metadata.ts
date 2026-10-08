import type { JsonValue } from "@prisma/orm-framework/contract/types";

const secretKey = /(?:password(?:hash)?|^pin$|pinhash|token(?:hash)?|authorization|cookie|secret(?:key)?|apikey|signedurl)$/i;

/** Recursively normalize JSON and redact credential fields before persistence. */
export function auditJson(value: unknown, depth = 0): JsonValue {
  if (depth > 30) throw new Error("Audit metadata is too deeply nested.");
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => auditJson(v, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = key.replace(/[^a-z0-9]/gi, "");
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      // defineProperty avoids special __proto__ keys changing the output prototype.
      Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true,
        value: secretKey.test(normalized) ? "[REDACTED]" : auditJson(item, depth + 1) });
    }
    return result;
  }
  throw new Error("Audit metadata must contain JSON values.");
}

export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changed: string[] = [];
  const beforeDiff: Record<string, JsonValue> = {}, afterDiff: Record<string, JsonValue> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const from = auditJson(before[key]), to = auditJson(after[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changed.push(key); beforeDiff[key] = from; afterDiff[key] = to;
  }
  return { changed, before: beforeDiff, after: afterDiff };
}
