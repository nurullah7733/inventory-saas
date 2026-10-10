import assert from "node:assert/strict";
import { profileDetailsSchema, profilePatchSchema, isOwnProfilePhoto } from "../lib/profile/schema.ts";
import { storeSession, readSession, readAccessToken, subscribeToSession, updateSessionUser, clearSession } from "../lib/client/session.ts";
import { visibleNavigation } from "../lib/client/navigation.ts";

assert.deepEqual(profileDetailsSchema.parse({ name: " Owner ", email: "OWNER@EXAMPLE.COM " }), { name: "Owner", email: "owner@example.com" });
for (const patch of [{}, { name: " " }, { email: "invalid" }, { emailVerifiedAt: new Date().toISOString() }, { pendingEmail: "bypass@example.com" }, { verificationTokenHash: "secret" }, { role: "shop_owner" }, { tenantId: "other" }, { isActive: true }, { passwordHash: "secret" }, { id: "other" }, { photoUrl: "javascript:alert(1)" }]) {
  assert.equal(profilePatchSchema.safeParse(patch).success, false, JSON.stringify(patch));
}
assert.equal(profilePatchSchema.safeParse({ photoUrl: null }).success, true);
const tenant = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222";
const key = `tenants/${tenant}/profile/${userId}/33333333-3333-4333-8333-333333333333.png`;
const origin = "http://localhost:3000";
assert.equal(isOwnProfilePhoto(`${origin}/media/${key}`, tenant, userId, origin), true);
assert.equal(isOwnProfilePhoto(`https://test.public.blob.vercel-storage.com/${key}`, tenant, userId, origin), true);
for (const url of [`https://example.com/${key}`, `${origin}/media/${key}?other=1`, `${origin}/media/${key.replace(userId, tenant)}`, `${origin}/media/${key.replace("profile", "logo")}`, `${origin}/media/${key.replace(".png", ".svg")}`, "not-a-url"]) {
  assert.equal(isOwnProfilePhoto(url, tenant, userId, origin), false, url);
}
assert.equal(isOwnProfilePhoto(`${origin}/media/${key}`, null, userId, origin), false);
for (const role of ["shop_owner", "manager", "staff"] as const) {
  const settings = visibleNavigation(role).find((item) => item.label === "Settings");
  assert.equal(settings?.children?.some((item) => item.href === "/settings/profile"), true);
  if (role === "staff") assert.deepEqual(settings?.children?.map((item) => item.href), ["/settings/profile"]);
}
const user = { id: userId, name: "Before", email: "before@example.com", role: "staff" as const, tenantId: tenant, pinEnabled: false, photoUrl: null };
storeSession({ user, tenant: null, tokens: { accessToken: "access", expiresIn: 900, tokenType: "Bearer", refreshToken: "refresh", refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() } });
let notifications = 0;
const unsubscribe = subscribeToSession(() => notifications++);
updateSessionUser({ ...user, name: "After", email: "after@example.com", photoUrl: `${origin}/media/${key}` });
assert.equal(readSession()?.user.name, "After");
assert.equal(readSession()?.refreshToken, "refresh");
assert.equal(readAccessToken(), "access");
assert.equal(notifications, 1);
updateSessionUser({ ...user, id: tenant });
assert.equal(readSession()?.user.name, "After");
assert.equal(notifications, 1);
unsubscribe(); clearSession();
console.log("Profile validation, photo ownership, navigation and session synchronization tests passed.");
