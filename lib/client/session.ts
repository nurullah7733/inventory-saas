import type {
  AuthSessionPayload,
  AuthTenantPayload,
  AuthUserPayload,
} from "../auth/payload.ts";

const STORAGE_KEY = "inventory-saas.session";
const SESSION_HINT_COOKIE = "has_session";

export interface StoredSession {
  user: AuthUserPayload;
  tenant: AuthTenantPayload | null;
  refreshToken: string;
  refreshExpiresAt: string;
  locked?: boolean;
}

//  Access token + the wall-clock time it stops being usable.
interface AccessToken {
  value: string;
  expiresAt: number;
}

let accessToken: AccessToken | null = null;

let snapshot: StoredSession | null | undefined;

type Listener = (session: StoredSession | null) => void;
const listeners = new Set<Listener>();

function browser(): boolean {
  return typeof window !== "undefined";
}

function setSessionHintCookie(present: boolean): void {
  if (!browser()) return;
  document.cookie = present
    ? `${SESSION_HINT_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    : `${SESSION_HINT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function loadSession(): StoredSession | null {
  if (!browser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.refreshToken) return null;
    if (Date.parse(parsed.refreshExpiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The current session, reading localStorage once and then serving the cache. */
export function readSession(): StoredSession | null {
  if (snapshot === undefined) snapshot = loadSession();
  return snapshot;
}

export const getSessionSnapshot = readSession;

export function getServerSessionSnapshot(): StoredSession | null {
  return null;
}

/** Persist the payload every auth endpoint returns (login, refresh, unlock). */
export function storeSession(payload: AuthSessionPayload, options: { locked?: boolean } = {}): StoredSession {
  const session: StoredSession = {
    user: payload.user,
    tenant: payload.tenant,
    refreshToken: payload.tokens.refreshToken,
    refreshExpiresAt: payload.tokens.refreshExpiresAt,
    ...(options.locked ? { locked: true } : {}),
  };

  if (browser()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setSessionHintCookie(true);
    setLockHintCookie(!!session.locked);
  }
  snapshot = session;

  accessToken = session.locked ? null : {
    value: payload.tokens.accessToken,
    // 15 seconds of slack so a token that expires mid-flight is refreshed
    // before it is sent, not after the server has already refused it.
    expiresAt: Date.now() + payload.tokens.expiresIn * 1000 - 15_000,
  };

  for (const listener of listeners) listener(session);
  return session;
}

export function clearSession(): void {
  accessToken = null;
  snapshot = null;
  if (browser()) {
    window.localStorage.removeItem(STORAGE_KEY);
    setSessionHintCookie(false);
    setLockHintCookie(false);
  }
  for (const listener of listeners) listener(null);
}

/** Update identity after a profile save without rotating or replacing tokens. */
export function updateSessionUser(user: AuthUserPayload): void {
  const current = readSession();
  if (!current || current.user.id !== user.id) return;
  const next = { ...current, user };
  if (browser()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  snapshot = next;
  for (const listener of listeners) listener(next);
}

export function readAccessToken(): string | null {
  if (readSession()?.locked) return null;
  if (!accessToken) return null;
  if (accessToken.expiresAt <= Date.now()) return null;
  return accessToken.value;
}

function setLockHintCookie(locked: boolean): void {
  if (!browser()) return;
  document.cookie = locked
    ? "session_locked=1; Path=/; SameSite=Lax; Max-Age=2592000"
    : "session_locked=; Path=/; SameSite=Lax; Max-Age=0";
}

/** PIN is device unlock: keep the refresh session, but stop automatic access. */
export function lockSession(): boolean {
  const current = readSession();
  if (!current?.user.pinEnabled || Date.parse(current.refreshExpiresAt) <= Date.now()) return false;
  const next = { ...current, locked: true };
  if (browser()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  snapshot = next;
  accessToken = null;
  setLockHintCookie(true);
  for (const listener of listeners) listener(next);
  return true;
}

export function replaceSessionTokens(tokens: AuthSessionPayload["tokens"]): void {
  const current = readSession();
  if (!current) throw new Error("Sign in again to continue.");
  storeSession({ user: current.user, tenant: current.tenant, tokens }, { locked: current.locked });
}

/** Subscribe to sign-in / sign-out, for the header and the auth guard. */
export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
