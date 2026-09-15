import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "../../prisma/db.ts";

export type RlsSession = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RlsMode = { kind: "tenant"; tenantId: string } | { kind: "bypass" };

interface RlsContext {
  /** Mutable: a request session starts in bypass and narrows to its tenant. */
  mode: RlsMode;
  readonly session: RlsSession;
}

const store = new AsyncLocalStorage<RlsContext>();

/** Postgres setting names. Kept in one place — the policies name them too. */
const TENANT_SETTING = "app.tenant_id";
const BYPASS_SETTING = "app.bypass_rls";

function applySetting(
  session: RlsSession,
  name: string,
  value: string,
): Promise<unknown> {
  // `SET LOCAL` cannot take a bind parameter; `set_config(..., true)` is the
  // same thing as a function call, so the value stays a parameter and never
  // reaches the database as concatenated SQL.
  const plan = db.raw.sql`SELECT set_config(${name}, ${value}, true)`
    .affectedCount()
    .build();

  return session.execute(plan);
}

async function runInSession<T>(
  mode: RlsMode,
  fn: (session: RlsSession) => PromiseLike<T>,
): Promise<T> {
  return db.transaction(async (session) => {
    if (mode.kind === "tenant") {
      await applySetting(session, TENANT_SETTING, mode.tenantId);
    } else {
      await applySetting(session, BYPASS_SETTING, "on");
    }

    return store.run({ mode, session }, () => fn(session));
  });
}

export function withTenantRls<T>(
  tenantId: string,
  fn: (session: RlsSession) => PromiseLike<T>,
): Promise<T> {
  return runInSession({ kind: "tenant", tenantId }, fn);
}

export function withRlsBypass<T>(
  fn: (session: RlsSession) => PromiseLike<T>,
): Promise<T> {
  return runInSession({ kind: "bypass" }, fn);
}

export function rlsDb(): RlsSession {
  const context = store.getStore();
  if (!context) {
    throw new Error(
      "No RLS session. Database access must run inside withTenantRls() or " +
        "withRlsBypass() so Postgres knows which tenant the request belongs to.",
    );
  }
  return context.session;
}

/** Handle on an open request session, handed to the API guards. */
export interface RequestRlsSession {
  readonly session: RlsSession;

  pinToTenant(tenantId: string): Promise<void>;
}

export function withRequestRls<T>(
  fn: (rls: RequestRlsSession) => PromiseLike<T>,
): Promise<T> {
  return db.transaction(async (session) => {
    await applySetting(session, BYPASS_SETTING, "on");

    const context: RlsContext = { mode: { kind: "bypass" }, session };

    const rls: RequestRlsSession = {
      session,
      async pinToTenant(tenantId) {
        await applySetting(session, BYPASS_SETTING, "off");
        await applySetting(session, TENANT_SETTING, tenantId);
        context.mode = { kind: "tenant", tenantId };
      },
    };

    return store.run(context, () => fn(rls));
  });
}

export const rawSql: typeof db.raw.sql = (strings, ...values) =>
  db.raw.sql(strings, ...values);

/** The active session's mode, or null outside a session. Useful in tests. */
export function currentRlsMode(): RlsMode | null {
  return store.getStore()?.mode ?? null;
}

/** The tenant the current session is pinned to, or null under a bypass. */
export function currentRlsTenantId(): string | null {
  const mode = store.getStore()?.mode;
  return mode?.kind === "tenant" ? mode.tenantId : null;
}
