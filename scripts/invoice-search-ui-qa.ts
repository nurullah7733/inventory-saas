import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { numeric } from "../lib/numeric.ts";
import { labelCode } from "../lib/inventory/label-codes.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const endpoint = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
const out = ".next/invoice-search-qa";
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
  const input = 'input[placeholder="Scan barcode or search name / SKU"]';
  async function setValue(selector: string, value: string) {
    await evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); if (!field) throw new Error("Missing input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  }
  async function enter(code: string) {
    await setValue(input, code);
    await evaluate(`document.querySelector(${JSON.stringify(input)}).focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  }
  const quantities = `Array.from(document.querySelectorAll('[aria-label="Invoice cart"] input[type="number"]')).map((field) => Number(field.value))`;
  const quantity = (index: number, value: number) => `${quantities}[${index}] === ${value}`;
  await send("Page.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)} && localStorage.getItem("inventory-saas.qa-tenant") !== ${JSON.stringify(fixture.tenantId)}) { localStorage.setItem("inventory-saas.qa-tenant", ${JSON.stringify(fixture.tenantId)}); localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(stored))}); document.cookie="has_session=1; Path=/; SameSite=Lax"; }` });
  await send("Network.setCookie", { name: "has_session", value: "1", url: base, path: "/" });
  await mkdir(out, { recursive: true });
  for (const width of [360, 675, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    await send("Page.navigate", { url: `${base}/sales/create` });
    await waitFor(`!!document.querySelector(${JSON.stringify(input)}) && document.body.innerText.includes("Roasted coffee")`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll("section")).find((s) => s.querySelector("h2")?.textContent === "Add products").querySelectorAll("input").length`), 1);
    await enter("Roasted");
    await waitFor(`document.body.innerText.includes("No exact active code matched")`);
    assert.deepEqual(await evaluate(quantities), [], "typing a name and Enter never adds the first match");
    await waitFor(`Array.from(document.querySelectorAll("button")).some((b) => b.textContent.startsWith("Roasted coffee") && !b.disabled)`);
    await evaluate(`Array.from(document.querySelectorAll("button")).find((b) => b.textContent.startsWith("Roasted coffee")).click()`);
    await waitFor(`!!document.querySelector('[aria-label="Choose a variant of Roasted coffee"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Choose a variant of Roasted coffee"] td button').length`), 2, "both weight variants with identical size/color are selectable");
    await evaluate(`Array.from(document.querySelectorAll('[aria-label="Choose a variant of Roasted coffee"] button')).find((b) => b.textContent.includes("500 g")).click()`);
    await waitFor(quantity(0, 1));
    // Creating/selecting a customer must preserve the cart and never submit a sale.
    const customerName = `Counter customer ${width}`;
    const customerPhone = `0170000${String(width).padStart(4, "0")}`;
    const clickText = async (text: string) => evaluate(`Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    await clickText("New customer");
    await waitFor(`!!document.querySelector('[role="dialog"] input[name="name"]')`);
    await setValue('[role="dialog"] input[name="name"]', customerName);
    await setValue('[role="dialog"] input[name="phone"]', customerPhone);
    await clickText("Add customer");
    await waitFor(`!document.querySelector('[role="dialog"]') && document.querySelector("section h2").textContent === ${JSON.stringify(`Customer: ${customerName}`)}`);
    assert.equal(await evaluate(quantities + "[0]"), 1, "customer creation preserves the cart");
    await clickText("Change customer");
    await clickText("Walk-in");
    await clickText("New customer");
    await waitFor(`!!document.querySelector('[role="dialog"] input[name="name"]')`);
    await setValue('[role="dialog"] input[name="name"]', "Duplicate customer");
    await setValue('[role="dialog"] input[name="phone"]', customerPhone);
    await clickText("Add customer");
    await waitFor(`document.body.innerText.includes("Select existing customer")`);
    await clickText("Select existing customer");
    await waitFor(`!document.querySelector('[role="dialog"]') && document.querySelector("section h2").textContent === ${JSON.stringify(`Customer: ${customerName}`)}`);
    await clickText("New customer");
    await waitFor(`!!document.querySelector('[role="dialog"] input[name="name"]')`);
    await clickText("Cancel");
    assert.equal(await evaluate(quantities + "[0]"), 1, "cancel preserves the cart");
    assert.equal(invoiceWrites, 0, "customer form never submits an invoice");
    console.log(`ok ${width}px: create and auto-select customer, duplicate phone selection, cancel, cart preserved`);
    await setValue('[aria-label="Invoice cart"] input[inputmode="decimal"]', "19");
    await enter(labelCode(fixture.variants[0].id));
    await waitFor(quantity(0, 2));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Invoice cart"] input[inputmode="decimal"]').value`), "19", "repeated scans preserve an edited selling price");
    await enter(labelCode(fixture.variants[0].id));
    await enter(labelCode(fixture.variants[0].id));
    await waitFor(quantity(0, 3));
    await waitFor(`document.body.innerText.includes("No more stock")`);
    assert.equal(await evaluate(`${quantities}.length`), 1, "rapid scans increment the same row without overselling");
    await enter("012345678901"); await waitFor(quantity(1, 1));
    await enter("COFFEE");
    await waitFor(`!!document.querySelector('[aria-label="Choose a variant of Roasted coffee"]')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Choose a variant of Roasted coffee"] button')).find((b) => b.textContent.includes("500 g")).disabled`), true, "cart stock is deducted from selectable stock");
    await evaluate(`Array.from(document.querySelectorAll('[aria-label="Choose a variant of Roasted coffee"] button')).find((b) => b.textContent.includes("750 g")).click()`);
    await waitFor(quantity(1, 2));
    await enter("TEA"); await waitFor(quantity(2, 1));
    // A slow, intentional scan still adds its item without erasing newer typing.
    await evaluate(`window.__qaFetch = window.fetch; window.fetch = (...args) => String(args[0]).includes("includeProduct=true&code=TEA") ? new Promise((resolve) => setTimeout(() => resolve(window.__qaFetch(...args)), 500)) : window.__qaFetch(...args)`);
    await enter("TEA"); await setValue(input, "packets"); await waitFor(quantity(2, 2));
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "packets");
    await evaluate(`window.fetch = window.__qaFetch`);
    await enter("BAR-ZERO"); await waitFor(`document.body.innerText.includes("No more stock")`);
    assert.equal(await evaluate(`${quantities}.length`), 3);
    await enter("RICE"); await waitFor(quantity(3, 0.5));
    await enter("RICE"); await waitFor(`document.body.innerText.includes("No more stock")`);
    await enter("NOT-A-REAL-CODE"); await waitFor(`document.body.innerText.includes("No exact active code matched")`);
    assert.equal(await evaluate(`${quantities}.length`), 4);
    assert.equal(await evaluate(`location.pathname`), "/sales/create");
    assert.equal(invoiceWrites, 0, "Enter in the search field must never submit the invoice");
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), "no horizontal page overflow");
    const picture = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${out}/invoice-search-${width}.png`, Buffer.from(String(picture.data), "base64"));
    console.log(`ok ${width}px: one field, name selection, both weight variants, internal/manufacturer scans, parent SKU, rapid scans, stale typing, stock limits, measured stock, no accidental invoice submit`);
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
