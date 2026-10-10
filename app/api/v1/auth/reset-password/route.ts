import { withPublicRoute } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import { clientIp } from "@/lib/api/rate-limit.ts";
import { resetPasswordSchema } from "@/lib/auth/password-reset-schema.ts";
import { recoveryRate, resetPassword } from "@/lib/auth/password-reset.ts";

export const POST = withPublicRoute(async (request) => {
  if (!await recoveryRate(`consume-ip:${clientIp(request.headers)}`, 20, 900)) return apiError("RATE_LIMITED", "Too many reset attempts. Please try again later.", 429);
  const body = await readTenantSafeJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = resetPasswordSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  if (!await resetPassword(parsed.data.token, parsed.data.newPassword)) return apiError("INVALID_RESET_TOKEN", "This reset link is invalid, expired or already used. Request a new link.", 422);
  const response = apiSuccess({ passwordReset: true });
  response.headers.set("Cache-Control", "no-store"); return response;
});
