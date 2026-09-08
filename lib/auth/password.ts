import bcrypt from "bcryptjs";
import { bcryptRounds } from "../env.ts";

const BCRYPT_MAX_BYTES = 72;

function assertBcryptSafe(value: string, label: string): void {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > BCRYPT_MAX_BYTES) {
    throw new Error(
      `${label} must be at most ${BCRYPT_MAX_BYTES} bytes (got ${bytes}).`,
    );
  }
}

export async function hashPassword(plain: string): Promise<string> {
  assertBcryptSafe(plain, "Password");
  return bcrypt.hash(plain, bcryptRounds());
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (new TextEncoder().encode(plain).length > BCRYPT_MAX_BYTES) return false;
  return bcrypt.compare(plain, hash);
}

export const hashPin = hashPassword;
export const verifyPin = verifyPassword;

export const DUMMY_PASSWORD_HASH =
  "$2b$12$vFnG0mPaouzA08CZBaNUrev01GF.cUfrVSdzZrux5uA.QKcUDoL1y";
