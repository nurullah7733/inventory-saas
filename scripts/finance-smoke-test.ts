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
  body: {
    ok?: boolean;
    data?: any;
    error?: {
      code?: string;
      message?: string;
      details?: Record<string, string[]>;
    };
  };
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

async function mintToken(
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "finance-smoke" }),
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
      name: `Finance Smoke ${label} ${stamp}`,
      email: `finance-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const users: Partial<Record<UserRole, string>> = {};
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      const user = await tx.orm.public.User.select("id").create({
        tenantId: tenant.id,
        name: `${role} ${label}`,
        email: `finance-${role}-${label}-${stamp}@example.com`,
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

async function main() {
  const fixtures: Fixture[] = [];
  try {
    const a = await createTenant("a", Date.now());
    fixtures.push(a);
    const b = await createTenant("b", Date.now());
    fixtures.push(b);
    const category = await call("/expense-categories", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Rent" },
    });
    check(category.status === 201, "create category");
    const categoryId = category.body.data?.category.id;
    check(
      (
        await call("/expense-categories", {
          method: "POST",
          token: a.ownerToken,
          body: { name: "rent" },
        })
      ).status === 409,
      "duplicate category rejected",
    );
    const supplier = await call("/suppliers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Wholesaler" },
    });
    check(supplier.status === 201, "create supplier fixture");
    const supplierId = supplier.body.data?.supplier.id;
    for (const [path, key, ref, date] of [
      ["expenses", "expense", "categoryId", "expenseDate"],
      ["supplier-payments", "payment", "supplierId", "paymentDate"],
    ]) {
      const body: Record<string, string> = {
        ...(key === "expense" ? { title: "Shop rent" } : {}),
        [ref]: key === "expense" ? categoryId : supplierId,
        amount: "123.45",
        [date]: "2026-10-01",
        note: "Original note",
      };
      check(
        (await call(`/${path}`)).status === 401,
        `${path}: authentication required`,
      );
      const created = await call(`/${path}`, {
        method: "POST",
        token: a.ownerToken,
        body,
      });
      check(created.status === 201, `${path}: create`);
      const id = created.body.data?.[key]?.id;
      check(
        created.body.data?.[key]?.amount === "123.45",
        `${path}: exact money`,
      );
      for (const method of ["GET", "PATCH", "DELETE"]) {
        check(
          (
            await call(`/${path}/${id}`, {
              method,
              token: b.ownerToken,
              ...(method === "PATCH" ? { body: { amount: "5.00" } } : {}),
            })
          ).status === 404,
          `${path}: cross-tenant ${method} blocked`,
        );
      }
      check(
        (await call(`/${path}`, { token: b.ownerToken })).body.data?.total ===
          0,
        `${path}: isolated list`,
      );
      check(
        (await call(`/${path}`, { method: "POST", token: b.ownerToken, body }))
          .status === 422,
        `${path}: foreign reference blocked`,
      );
      for (const amount of ["0", "-1", "1.234", "100000000", "NaN"])
        check(
          (
            await call(`/${path}`, {
              method: "POST",
              token: a.ownerToken,
              body: { ...body, amount },
            })
          ).status === 422,
          `${path}: invalid amount ${amount}`,
        );
      check(
        (
          await call(`/${path}`, {
            method: "POST",
            token: a.ownerToken,
            body: { ...body, [date]: "2026-02-30" },
          })
        ).status === 422,
        `${path}: invalid calendar date`,
      );
      check(
        (
          await call(`/${path}`, {
            method: "POST",
            token: a.ownerToken,
            body: { ...body, tenantId: b.tenantId },
          })
        ).status === 403,
        `${path}: tenant spoof blocked`,
      );
      check(
        (await call(`/${path}`, { method: "POST", token: a.staffToken, body }))
          .status === 403,
        `${path}: staff cannot write`,
      );
      check(
        (
          await call(`/${path}/${id}`, {
            method: "PATCH",
            token: a.staffToken,
            body: { amount: "1" },
          })
        ).status === 403,
        `${path}: staff cannot edit`,
      );
      check(
        (
          await call(`/${path}/${id}`, {
            method: "DELETE",
            token: a.staffToken,
          })
        ).status === 403,
        `${path}: staff cannot delete`,
      );
      const updated = await call(`/${path}/${id}`, {
        method: "PATCH",
        token: a.managerToken,
        body: { amount: "250.50" },
      });
      check(
        updated.status === 200 && updated.body.data?.[key]?.amount === "250.50",
        `${path}: manager updates`,
      );
      check(
        updated.body.data?.[key]?.note === "Original note" &&
          updated.body.data?.[key]?.[ref] === body[ref],
        `${path}: PATCH preserves omitted fields`,
      );
      const filtered = await call(
        `/${path}?from=2026-10-01&to=2026-10-01&limit=1&${ref}=${body[ref]}`,
        { token: a.ownerToken },
      );
      check(
        filtered.status === 200 && filtered.body.data?.total === 1,
        `${path}: date/reference pagination`,
      );
      check(
        (
          await call(`/${path}?from=2026-10-02&to=2026-10-01`, {
            token: a.ownerToken,
          })
        ).status === 422,
        `${path}: reversed range rejected`,
      );
      check(
        (
          await call(`/${path}/${id}`, {
            method: "PATCH",
            token: a.ownerToken,
            body: {},
          })
        ).status === 422,
        `${path}: empty PATCH rejected`,
      );
      const masterPath = key === "expense" ? "expense-categories" : "suppliers";
      check(
        (
          await call(`/${masterPath}/${body[ref]}`, {
            method: "DELETE",
            token: a.ownerToken,
          })
        ).status === 409,
        `${path}: referenced master deletion blocked`,
      );
      check(
        (
          await call(`/${masterPath}/${body[ref]}`, {
            method: "PATCH",
            token: a.ownerToken,
            body: { isActive: false },
          })
        ).status === 200,
        `${path}: archive master`,
      );
      check(
        (await call(`/${path}`, { method: "POST", token: a.ownerToken, body }))
          .status === 422,
        `${path}: inactive reference rejected`,
      );
      check(
        (
          await call(`/${path}/${id}`, {
            method: "PATCH",
            token: a.ownerToken,
            body: { note: "Corrected", [ref]: body[ref] },
          })
        ).status === 200,
        `${path}: historical inactive reference preserved`,
      );
      check(
        (
          await call(`/${path}/${id}`, {
            method: "DELETE",
            token: a.managerToken,
          })
        ).status === 200,
        `${path}: delete`,
      );
      check(
        (await call(`/${path}/${id}`, { token: a.ownerToken })).status === 404,
        `${path}: deleted record gone`,
      );
    }
    for (const method of ["GET", "PATCH", "DELETE"])
      check(
        (
          await call(`/expense-categories/${categoryId}`, {
            method,
            token: b.ownerToken,
            ...(method === "PATCH" ? { body: { name: "Other" } } : {}),
          })
        ).status === 404,
        `category: cross-tenant ${method}`,
      );
    check(
      (
        await call(`/expense-categories/${categoryId}`, {
          method: "DELETE",
          token: a.ownerToken,
        })
      ).status === 200,
      "delete unreferenced category",
    );
    const audits = await withRlsBypass((tx) =>
      tx.orm.public.AuditLog.where({ tenantId: a.tenantId })
        .select("action")
        .all(),
    );
    for (const entity of ["expense_category", "expense", "supplier_payment"])
      for (const action of ["create", "update", "delete"])
        check(
          audits.some((r) => r.action === `${entity}.${action}`),
          `audit ${entity}.${action}`,
        );
  } finally {
    await cleanup(fixtures.map((f) => f.tenantId));
  }
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}
async function cleanup(tenantIds: string[]): Promise<void> {
  console.log("\ncleanup");
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."expenses" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."supplier_payments" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."expense_categories" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."suppliers" WHERE "tenant_id" = ${tenantId}::uuid`,
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
