import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { numeric } from "../lib/numeric.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const endpoint = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
const out = ".next/invoice-print-qa";
let tenantId: string | null = null;
let socket: WebSocket | null = null;
let targetId: string | null = null;
let invoiceWrites = 0;

async function main() {
  const fixture = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.create({ name: "Unified invoice QA", email: `${randomUUID()}@example.com`, vatPercentage: numeric("0.00") });
    tenantId = tenant.id;
    const own = <T extends object>(row: T) => ({ ...row, tenantId: tenant.id });
    const user = await tx.orm.public.User.create(own({ name: "Invoice QA", email: `${randomUUID()}@example.com`, passwordHash: "unused-test-account", role: "shop_owner" }));
    const size = await tx.orm.public.VariantSize.create(own({ name: "Regular" }));
    const color = await tx.orm.public.VariantColor.create(own({ name: "Blue" }));
    const kg = await tx.orm.public.VariantUnit.create(own({ name: "kg", measured: true }));
    const product = await tx.orm.public.Product.create(own({ name: "Roasted coffee", sku: "COFFEE", costPrice: numeric("10"), sellPrice: numeric("15"), stockQty: numeric<12, 3>(6) }));
    const variants = [];
    for (const [index, name] of ["500 g", "750 g"].entries()) {
      const weight = await tx.orm.public.VariantWeight.create(own({ name }));
      variants.push(await tx.orm.public.ProductVariant.create(own({ productId: product.id, sku: `COFFEE-${index}`, barcode: `01234567890${index}`, label: `Regular / Blue / ${name}`, sizeId: size.id, colorId: color.id, weightId: weight.id,
        costPrice: numeric("10"), sellPrice: numeric(index === 0 ? "20" : "25"), stockQty: numeric<12, 3>(3) })));
    }
    for (const [name, sku, quantity, measured] of [["Tea packets", "TEA", 2, false], ["Empty item", "ZERO", 0, false], ["Loose rice", "RICE", 0.5, true]] as const) {
      const row = await tx.orm.public.Product.create(own({ name, sku, unitId: measured ? kg.id : null, costPrice: numeric("4"), sellPrice: numeric("12"), stockQty: numeric<12, 3>(quantity) }));
      await tx.orm.public.ProductVariant.create(own({ productId: row.id, sku, barcode: `BAR-${sku}`, label: "Default", costPrice: numeric("4"), sellPrice: numeric("12"), stockQty: numeric<12, 3>(quantity) }));
    }
    return { user, tenantId: tenant.id, variants };
  });
  const session = await withRlsBypass(() => issueSession({ userId: fixture.user.id, tenantId: fixture.tenantId, deviceId: "invoice-ui-qa" }));
  const signed = await signAccessToken({ userId: fixture.user.id, tenantId: fixture.tenantId, role: "shop_owner", sessionId: session.sessionId });
  const stored = { user: { id: fixture.user.id, name: fixture.user.name, email: fixture.user.email, role: fixture.user.role, pinEnabled: false }, tenant: null, token: signed.token, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt };
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  targetId = target.id;
  const ws = new WebSocket(target.webSocketDebuggerUrl); socket = ws;
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve(), { once: true }); ws.addEventListener("error", () => reject(new Error("Browser connection failed")), { once: true }); });
  let id = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (cause: Error) => void }>();
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(String(event.data));
    if (data.method === "Network.requestWillBeSent" && data.params.request.method === "POST" && data.params.request.url.includes("/api/v1/invoices")) invoiceWrites++;
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error.message)); else call.resolve(data.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  async function evaluate(expression: string) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return (result.result as { value: unknown }).value;
  }
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 160; attempt++) {
      try { if (await evaluate(expression)) return; } catch { /* navigation context replacement */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timeout: ${expression}; ${await evaluate('document.body.innerText.slice(-1000)')}`);
  }
  await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)} && localStorage.getItem("inventory-saas.qa-tenant") !== ${JSON.stringify(fixture.tenantId)}) { localStorage.setItem("inventory-saas.qa-tenant", ${JSON.stringify(fixture.tenantId)}); localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(stored))}); document.cookie="has_session=1; Path=/; SameSite=Lax"; }` });
  await send("Network.setCookie", { name: "has_session", value: "1", url: base, path: "/" });
  await mkdir(out, { recursive: true });
  async function api(path: string, body: unknown) {
    const response = await fetch(`${base}/api/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${signed.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.ok(response.ok && result.ok, JSON.stringify(result));
    return result.data;
  }
  const customer = (await api("/customers", { name: "Receipt buyer", phone: "01700009999" })).customer;
  const sale = (await api("/invoices", { status: "completed", customerId: customer.id, discount: "4.00", paidAmount: "20.00", paymentMethod: "cash", items: [{ productId: fixture.variants[0].productId, variantId: fixture.variants[0].id, quantity: 2, unitPrice: "20.00" }] })).invoice;
  await api("/returns", { saleItemId: sale.items[0].id, quantity: 1, reason: "Receipt QA" });
  for (const [width, paper] of [[360, "thermal"], [675, "standard"], [1280, "a4"]] as const) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    await send("Page.navigate", { url: `${base}/sales/invoices/${sale.id}` });
    await waitFor(`Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Print invoice" && !b.disabled)`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    await evaluate(`(() => { const field = document.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(field, ${JSON.stringify(paper)}); field.dispatchEvent(new Event("change", { bubbles: true })); window.__printCount = 0; window.__printTimer = setInterval(() => { const frame = document.querySelector("iframe[data-invoice-print]"); if (frame?.contentWindow) frame.contentWindow.print = () => { window.__printCount++; }; }, 1); })()`);
    await evaluate(`Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Print invoice").click()`);
    await waitFor(`window.__printCount === 1`);
    const text = String(await evaluate(`document.querySelector("iframe[data-invoice-print]").contentDocument.body.innerText`));
    assert.ok(text.includes("Receipt buyer") && text.includes("Regular / Blue / 500 g"));
    assert.ok(text.includes("BDT 36.00") && text.includes("BDT 18.00") && text.includes("Cash refund"));
    assert.ok(!text.includes("Add return") && !text.includes("unitCost"));
    assert.equal(invoiceWrites, 0, "printing never creates another sale");
    await evaluate(`(() => { clearInterval(window.__printTimer); const frame = document.querySelector("iframe[data-invoice-print]"); Object.assign(frame.style, { width: "100vw", height: "100vh", top: "0", left: "0", zIndex: "9999", background: "white" }); })()`);
    const picture = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${out}/invoice-${paper}-${width}.png`, Buffer.from(String(picture.data), "base64"));
    assert.ok(await evaluate(`(() => { const d = document.querySelector("iframe[data-invoice-print]").contentDocument; return d.documentElement.scrollWidth <= d.documentElement.clientWidth; })()`), "receipt has no horizontal overflow");
    await evaluate(`document.querySelector("iframe[data-invoice-print]").contentWindow.dispatchEvent(new Event("afterprint"))`);
    assert.equal(await evaluate(`!!document.querySelector("iframe[data-invoice-print]")`), false);
    console.log(`ok ${width}px / ${paper}: completed invoice print, customer, variant, saved totals, returns, no duplicate sale, cleanup`);
  }

}

async function cleanup() {
  socket?.close();
  if (targetId) await fetch(`${endpoint}/json/close/${targetId}`).catch(() => undefined);
  if (!tenantId) return;
  const id = tenantId;
  await withRlsBypass(async (tx) => {
    const orm = tx.orm.public;
    await orm.AuditLog.where({ tenantId: id }).deleteAll();
    await orm.SaleReturn.where({ tenantId: id }).deleteAll();
    await orm.StockMovement.where({ tenantId: id }).deleteAll();
    await orm.SaleItem.where({ tenantId: id }).deleteAll();
    await orm.Sale.where({ tenantId: id }).deleteAll();
    await orm.Customer.where({ tenantId: id }).deleteAll();
    await orm.ProductVariant.where({ tenantId: id }).deleteAll();
    await orm.Product.where({ tenantId: id }).deleteAll();
    await orm.VariantSize.where({ tenantId: id }).deleteAll();
    await orm.VariantColor.where({ tenantId: id }).deleteAll();
    await orm.VariantWeight.where({ tenantId: id }).deleteAll();
    await orm.VariantUnit.where({ tenantId: id }).deleteAll();
    await orm.RefreshSession.where({ tenantId: id }).deleteAll();
    await orm.User.where({ tenantId: id }).deleteAll();
    await orm.Tenant.where({ id }).delete();
  });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await cleanup(); } finally { await db.close(); } });
