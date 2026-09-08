import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const REFRESH_TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function generateOpaqueId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}
