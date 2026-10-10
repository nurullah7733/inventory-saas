import { withAuth } from "@/lib/api/guard.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import { sendVerification } from "@/lib/auth/email-verification.ts";

export const POST = withAuth(async (_request, auth) => {
  await sendVerification(auth.user.id);
  const response = apiSuccess({ sent: true });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
