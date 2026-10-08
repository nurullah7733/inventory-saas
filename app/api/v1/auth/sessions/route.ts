import { withAuth } from "@/lib/api/guard.ts";
import { recordAudit } from "@/lib/audit/log.ts";
import { apiSuccess } from "@/lib/api/response.ts";
import type { AuthContext } from "@/lib/auth/context.ts";
import {
  listActiveSessions,
  revokeAllUserSessions,
} from "@/lib/auth/session.ts";

export const GET = withAuth(
  async (_request: Request, auth: AuthContext) => {
    const sessions = await listActiveSessions(auth.user.id);
    return apiSuccess({
      sessions: sessions.map((session) => ({
        ...session,
        // Lets the UI label one row "this device" without exposing tokens.
        current: session.id === auth.sessionId,
      })),
    });
  },
  { verifySession: true },
);

export const DELETE = withAuth(
  async (_request: Request, auth: AuthContext) => {
    const count = await revokeAllUserSessions(auth.user.id);
    await recordAudit({ tenantId: auth.user.tenantId, userId: auth.user.id,
      action: "auth.sessions.revoke", entityType: "user", entityId: auth.user.id,
      metadata: { sessionsRevoked: count } });
    return apiSuccess({ signedOut: true });
  },
  { verifySession: true },
);
