import {
  apiSuccess,
  readJsonBody,
  validationError,
} from "@/lib/api/response.ts";
import { withPublicRoute } from "@/lib/api/guard.ts";
import { logoutSchema } from "@/lib/auth/schemas.ts";
import {
  findActiveSession,
  revokeAllUserSessions,
  revokeSession,
} from "@/lib/auth/session.ts";

export const POST = withPublicRoute(async (request: Request) => {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = logoutSchema.safeParse(body.value);
  if (!parsed.success) return validationError(parsed.error);

  const lookup = await findActiveSession(parsed.data.refreshToken);
  if (lookup.ok) {
    if (parsed.data.allDevices) {
      await revokeAllUserSessions(lookup.session.userId);
    } else {
      await revokeSession(lookup.session.id);
    }
  }

  return apiSuccess({ signedOut: true });
});
