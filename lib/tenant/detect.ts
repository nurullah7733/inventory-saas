export const TENANT_KEYS = [
  "tenant_id",
  "tenantId",
  "tenantID",
  "tenant",
  "shop_id",
  "shopId",
] as const;

export const RESERVED_HEADERS = [
  "x-tenant-id",
  "x-user-id",
  "x-user-role",
] as const;

export interface TenantInputRejection {
  source: "query" | "header" | "body";
  key: string;
}

export function findTenantInputInEnvelope(
  request: Request,
): TenantInputRejection | null {
  const url = new URL(request.url);
  for (const key of TENANT_KEYS) {
    if (url.searchParams.has(key)) return { source: "query", key };
  }
  for (const header of RESERVED_HEADERS) {
    if (request.headers.has(header)) return { source: "header", key: header };
  }
  return null;
}

/** Scan an already-parsed JSON body's top level. */
export function findTenantInputInBody(
  body: unknown,
): TenantInputRejection | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of TENANT_KEYS) {
    if (Object.hasOwn(body, key)) return { source: "body", key };
  }
  return null;
}

export function tenantInputMessage(rejection: TenantInputRejection): string {
  return (
    `The tenant is taken from your access token and cannot be set per request. ` +
    `Remove "${rejection.key}" from the request ${rejection.source}.`
  );
}
