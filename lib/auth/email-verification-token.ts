import { createHash } from "node:crypto";

export const verificationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const verificationTokenValid = (hash: string | null, expires: string | null, token: string, now = Date.now()) =>
  Boolean(hash && expires && verificationHash(token) === hash && Date.parse(expires) > now);
