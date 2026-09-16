import type { ApiErrorCode, ApiResponseBody } from "../api/response.ts";
import type { AuthSessionPayload } from "../auth/payload.ts";
import {
  clearSession,
  readAccessToken,
  readSession,
  storeSession,
} from "./session.ts";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | "NETWORK_ERROR";
  readonly status: number;
  /** Per-field messages from Zod, keyed by field path. */
  readonly details?: Record<string, string[]>;

  constructor(
    code: ApiErrorCode | "NETWORK_ERROR",
    message: string,
    status: number,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Refresh tokens ROTATE, and the refresh route treats a second use of an
 * already-rotated token as theft: it revokes every session the user has. Two
 * components mounting at once and each refreshing would therefore log the user
 * out of all their devices — so all callers share one in-flight refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function requestFreshAccessToken(): Promise<string | null> {
  const session = readSession();
  if (!session) return null;

  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  const body = (await response
    .json()
    .catch(() => null)) as ApiResponseBody<AuthSessionPayload> | null;

  if (!response.ok || !body?.ok) {
    // The refresh token is spent, revoked or expired. Nothing to recover.
    clearSession();
    return null;
  }

  storeSession(body.data);
  return readAccessToken();
}

async function accessTokenForRequest(): Promise<string | null> {
  const current = readAccessToken();
  if (current) return current;

  refreshInFlight ??= requestFreshAccessToken().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Skip the bearer token — for login / signup / refresh themselves. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, anonymous = false, signal } = options;

  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    return fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let response: Response;
  try {
    const token = anonymous ? null : await accessTokenForRequest();
    response = await send(token);

    // The access token was accepted by our own clock but refused by the
    // server's — a clock skew, or a session revoked from another device. One
    // retry with a genuinely fresh token, then give up.
    if (response.status === 401 && !anonymous) {
      const refreshed = await (refreshInFlight ??=
        requestFreshAccessToken().finally(() => {
          refreshInFlight = null;
        }));
      if (refreshed) response = await send(refreshed);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiClientError(
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ApiResponseBody<T> | null;

  if (!payload) {
    throw new ApiClientError(
      "INTERNAL_ERROR",
      "The server returned an unreadable response.",
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ApiClientError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }

  return payload.data;
}
