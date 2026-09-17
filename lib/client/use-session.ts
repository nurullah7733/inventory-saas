"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AuthSessionPayload } from "../auth/payload.ts";
import { apiRequest } from "./api.ts";
import {
  clearSession,
  getServerSessionSnapshot,
  getSessionSnapshot,
  readSession,
  storeSession,
  subscribeToSession,
  type StoredSession,
} from "./session.ts";
export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

function subscribe(onChange: () => void): () => void {
  return subscribeToSession(() => onChange());
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function useSession(): {
  status: SessionStatus;
  session: StoredSession | null;
} {
  const hydrated = useHydrated();
  const session = useSyncExternalStore(
    subscribe,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );

  if (!hydrated) return { status: "loading", session: null };
  return {
    status: session ? "authenticated" : "unauthenticated",
    session,
  };
}

/** Redirect to `/login` once we are certain there is no session. */
export function useRequireSession(): ReturnType<typeof useSession> {
  const router = useRouter();
  const state = useSession();

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  return state;
}

export function useSignIn() {
  return useCallback(async (input: { email: string; password: string }) => {
    const payload = await apiRequest<AuthSessionPayload>("/auth/login", {
      method: "POST",
      body: input,
      anonymous: true,
    });
    storeSession(payload);
    return payload;
  }, []);
}

export function useSignOut() {
  const router = useRouter();

  return useCallback(async () => {
    const current = readSession();
    if (current) {
      // Best effort: revoking the refresh token server-side is what actually
      // ends the session, but a network failure must not strand the user in a
      // signed-in-looking UI they cannot use.
      await apiRequest("/auth/logout", {
        method: "POST",
        body: { refreshToken: current.refreshToken },
        anonymous: true,
      }).catch(() => undefined);
    }
    clearSession();
    router.replace("/login");
  }, [router]);
}
