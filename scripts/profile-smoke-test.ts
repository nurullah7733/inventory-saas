import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { localUploadRoot } from "../lib/storage/images.ts";
import type { UserRole } from "../lib/auth/roles.ts";
import { localVerificationToken } from "./email-test-helpers.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [], uploaded: string[] = [];
const emailUsers: string[] = [];
const password = "Profile-QA-password";
let checks = 0;
async function call(route: string, token?: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await response.json().catch(() => ({}));
  return { status: response.status, data: result.data, error: result.error };
}
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); }
async function fixture(role: UserRole) {
  const passwordHash = await hashPassword(password);
  return withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: "Profile QA", email: "profile-qa@example.com", vatPercentage: numeric("0.00") });
    tenants.push(tenant.id);
    const user = await tx.orm.public.User.select("id", "name", "email", "role", "tenantId").create({ tenantId: tenant.id, name: "Profile QA User", email: `${randomUUID()}@example.com`, role, passwordHash });
    const session = await issueSession({ userId: user.id, tenantId: tenant.id, deviceId: "profile-smoke" });
    const access = await signAccessToken({ userId: user.id, tenantId: tenant.id, role, sessionId: session.sessionId });
    return { tenant, user, session, token: access.token };
  });
}
async function upload(token: string, purpose: string, image = true) {
  const form = new FormData(); form.set("purpose", purpose);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  form.set("file", new Blob([image ? png : Buffer.from("not an image")], { type: "image/png" }), "photo.png");
  const response = await call("/uploads/images", token, form);
  if (response.status === 201) uploaded.push(response.data.image.url);
  return response;
}
async function main() {
  try {
    const a = await fixture("shop_owner"), b = await fixture("staff"), c = await fixture("manager");
    equal((await call("/profile")).status, 401, "anonymous profile denied");
    equal((await call("/profile", a.token)).data.user.id, a.user.id, "profile resolves signed-in account");
    equal((await call("/profile", b.token)).status, 200, "staff can read own profile");
    equal((await call("/profile", c.token, { name: "Manager updated" }, "PATCH")).status, 200, "manager can update own profile");
    for (const patch of [{ role: "super_admin" }, { isActive: false }, { id: b.user.id }, { pinEnabled: true }, {}])
      equal((await call("/profile", a.token, patch, "PATCH")).status, 422, "protected or empty fields rejected");
    equal((await call("/profile", a.token, { tenantId: b.tenant.id }, "PATCH")).status, 403, "tenant reassignment rejected");
    equal((await call(`/profile?tenant_id=${b.tenant.id}`, a.token)).status, 403, "tenant query spoof rejected");
    equal((await call("/profile", a.token, { email: b.user.email.toUpperCase() }, "PATCH")).error.code, "EMAIL_TAKEN", "global email uniqueness across shops");
    const nextEmail = `${randomUUID()}@example.com`;
    const changed = await call("/profile", a.token, { name: " Updated Owner ", email: nextEmail.toUpperCase() }, "PATCH");
    equal(changed.status, 200, "profile saves name and email");
    equal(changed.data.user.name, "Updated Owner", "name normalized");
    equal(changed.data.user.email, a.user.email, "current email preserved until verification");
    equal(changed.data.user.pendingEmail, nextEmail, "pending email normalized");
    equal((await call("/auth/email-verification/verify", undefined, { token: await localVerificationToken(a.user.id) })).status, 200, "email change verified");
    equal(changed.data.user.role, "shop_owner", "role unchanged");
    equal(changed.data.user.tenantId, a.tenant.id, "shop unchanged");
    equal(Object.keys(changed.data.user).some((key) => /hash|password|token/i.test(key)), false, "profile contains no credentials");
    equal((await call("/auth/me", a.token)).data.user.name, "Updated Owner", "current user updated immediately");
    equal((await call("/tenant/current", a.token)).data.viewer.name, "Updated Owner", "header data updated immediately");
    equal((await call("/profile", a.token)).data.user.email, nextEmail, "profile persists after reread");
    equal((await call("/auth/login", undefined, { email: a.user.email, password })).status, 401, "old email no longer signs in");
    equal((await call("/auth/login", undefined, { email: nextEmail, password })).status, 200, "new email signs in");
    equal((await upload(b.token, "product")).status, 403, "staff still cannot upload product images");
    equal((await upload(b.token, "logo")).status, 403, "staff still cannot upload logos");
    equal((await upload(b.token, "profile", false)).status, 422, "fake photo rejected by file signature");
    const photo = await upload(b.token, "profile");
    equal(photo.status, 201, "staff uploads own profile photo");
    const url = photo.data.image.url;
    equal(new URL(url).pathname.includes(`/profile/${b.user.id}/`), true, "photo uses account-scoped storage prefix");
    equal((await call("/profile", a.token, { photoUrl: url }, "PATCH")).status, 422, "another account photo rejected");
    equal((await call("/profile", b.token, { photoUrl: "https://example.com/image.png" }, "PATCH")).status, 422, "external URL rejected");
    equal((await call("/profile", b.token, { photoUrl: url }, "PATCH")).status, 200, "uploaded photo URL saved");
    equal((await call("/profile", b.token)).data.user.photoUrl, url, "photo URL persists");
    equal((await call("/tenant/current", b.token)).data.viewer.photoUrl, url, "header photo reads saved URL");
    equal((await fetch(url)).status, 200, "uploaded photo is served");
    const refreshed = await call("/auth/refresh", undefined, { refreshToken: b.session.refreshToken });
    equal(refreshed.data.user.photoUrl, url, "session refresh preserves photo");
    const login = await call("/auth/login", undefined, { email: b.user.email, password });
    equal(login.data.user.photoUrl, url, "login preserves photo");
    equal((await call("/profile", login.data.tokens.accessToken, { photoUrl: null }, "PATCH")).data.user.photoUrl, null, "photo removal persists");
    const audits = await withRlsBypass((tx) => tx.orm.public.AuditLog.where({ tenantId: a.tenant.id, action: "profile.update" }).select("userId", "metadata").all());
    equal(audits.length, 1, "successful change audited once");
    equal(audits[0]?.userId, a.user.id, "audit records signed-in actor");
    const concurrentEmail = `${randomUUID()}@example.com`;
    for (const id of [a.user.id, c.user.id]) await withRlsBypass((tx) => tx.orm.public.User.where({ id }).update({ verificationSentAt: null }));
    const concurrent = await Promise.all([call("/profile", a.token, { email: concurrentEmail }, "PATCH"), call("/profile", c.token, { email: concurrentEmail }, "PATCH")]);
    equal(concurrent.map((response) => response.status).sort(), [200, 200], "pending requests do not reserve emails before ownership verification");
    const verified = await Promise.all([call("/auth/email-verification/verify", undefined, { token: await localVerificationToken(a.user.id) }), call("/auth/email-verification/verify", undefined, { token: await localVerificationToken(c.user.id) })]);
    equal(verified.map((response) => response.status).sort(), [200, 409], "concurrent verification enforces global email uniqueness");
    console.log(`${checks} profile API checks passed.`);
    if (process.env.PROFILE_BROWSER_CHECK === "1") {
      const { runProfileBrowserCheck } = await import("./profile-browser-check.ts");
      const browserPhoto = await runProfileBrowserCheck(base, { user: { ...b.user, role: "staff", pinEnabled: false }, tenant: null, refreshToken: login.data.tokens.refreshToken, refreshExpiresAt: login.data.tokens.refreshExpiresAt });
      uploaded.push(browserPhoto);
    }
  } finally {
    for (const tenantId of tenants) {
      const photos = await withRlsBypass((tx) => tx.orm.public.User.where({ tenantId }).select("id", "photoUrl").all());
      emailUsers.push(...photos.map((user) => user.id));
      for (const user of photos) if (user.photoUrl) uploaded.push(user.photoUrl);
    }
    for (const url of new Set(uploaded)) {
      const parsed = new URL(url);
      const own = tenants.some((tenantId) => parsed.pathname.includes(`/tenants/${tenantId}/profile/`));
      if (!own) continue;
      if (parsed.hostname.endsWith(".public.blob.vercel-storage.com")) {
        const { del } = await import("@vercel/blob"); await del(url);
      } else if (parsed.origin === new URL(base).origin) {
        const root = localUploadRoot(), file = path.resolve(root, ...parsed.pathname.slice("/media/".length).split("/"));
        if (file.startsWith(root + path.sep)) await unlink(file);
      }
    }
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
    for (const file of await readdir(".mail").catch(() => [] as string[])) if (emailUsers.some((id) => file.startsWith(`${id}-`))) await unlink(`.mail/${file}`);
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
