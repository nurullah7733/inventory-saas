import { withPublicRoute } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { clientIp } from "@/lib/api/rate-limit.ts";
import { forgotPasswordSchema, RESET_REQUEST_MESSAGE } from "@/lib/auth/password-reset-schema.ts";
import { recoveryRate, requestPasswordReset } from "@/lib/auth/password-reset.ts";

export const POST = withPublicRoute(async (request) => {
  if (!await recoveryRate(`request-ip:${clientIp(request.headers)}`, 20, 3600)) return apiError("RATE_LIMITED", "Too many requests. Please try again later.", 429);
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = forgotPasswordSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  const allowed = await recoveryRate(`request-email:${parsed.data.email}`, 5, 3600);
  const cooldown = await recoveryRate(`request-cooldown:${parsed.data.email}`, 1, 60);
  // Same response for unknown, disabled, suspended, cooldown and delivery errors.
  if (allowed && cooldown) await requestPasswordReset(parsed.data.email);
  const response = apiSuccess({ message: RESET_REQUEST_MESSAGE });
  response.headers.set("Cache-Control", "no-store"); return response;
});
