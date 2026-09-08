/**
 * Validated access to the server-side environment.
 *
 * Every value is read through a lazy, memoised getter rather than at module
 * load. Next.js evaluates modules during `next build` (route collection,
 * prerendering) where secrets are often absent, so a top-level
 * `process.env.X!` would turn a missing variable into a build failure instead
 * of a clear runtime error on the first request that actually needs it.
 */

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function memoise<T>(load: () => T): () => T {
  let cached: { value: T } | undefined;
  return () => (cached ??= { value: load() }).value;
}

/**
 * HMAC key for signing access tokens (HS256 via `jose`).
 *
 * Rejected below 32 characters: HS256's security rests entirely on the
 * secret's entropy, and a short human-chosen string is brute-forceable
 * offline from any single captured token. Generate one with
 * `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
 */
export const jwtSecret = memoise((): Uint8Array => {
  const secret = readRequired("JWT_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  return new TextEncoder().encode(secret);
});

/** `iss` / `aud` claims. Constant per deployment, so tokens minted for one
 *  environment are rejected by another even if a secret is copied across. */
export const jwtIssuer = memoise(() => process.env.JWT_ISSUER ?? "inventory-saas");
export const jwtAudience = memoise(() => process.env.JWT_AUDIENCE ?? "inventory-saas-api");

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

/**
 * Access tokens are deliberately short-lived. They are stateless — nothing
 * revokes one mid-flight — so their lifetime is the worst-case window during
 * which a deactivated user or a suspended tenant could still be let in by the
 * signature alone. Fifteen minutes keeps that window small while sparing
 * clients a refresh round-trip on every call.
 */
export const accessTokenTtlSeconds = memoise(() => readIntEnv("ACCESS_TOKEN_TTL_SECONDS", 15 * 60));

/** Refresh tokens are stored (hashed) and revocable, so they can live long
 *  enough that a phone stays logged in between visits to the shop. */
export const refreshTokenTtlSeconds = memoise(() =>
  readIntEnv("REFRESH_TOKEN_TTL_SECONDS", 30 * 24 * 60 * 60),
);

/** bcrypt work factor. 12 is ~250ms on current hardware — high enough to make
 *  offline cracking expensive, low enough not to stall a serverless request. */
export const bcryptRounds = memoise(() => readIntEnv("BCRYPT_ROUNDS", 12));
