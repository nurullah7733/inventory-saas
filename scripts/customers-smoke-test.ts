#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of Customers CRUD (step 8 of the build order) against a live
 * HTTP server.
 *
 *   npm run dev                 # in one terminal
 *   npm run customers:smoke     # in another
 *
 * What this checks, in order of how much it would hurt to get wrong:
 *
 *   1. One shop cannot read, change or delete another shop's customers.
 *   2. A phone is unique per shop (separators ignored), not globally.
 *   3. A customer with invoices cannot be deleted — only deactivated.
 *   4. Role rules: every role adds / edits customers; only owner and manager
 *      deactivate or delete.
 *   5. Every write lands in `audit_logs`.
 *
 * Fixtures are built directly in the database and removed at the end.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";
import type { UserRole } from "../lib/auth/roles.ts";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const API = `${BASE_URL}/api/v1`;

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

interface ApiResult {
  status: number;
  // The smoke test reads many shapes; `any` keeps the assertions readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok?: boolean; data?: any; error?: { code?: string; message?: string; details?: Record<string, string[]> } };
}

async function call(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  let body: ApiResult["body"];
  try {
    body = (await response.json()) as ApiResult["body"];
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

interface Fixture {
  tenantId: string;
  ownerId: string;
  ownerToken: string;
  managerToken: string;
  staffToken: string;
}

async function mintToken(userId: string, tenantId: string, role: UserRole): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "customers-smoke" }),
  );
  const { token } = await signAccessToken({
    userId,
    tenantId,
    role,
    sessionId: session.sessionId,
  });
  return token;
}

