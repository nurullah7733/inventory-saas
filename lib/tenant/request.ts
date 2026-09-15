import type { NextResponse } from "next/server";
import { apiError, readJsonBody, type ApiFailure } from "../api/response.ts";
import {
  findTenantInputInBody,
  findTenantInputInEnvelope,
  tenantInputMessage,
  type TenantInputRejection,
} from "./detect.ts";

export {
  findTenantInputInBody,
  findTenantInputInEnvelope,
  type TenantInputRejection,
} from "./detect.ts";

function rejectionResponse(
  rejection: TenantInputRejection,
): NextResponse<ApiFailure> {
  return apiError("FORBIDDEN", tenantInputMessage(rejection), 403);
}

export function enforceEnvelopeHasNoTenantInput(
  request: Request,
): NextResponse<ApiFailure> | null {
  const rejection = findTenantInputInEnvelope(request);
  return rejection ? rejectionResponse(rejection) : null;
}

export async function readTenantSafeJsonBody(
  request: Request,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse<ApiFailure> }
> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed;

  const rejection = findTenantInputInBody(parsed.value);
  if (rejection) {
    return { ok: false, response: rejectionResponse(rejection) };
  }
  return parsed;
}
