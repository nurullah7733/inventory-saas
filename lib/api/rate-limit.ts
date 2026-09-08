interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — sent as `Retry-After` on a 429. */
  retryAfter: number;
}

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    const resetAt = now + rule.windowSeconds * 1000;
    windows.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: rule.limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > rule.limit) {
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: rule.limit - existing.count, retryAfter };
}

/** Clear a key's window after a successful attempt, so a user who mistypes a
 *  password twice and then gets it right is not still counted against. */
export function reset(key: string): void {
  windows.delete(key);
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export const AUTH_RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 15 * 60 },
  signup: { limit: 5, windowSeconds: 60 * 60 },
  pinUnlock: { limit: 10, windowSeconds: 15 * 60 },
  refresh: { limit: 60, windowSeconds: 15 * 60 },
  changePassword: { limit: 10, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;
