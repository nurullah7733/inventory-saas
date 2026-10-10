import assert from "node:assert/strict";
import { passwordChangeFormSchema, pinEnableFormSchema, safeAccountDestination } from "../lib/auth/security-ui.ts";
import { storeSession, clearSession, readSession, readAccessToken, lockSession, replaceSessionTokens } from "../lib/client/session.ts";
import { ApiClientError, apiRequest } from "../lib/client/api.ts";
import { changeAccountPassword, setAccountPin, unlockWithPin } from "../lib/client/account-security.ts";
import type { AuthSessionPayload } from "../lib/auth/payload.ts";

const password = { currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password", revokeOtherSessions: true };
assert.equal(passwordChangeFormSchema.safeParse(password).success, true);
for (const patch of [{ currentPassword: "" }, { newPassword: "short" }, { confirmPassword: "different" }, { newPassword: "old-password", confirmPassword: "old-password" }])
  assert.equal(passwordChangeFormSchema.safeParse({ ...password, ...patch }).success, false);
for (const pin of ["1234", "4321", "0000", "abc1", "123", "12345"])
  assert.equal(pinEnableFormSchema.safeParse({ password: "password", pin, confirmPin: pin }).success, false);
assert.equal(pinEnableFormSchema.safeParse({ password: "password", pin: "8317", confirmPin: "8317" }).success, true);
assert.equal(pinEnableFormSchema.safeParse({ password: "password", pin: "8317", confirmPin: "8318" }).success, false);
for (const target of ["//evil.example", "/\\evil.example", "/login", "/unlock?next=/sales", "https://evil.example", "/ sales"])
  assert.equal(safeAccountDestination(target), "/dashboard");
assert.equal(safeAccountDestination("/settings/profile"), "/settings/profile");
assert.equal(safeAccountDestination("/sales", "super_admin"), "/admin");
const payload: AuthSessionPayload = {
  user: { id: "qa-user", name: "Tester", email: "test@example.com", role: "staff", tenantId: "qa-shop", pinEnabled: false, photoUrl: "https://example.com/photo.png" },
  tenant: null, tokens: { accessToken: "first-access", expiresIn: 900, tokenType: "Bearer", refreshToken: "first-refresh", refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() },
};
const tokens = { ...payload.tokens, accessToken: "new-access", refreshToken: "new-refresh" };
const originalFetch = globalThis.fetch;
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
try {
  storeSession(payload);
  assert.equal(lockSession(), false, "PIN-disabled users cannot lock");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ok: false, error: { code: "INVALID_CREDENTIALS", message: "Wrong current password." } }), { status: 401 }); };
  await assert.rejects(changeAccountPassword(password), (error: unknown) => error instanceof ApiClientError && error.code === "INVALID_CREDENTIALS");
  assert.equal(calls, 1, "wrong password must not rotate tokens or retry the mutation");
  assert.equal(readSession()?.refreshToken, "first-refresh");
  globalThis.fetch = async () => ok({ passwordChanged: true, sessionsRevoked: true, tokens });
  await changeAccountPassword(password);
  assert.equal(readAccessToken(), "new-access"); assert.equal(readSession()?.refreshToken, "new-refresh");
  assert.equal(readSession()?.user.photoUrl, payload.user.photoUrl, "token replacement preserves profile identity");
  globalThis.fetch = async () => ok({ passwordChanged: true, sessionsRevoked: false, tokens: null });
  await changeAccountPassword({ ...password, revokeOtherSessions: false });
  assert.equal(readSession()?.refreshToken, "new-refresh", "non-revoking change retains tokens");
  globalThis.fetch = async () => ok({ pinEnabled: true });
  await setAccountPin({ password: "password", pin: "8317" }, true);
  assert.equal(readSession()?.user.pinEnabled, true);
  assert.equal(lockSession(), true);
  assert.equal(readAccessToken(), null);
  globalThis.fetch = async () => { throw new Error("Locked requests must not fetch or silently refresh"); };
  await assert.rejects(apiRequest("/profile"), (error: unknown) => error instanceof ApiClientError && error.code === "UNAUTHENTICATED");
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(String(options?.body));
    assert.equal(input.refreshToken, "new-refresh"); assert.equal(input.pin, "8317");
    return ok({ ...payload, user: { ...payload.user, pinEnabled: true }, tokens: { ...tokens, refreshToken: "unlocked-refresh" } });
  };
  await unlockWithPin("8317");
  assert.equal(readSession()?.locked, undefined); assert.equal(readSession()?.refreshToken, "unlocked-refresh");
  globalThis.fetch = async () => ok({ pinEnabled: false });
  await setAccountPin({ password: "password" }, false);
  assert.equal(readSession()?.user.pinEnabled, false);

  // A refresh started before a token replacement must not overwrite it.
  storeSession({ ...payload, tokens: { ...payload.tokens, expiresIn: 0 } });
  let finishRefresh: ((value: Response) => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (url) => {
    if (url === "/api/v1/auth/refresh") { started?.(); return new Promise<Response>((resolve) => { finishRefresh = resolve; }); }
    return ok({ user: payload.user });
  };
  const pending = apiRequest("/profile");
  await ready;
  replaceSessionTokens(tokens);
  finishRefresh!(ok({ ...payload, tokens: { ...tokens, accessToken: "stale-access", refreshToken: "stale-refresh" } }));
  await pending;
  assert.equal(readAccessToken(), "new-access"); assert.equal(readSession()?.refreshToken, "new-refresh");
  // A rotation already in flight may update the stored device token, but it
  // must preserve the lock and must not send the queued protected request.
  storeSession({ ...payload, user: { ...payload.user, pinEnabled: true }, tokens: { ...payload.tokens, expiresIn: 0 } });
  const lockReady = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (url) => {
    if (url === "/api/v1/auth/refresh") { started?.(); return new Promise<Response>((resolve) => { finishRefresh = resolve; }); }
    throw new Error("Queued protected request must stop after locking");
  };
  const lockedRequest = assert.rejects(apiRequest("/profile"), (error: unknown) => error instanceof ApiClientError && error.code === "UNAUTHENTICATED");
  await lockReady;
  assert.equal(lockSession(), true);
  finishRefresh!(ok({ ...payload, user: { ...payload.user, pinEnabled: true }, tokens: { ...tokens, refreshToken: "rotated-locked-refresh" } }));
  await lockedRequest;
  assert.equal(readSession()?.locked, true);
  assert.equal(readSession()?.refreshToken, "rotated-locked-refresh");
  assert.equal(readAccessToken(), null);
  clearSession();
  assert.equal(readSession(), null); assert.equal(readAccessToken(), null);
  console.log("Account security validation, token replacement, lock, PIN unlock, credential error and refresh-race tests passed.");
} finally { globalThis.fetch = originalFetch; clearSession(); }
