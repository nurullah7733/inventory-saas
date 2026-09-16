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
}

/** Access token + the wall-clock time it stops being usable. */
interface AccessToken {
  value: string;
  expiresAt: number;
}

let accessToken: AccessToken | null = null;

/**
 * Cached snapshot of the stored session.
 *
 * `undefined` means "not read from localStorage yet". The cache is not an
 * optimisation: `useSyncExternalStore` compares snapshots by identity and
 * re-renders whenever they differ, so a `getSnapshot` that re-parsed the JSON
 * on every call would hand React a new object each time and loop forever.
 */
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
    // An expired refresh token cannot be rotated, so treat it as signed out
    // rather than sending it and collecting a 401 on first load.
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

/** Stable snapshot for `useSyncExternalStore`. Identical to `readSession()`;
 *  named separately so the React contract it satisfies is visible at the
 *  call site. */
export const getSessionSnapshot = readSession;

/** During SSR there is no localStorage, so the server always renders the
 *  signed-out shape and React re-renders once the client snapshot arrives. */
export function getServerSessionSnapshot(): StoredSession | null {
  return null;
}

/** Persist the payload every auth endpoint returns (login, refresh, unlock). */
export function storeSession(payload: AuthSessionPayload): StoredSession {
  const session: StoredSession = {
    user: payload.user,
    tenant: payload.tenant,
    refreshToken: payload.tokens.refreshToken,
    refreshExpiresAt: payload.tokens.refreshExpiresAt,
  };

  if (browser()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setSessionHintCookie(true);
  }
  snapshot = session;

  accessToken = {
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
  }
  for (const listener of listeners) listener(null);
}

export function readAccessToken(): string | null {
  if (!accessToken) return null;
  if (accessToken.expiresAt <= Date.now()) return null;
  return accessToken.value;
}

/** Subscribe to sign-in / sign-out, for the header and the auth guard. */
export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
