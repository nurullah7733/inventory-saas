import { z } from "zod";
import { withPublicRoute } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, readJsonBody, validationError } from "@/lib/api/response.ts";
import { clientIp, consume } from "@/lib/api/rate-limit.ts";
import { verifyEmail } from "@/lib/auth/email-verification.ts";
import { rlsDb, rawSql } from "@/lib/db/rls.ts";
import { verificationHash } from "@/lib/auth/email-verification.ts";

const schema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const POST = withPublicRoute(async (request) => {
  const key = verificationHash(clientIp(request.headers));
  const limit = consume(`email-verify:${key}`, { limit: 20, windowSeconds: 900 });
  if (!limit.allowed) return apiError("RATE_LIMITED", "Too many verification attempts. Please try again later.", 429);
  // Shared across processes/serverless instances; only hashed IPs are persisted.
  await rlsDb().execute(rawSql`DELETE FROM public.email_verification_rates WHERE expires_at <= now()`.affectedCount().build());
  const counter = await rlsDb().query(rawSql`INSERT INTO public.email_verification_rates (key, count, expires_at) VALUES (${key}, 1, now() + interval '15 minutes') ON CONFLICT (key) DO UPDATE SET count = email_verification_rates.count + 1 RETURNING count`.returnsRow({ count: "pg/int4@1" }).build());
  if (counter[0].count > 20) return apiError("RATE_LIMITED", "Too many verification attempts. Please try again later.", 429);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);
  if (!await verifyEmail(parsed.data.token)) return apiError("INVALID_VERIFICATION_TOKEN", "This link is invalid, expired or already used. Request a new verification email.", 422);
  const response = apiSuccess({ verified: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
});
