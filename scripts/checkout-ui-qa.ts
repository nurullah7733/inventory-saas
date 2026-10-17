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
const out = ".next/checkout-qa";
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
  let browserToken = signed.token;
  let id = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (cause: Error) => void }>();
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(String(event.data));
    if (data.method === "Network.requestWillBeSent") {
      const auth = data.params.request.headers.authorization ?? data.params.request.headers.Authorization;
      if (auth?.startsWith("Bearer ")) browserToken = auth.slice(7);
    }
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
  const click = async (text: string) => evaluate(`Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const setMethod = async (value: string) => evaluate(`(() => { const field = document.querySelector('select[name="paymentMethod"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const disabled = (text: string) => `Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === ${JSON.stringify(text)}).disabled`;
  for (const width of [360, 675, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
    await send("Page.navigate", { url: `${base}/sales/create` });
    await waitFor(`!!document.querySelector(${JSON.stringify(input)}) && document.body.innerText.includes("Roasted coffee")`);
    assert.ok(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), "scanner receives initial focus");
    assert.equal(await evaluate(`!!document.querySelector('input[placeholder="Find customer by name or phone"]')`), false, "customer picker starts compact");
    assert.equal(await evaluate(`!!document.querySelector('header a[aria-label="New sale"]')`), false, "New sale hidden while creating invoice");
    await enter("COFFEE-0"); await waitFor(quantity(0, 1));
    await click("Full payment");
    await waitFor(`document.querySelector('input[name="paidAmount"]').value === "20.00"`);
    await setValue('input[name="discount"]', "2.00");
    await waitFor(`document.querySelector('input[name="paidAmount"]').value === "18.00"`);
    await setValue('input[name="paidAmount"]', "50.00");
    await waitFor(`document.body.innerText.includes("Change: BDT 32.00")`);
    await setMethod("card");
    await waitFor(`document.body.innerText.includes("Payment cannot exceed")`);
    assert.equal(await evaluate(disabled("Complete & print")), true);
    await setMethod("cash");
    await waitFor(`!(${disabled("Complete & print")})`);
    if (width < 1280) {
      await click("Checkout");
      assert.ok(await evaluate(`document.activeElement === document.querySelector('aside[aria-label="Checkout"]')`));
      await waitFor(`document.querySelector('aside[aria-label="Checkout"]').getBoundingClientRect().top < innerHeight / 2`);
    }
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), "no page overflow");
    const picture = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${out}/checkout-${width}.png`, Buffer.from(String(picture.data), "base64"));
    const before = invoiceWrites;
    await evaluate(`(() => { window.__printCount = 0; window.__failPrint = ${width === 675}; window.__printTimer = setInterval(() => { const frame = document.querySelector("iframe[data-invoice-print]"); if (frame?.contentWindow) frame.contentWindow.print = () => { window.__printCount++; if(window.__failPrint) throw new Error("Printer unavailable"); }; }, 1); })()`);
    await evaluate(`(() => { const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Complete & print"); button.click(); button.click(); })()`);
    await waitFor(`location.pathname.startsWith("/sales/invoices/") && !!Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Next sale")`);
    assert.equal(invoiceWrites, before + 1, "double click creates just one sale");
    assert.equal(await evaluate(`window.__printCount`), 1, "one automatic print attempt after save");
    const salePath = String(await evaluate("location.pathname"));
    const detail = await (await fetch(`${base}/api/v1/invoices/${salePath.split("/").at(-1)}`, { headers: { authorization: `Bearer ${browserToken}` } })).json();
    assert.ok(detail.ok, JSON.stringify(detail));
    assert.equal(detail.data.invoice.paidAmount, "18.00", "change is not recorded as payment");
    assert.equal(detail.data.invoice.dueAmount, "0.00");
    assert.equal(detail.data.invoice.status, "completed");
    if (width === 675) {
      assert.ok(await evaluate(`document.body.innerText.includes("Sale saved. Printing failed")`));
      assert.equal(await evaluate(`!!document.querySelector("iframe[data-invoice-print]")`), false);
    } else {
      const receipt = String(await evaluate(`document.querySelector("iframe[data-invoice-print]").contentDocument.body.innerText`));
      assert.ok(receipt.includes("BDT 18.00"));
      await evaluate(`document.querySelector("iframe[data-invoice-print]").contentWindow.dispatchEvent(new Event("afterprint"))`);
    }
    await evaluate(`window.__failPrint = false`);
    // Reprint and paper preference never create another sale.
    await evaluate(`(() => { const field = Array.from(document.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.value === "thermal")); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(field, "thermal"); field.dispatchEvent(new Event("change", { bubbles:true })); })()`);
    await click("Print invoice"); await waitFor(`window.__printCount === 2`);
    assert.equal(invoiceWrites, before + 1);
    assert.ok(await evaluate(`localStorage.getItem(${JSON.stringify(`invoice-paper:${fixture.tenantId}`)}) === "thermal"`));
    await evaluate(`document.querySelector("iframe[data-invoice-print]").contentWindow.dispatchEvent(new Event("afterprint")); clearInterval(window.__printTimer); Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Next sale").click()`);
    await waitFor(`location.pathname === "/sales/create" && !!document.querySelector(${JSON.stringify(input)})`);
    assert.equal(await evaluate(`${quantities}.length`), 0);
    assert.ok(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`));
    await enter("COFFEE-1"); await waitFor(quantity(0, 1));
    await click("Full payment");
    await click("Complete sale");
    await waitFor(`location.pathname.startsWith("/sales/invoices/")`);
    assert.equal(invoiceWrites, before + 2);
    assert.equal(await evaluate(`window.__printCount`), 2, "complete without print stays available");
    console.log(`ok ${width}px: autofocus, compact customer, create-page header action hidden, checkout, full payment follows discount, cash change, noncash guard, one save/print, printer failure recovery, reprint, remembered paper, empty Next sale, complete without print`);
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
