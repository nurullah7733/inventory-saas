import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { verificationHash, verificationTokenValid } from "../lib/auth/email-verification-token.ts";
import { deliverEmail } from "../lib/email/delivery.ts";

const token = randomBytes(32).toString("hex"), now = Date.now();
const hash = verificationHash(token);
assert.notEqual(hash, token);
assert.equal(hash.length, 64);
assert.equal(verificationTokenValid(hash, new Date(now + 1000).toISOString(), token, now), true);
assert.equal(verificationTokenValid(hash, new Date(now).toISOString(), token, now), false);
assert.equal(verificationTokenValid(hash, new Date(now - 1).toISOString(), token, now), false);
assert.equal(verificationTokenValid(hash, new Date(now + 1000).toISOString(), "wrong-token", now), false);
assert.equal(verificationTokenValid(null, new Date(now + 1000).toISOString(), token, now), false);
assert.equal(verificationTokenValid(hash, null, token, now), false);
assert.equal(verificationTokenValid(hash, "invalid-date", token, now), false);
const saved = { NODE_ENV: process.env.NODE_ENV, EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT, RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
const originalFetch = globalThis.fetch;
try {
  Object.assign(process.env, { NODE_ENV: "production", EMAIL_TRANSPORT: "file" });
  await assert.rejects(deliverEmail({ to: ["test@example.com"], subject: "Verify", text: "Test" }, "email-unit"), { code: "EMAIL_UNAVAILABLE" });
  Object.assign(process.env, { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "", EMAIL_FROM: "" });
  await assert.rejects(deliverEmail({ to: ["test@example.com"], subject: "Verify", text: "Test" }, "email-unit"), { code: "EMAIL_UNAVAILABLE" });
  Object.assign(process.env, { RESEND_API_KEY: "unit-test-key", EMAIL_FROM: "Inventory <verify@example.com>" });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer unit-test-key");
    assert.equal(JSON.parse(String(options?.body)).from, process.env.EMAIL_FROM);
    return new Response("{}", { status: 200 });
  };
  await deliverEmail({ to: ["test@example.com"], subject: "Verify", text: "Test" }, "email-unit");
  globalThis.fetch = async () => new Response("provider failure", { status: 500 });
  await assert.rejects(deliverEmail({ to: ["test@example.com"], subject: "Verify", text: "Test" }, "email-unit"), { code: "EMAIL_UNAVAILABLE" });
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
console.log("Email verification hashing, expiration, consumed-token and delivery configuration tests passed.");