async function createTenant(label: string, stamp: number): Promise<Fixture> {
  const passwordHash = await hashPassword("correct-horse-battery");

  const created = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({
      name: `Customers Smoke ${label} ${stamp}`,
      email: `customers-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const users: Partial<Record<UserRole, string>> = {};
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      const user = await tx.orm.public.User.select("id").create({
        tenantId: tenant.id,
        name: `${role} ${label}`,
        email: `customers-${role}-${label}-${stamp}@example.com`,
        passwordHash,
        role,
      });
      users[role] = user.id;
    }
    return { tenantId: tenant.id, users };
  });

  const { tenantId, users } = created;
  return {
    tenantId,
    ownerId: users.shop_owner!,
    ownerToken: await mintToken(users.shop_owner!, tenantId, "shop_owner"),
    managerToken: await mintToken(users.manager!, tenantId, "manager"),
    staffToken: await mintToken(users.staff!, tenantId, "staff"),
  };
}

/** An invoice pointing at the customer — step 9 builds the real sales flow. */
async function createSale(shop: Fixture, customerId: string): Promise<void> {
  await withRlsBypass((tx) =>
    tx.orm.public.Sale.select("id").create({
      tenantId: shop.tenantId,
      customerId,
      invoiceNo: `SMOKE-${Date.now()}`,
      subtotal: numeric("100.00"),
      discount: numeric("0.00"),
      vatAmount: numeric("0.00"),
      totalAmount: numeric("100.00"),
      paidAmount: numeric("100.00"),
      soldBy: shop.ownerId,
    }),
  );
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nCustomers smoke test against ${BASE_URL}\n`);

  const a = await createTenant("a", stamp);
  const b = await createTenant("b", stamp);

  try {
    console.log("create + validation");
    const created = await call("/customers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "  Karim Hossain ", phone: "+880 1711-000 000" },
    });
    check(created.status === 201, "owner creates a customer (201)");
    const karim = created.body.data?.customer;
    check(karim?.name === "Karim Hossain", "name is trimmed");
    check(karim?.phone === "+8801711000000", "phone separators are stripped");
    check(karim?.isActive === true && karim?.saleCount === 0, "new customer is active with no invoices");

    const noPhone = await call("/customers", {
      method: "POST",
      token: a.staffToken,
      body: { name: "Walk-in Rahim" },
    });
    check(noPhone.status === 201, "staff can add a customer (201)");
    check(noPhone.body.data?.customer?.phone === null, "phone is optional");
    const rahim = noPhone.body.data?.customer;

    const secondNoPhone = await call("/customers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Walk-in Salma", phone: "" },
    });
    check(secondNoPhone.status === 201, "several customers can have no phone");
    const salma = secondNoPhone.body.data?.customer;

    const dup = await call("/customers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Someone else", phone: "+8801711000000" },
    });
    check(dup.status === 409, "same phone in the same shop is refused (409)");
    check(dup.body.error?.details?.phone?.[0]?.includes("Karim Hossain"), "409 names the owner of the phone");

    const otherShop = await call("/customers", {
      method: "POST",
      token: b.ownerToken,
      body: { name: "Karim at shop B", phone: "+8801711000000" },
    });
    check(otherShop.status === 201, "another shop can use the same phone");
    const bCustomer = otherShop.body.data?.customer;

    const invalid = await call("/customers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "", phone: "call me" },
    });
    check(invalid.status === 422, "empty name / bad phone is 422");
    check(
      invalid.body.error?.details?.name && invalid.body.error?.details?.phone,
      "422 reports both fields",
    );

    const smuggled = await call("/customers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Sneaky", tenantId: b.tenantId },
    });
    check(smuggled.status === 403 || smuggled.status === 422, "tenantId in the body is rejected");

    console.log("\nlist + search");
    const list = await call("/customers?status=all", { token: a.staffToken });
    check(list.status === 200 && list.body.data?.total === 3, "shop A lists exactly its 3 customers");
    const names = (list.body.data?.customers ?? []).map((c: { name: string }) => c.name);
    check(names.join("|") === "Karim Hossain|Walk-in Rahim|Walk-in Salma", "sorted by name");

    const byPhone = await call(`/customers?search=${encodeURIComponent("1711-000")}`, { token: a.ownerToken });
    check(
      byPhone.body.data?.total === 1 && byPhone.body.data?.customers[0]?.id === karim?.id,
      "search by phone ignores dashes",
    );
    const byName = await call("/customers?search=walk", { token: a.ownerToken });
    check(byName.body.data?.total === 2, "search by name is case-insensitive");

    const paged = await call("/customers?pageSize=2&page=2", { token: a.ownerToken });
    check(
      paged.body.data?.customers?.length === 1 && paged.body.data?.total === 3,
      "pagination returns the last page",
    );
    const badStatus = await call("/customers?status=gone", { token: a.ownerToken });
    check(badStatus.status === 422, "unknown status is 422");

    console.log("\ntenant isolation");
    check((await call(`/customers/${karim?.id}`, { token: b.ownerToken })).status === 404, "shop B cannot read shop A's customer");
    check(
      (await call(`/customers/${karim?.id}`, { method: "PATCH", token: b.ownerToken, body: { name: "Hacked" } })).status === 404,
      "shop B cannot edit shop A's customer",
    );
    check(
      (await call(`/customers/${karim?.id}`, { method: "DELETE", token: b.ownerToken })).status === 404,
      "shop B cannot delete shop A's customer",
    );
    check((await call("/customers/not-a-uuid", { token: a.ownerToken })).status === 404, "malformed id is 404");

    console.log("\nedit + roles");
    const staffEdit = await call(`/customers/${rahim?.id}`, {
      method: "PATCH",
      token: a.staffToken,
      body: { phone: "01811 222333" },
    });
    check(staffEdit.status === 200 && staffEdit.body.data?.customer?.phone === "01811222333", "staff can edit name / phone");

    const takenOnEdit = await call(`/customers/${salma?.id}`, {
      method: "PATCH",
      token: a.ownerToken,
      body: { phone: "018-1122-2333" },
    });
    check(takenOnEdit.status === 409, "editing to a taken phone is 409");

    const staffDeactivate = await call(`/customers/${rahim?.id}`, {
      method: "PATCH",
      token: a.staffToken,
      body: { isActive: false },
    });
    check(staffDeactivate.status === 403, "staff cannot deactivate (403)");
    const staffDelete = await call(`/customers/${salma?.id}`, { method: "DELETE", token: a.staffToken });
    check(staffDelete.status === 403, "staff cannot delete (403)");

    const noop = await call(`/customers/${karim?.id}`, {
      method: "PATCH",
      token: a.ownerToken,
      body: { name: "Karim Hossain" },
    });
    check(noop.status === 200 && noop.body.data?.changed?.length === 0, "unchanged patch is a no-op");

    console.log("\ndelete rules");
    await createSale(a, karim!.id);
    const withSale = await call(`/customers/${karim?.id}`, { token: a.ownerToken });
    check(withSale.body.data?.customer?.saleCount === 1, "saleCount counts the invoice");

    const blocked = await call(`/customers/${karim?.id}`, { method: "DELETE", token: a.ownerToken });
    check(blocked.status === 409, "customer with an invoice cannot be deleted (409)");
    check(blocked.body.error?.message?.includes("1 invoice"), "409 says how many invoices are in the way");

    const deactivated = await call(`/customers/${karim?.id}`, {
      method: "PATCH",
      token: a.managerToken,
      body: { isActive: false },
    });
    check(deactivated.status === 200 && deactivated.body.data?.customer?.isActive === false, "manager deactivates instead");

    const active = await call("/customers?status=active", { token: a.ownerToken });
    check(
      !(active.body.data?.customers ?? []).some((c: { id: string }) => c.id === karim?.id),
      "inactive customer is left out of ?status=active",
    );

    const removed = await call(`/customers/${salma?.id}`, { method: "DELETE", token: a.managerToken });
    check(removed.status === 200 && removed.body.data?.deleted?.id === salma?.id, "customer without invoices is deleted");
    check((await call(`/customers/${salma?.id}`, { token: a.ownerToken })).status === 404, "deleted customer is gone");

    const bStill = await call(`/customers/${bCustomer?.id}`, { token: b.ownerToken });
    check(bStill.status === 200, "shop B's customer is untouched");

    console.log("\naudit log");
    const actions = await withRlsBypass(async (tx) => {
      const rows = await tx.orm.public.AuditLog.where({ tenantId: a.tenantId, entityType: "customer" })
        .select("action")
        .all();
      return rows.map((row) => row.action);
    });
    check(actions.filter((x) => x === "customer.create").length === 3, "3 creates audited");
    check(actions.filter((x) => x === "customer.update").length === 2, "2 updates audited (no-op is not)");
    check(actions.filter((x) => x === "customer.delete").length === 1, "1 delete audited");
  } finally {
    await cleanup([a.tenantId, b.tenantId]);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const label of failures) console.log(`  - ${label}`);
    process.exitCode = 1;
  }
}

async function cleanup(tenantIds: string[]): Promise<void> {
  console.log("\ncleanup");
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."sales" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."customers" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."users" WHERE "tenant_id" = ${tenantId}::uuid`,
      ];
      for (const statement of statements) {
        await tx.execute(statement.affectedCount().build());
      }
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
  console.log("  ok   removed everything this run created");
}

main()
  .catch((error) => {
    console.error("\nSmoke test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
