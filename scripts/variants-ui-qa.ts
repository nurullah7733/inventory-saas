import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const endpoint = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
const outDir = process.env.QA_OUT_DIR ?? ".";
const widths = [360, 675, 768, 1280];
let fixtureTenantId: string | null = null;
let browserSocket: WebSocket | null = null;
let browserTargetId: string | null = null;

async function main() {
  // --- fixture tenant with the Ladies Heel 3x3 grid -------------------------
  const passwordHash = await hashPassword("x");
  const created = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Variants UI QA ${randomUUID()}`, email: `vui-${randomUUID()}@example.com`, vatPercentage: numeric("0.00"), currencySymbol: "৳" });
    const user = await tx.orm.public.User.select("id", "name", "email", "role").create({ tenantId: tenant.id, name: "UI QA", email: `vui-${randomUUID()}@example.com`, passwordHash, role: "shop_owner" });
    const own = <T extends object>(value: T) => ({ ...value, tenantId: tenant.id });
    const sizes: Record<string, string> = {};
    for (const name of ["37", "38", "39", "40"]) {
      const row = await tx.orm.public.VariantSize.select("id").create(own({ name }));
      sizes[name] = row.id;
    }
    const colors: Record<string, string> = {};
    for (const name of ["Red", "Gray", "White"]) {
      const row = await tx.orm.public.VariantColor.select("id").create(own({ name }));
      colors[name] = row.id;
    }
    const weights: Record<string, string> = {};
    for (const name of ["500 g", "750 g"]) {
      const row = await tx.orm.public.VariantWeight.select("id").create(own({ name }));
      weights[name] = row.id;
    }
    const heel = await tx.orm.public.Product.select("id").create(own({ name: "Ladies Heel", sku: "LH", stockQty: numeric<12, 3>(9), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
    for (const [sizeName, sizeId] of Object.entries(sizes)) {
      if (sizeName === "40") continue;
      for (const [colorName, colorId] of Object.entries(colors)) {
        const sku = `LH-${sizeName}-${colorName.toUpperCase().slice(0, 3)}`;
        await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku, label: `${sizeName} / ${colorName}`, sizeId, colorId, stockQty: numeric<12, 3>(3), costPrice: numeric("12345678.90"), sellPrice: numeric("87654321.09") }));
      }
    }
    // A second product so the list has more than one row.
    await tx.orm.public.Product.select("id").create(own({ name: "Runner Pro", sku: "RP", stockQty: numeric<12, 3>(2), costPrice: numeric("150.00"), sellPrice: numeric("180.00") }));
    await tx.orm.public.ProductVariant.select("id").create(own({ productId: (await tx.orm.public.Product.where({ sku: "RP", tenantId: tenant.id }).select("id").first())!.id, sku: "RP", label: "Default", stockQty: numeric<12, 3>(2), costPrice: numeric("150.00"), sellPrice: numeric("180.00") }));
    return { tenantId: tenant.id, user };
  });

  fixtureTenantId = created.tenantId;
  const session = await withRlsBypass(() => issueSession({ userId: created.user.id, tenantId: created.tenantId, deviceId: "variants-ui-qa" }));
  const token = (await signAccessToken({ userId: created.user.id, tenantId: created.tenantId, role: "shop_owner", sessionId: session.sessionId })).token;
  const storedSession = { user: { ...created.user, pinEnabled: false }, tenant: null, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt, token };

  // --- CDP driver -----------------------------------------------------------
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  browserTargetId = target.id;
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  browserSocket = socket;
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("Browser connection failed")), { once: true }); });
  let callId = 0;
  const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error.message)); else call.resolve(data.result);
  });
  function send(method: string, params: Record<string, unknown> = {}) {
    return new Promise<Record<string, unknown>>((resolve, reject) => { const id = ++callId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string) {
    let result: Record<string, unknown>;
    try {
      result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    } catch {
      throw new Error(`CDP error for: ${expression.slice(0, 120)}`);
    }
    if (result.exceptionDetails) throw new Error(`Eval failed for: ${expression.slice(0, 160)} :: ${JSON.stringify((result.exceptionDetails as { exception?: { description?: string } }).exception?.description ?? "").slice(0, 160)}`);
    return (result.result as { value: unknown }).value;
  }
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      let ok = false;
      try {
        ok = Boolean(await evaluate(expression));
      } catch {
        ok = false; // navigation context teardown can reject mid-flight reads
      }
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    let context = "";
    try {
      context = String(await evaluate(`location.href + " :: " + document.body.innerText.replace(/\\n/g, " | ").slice(0, 200)`));
    } catch {
      context = "no document";
    }
    throw new Error(`Timed out waiting for: ${expression} — page: ${context}`);
  }
  async function shot(name: string) {
    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(outDir, name), Buffer.from(String(image.data), "base64"));
  }
  function setValue(selector: string, value: string) {
    return evaluate(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  }
  function clickButton(label: string, scope = "body") {
    return evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(scope)});
      const button = Array.from((root ?? document).querySelectorAll("button")).find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
  }

  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)} && localStorage.getItem("inventory-saas.qa-tenant") !== ${JSON.stringify(created.tenantId)}) { localStorage.setItem("inventory-saas.qa-tenant", ${JSON.stringify(created.tenantId)}); localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(storedSession))}); document.cookie = "has_session=1; Path=/; SameSite=Lax"; }` });
  await send("Network.setCookie", { name: "has_session", value: "1", url: base, path: "/" });

  const results: string[] = [];
  function report(line: string) {
    results.push(line);
    console.log(line);
  }
  for (const width of widths) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: Math.max(760, Math.round(width * 1.8)), deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${base}/inventory/products` });
    await waitFor(`document.body.innerText.includes("Ladies Heel")`);
    report(`${width}: page scrollWidth fits = ${await evaluate("document.documentElement.scrollWidth <= innerWidth")}`);

    // Labels use the same stable ID for every copy; mock only the OS print dialog.
    await evaluate(`document.querySelector('[aria-label="Print labels for Ladies Heel"]').click()`);
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] button')).some((b) => b.textContent.trim() === "Print 27 labels")`);
    await clickButton("Clear copies", '[role="dialog"]');
    await setValue('[role="dialog"] input[aria-label^="Label copies for"]', "2");
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] button')).some((b) => b.textContent.trim() === "Print 2 labels")`);
    await evaluate(`(() => {
      const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get() {
        const win = original.get.call(this);
        if (win) win.print = () => { window.__printedLabels = { count: win.document.querySelectorAll("article").length, svg: win.document.querySelectorAll("article svg").length, text: win.document.body.textContent, page: win.document.querySelector("style").textContent }; };
        return win;
      }});
    })()`);
    await clickButton("Print 2 labels", '[role="dialog"]');
    await waitFor(`window.__printedLabels?.count === 2`);
    assert.ok(await evaluate(`window.__printedLabels.svg === 2 && window.__printedLabels.text.includes("Ladies Heel") && window.__printedLabels.text.includes("87654321.09") && window.__printedLabels.page.includes("70mm 40mm")`), "print document includes barcode, current price and paper dimensions");
    report(`${width}: barcode preview and two-copy print document = true`);
    if (width === 360) {
      for (const paper of ["roll100", "a4"]) {
        await evaluate(`(() => { const field = document.querySelector('[role="dialog"] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(field, ${JSON.stringify(paper)}); field.dispatchEvent(new Event("change", { bubbles: true })); window.__printedLabels = null; })()`);
        await clickButton("Print 2 labels", '[role="dialog"]');
        await waitFor(`window.__printedLabels?.count === 2`);
        assert.ok(await evaluate(`window.__printedLabels.page.includes(${JSON.stringify(paper === "a4" ? "size: A4" : "100mm 50mm")})`), `${paper}: print page dimensions`);
      }
      report("70mm, 100mm and A4 print layouts verified");
    }
    await evaluate(`document.querySelector('[role="dialog"] svg[role="img"]').scrollIntoView({ block: "center" })`);

    await shot(path.join(`barcode-labels-${width}.png`));
    await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"]').click()`);
    await waitFor(`!document.querySelector('[role="dialog"]')`);

    // --- Add product modal --------------------------------------------------
    await evaluate(`Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Add product").click()`);
    await waitFor(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes("Variants")`);
    const preselected = await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button[aria-pressed]')).filter((b) => b.getAttribute("aria-pressed") === "true").length`);
    report(`${width}: chips pre-selected on open = ${preselected}`);

    // Toggle on and build 3x3.
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] label')).find((l) => l.textContent?.includes("Multiple sizes / colors")).click()`);
    await waitFor(`document.querySelectorAll('[role="dialog"] fieldset').length > 0`);
    // The option lists stream in from the API — wait for real chips.
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button')).some((b) => b.textContent?.trim() === "37")`);
    async function clickChip(label: string) {
      await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button')).some((b) => b.textContent?.trim() === ${JSON.stringify(label)})`);
      report(`${width}: chip ${label} = ${await clickButton(label, '[role="dialog"]')}`);
    }
    report(`${width}: fieldsets = ${await evaluate(`document.querySelectorAll('[role="dialog"] fieldset').length`)}`);
    for (const value of ["37", "38", "39"]) await clickChip(value);
    for (const value of ["Red", "Gray", "White"]) await clickChip(value);
    report(`${width}: pressed chips = ${await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button[aria-pressed="true"]')).map((b) => b.textContent?.trim()).join(",")`)}`);
    report(`${width}: dialog snippet = ${await evaluate(`document.querySelector('[role="dialog"]').innerText.replace(/\\n/g, " | ").slice(0, 300)`)}`);
    await waitFor(`!!document.querySelector('[aria-label="Size 37, Color Red quantity"]')`);
    report(`${width}: 2-kind matrix shown = ${await evaluate(`!!document.querySelector('[role="dialog"] table')`)}`);
    report(`${width}: dialog scrollWidth fits = ${await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return d.scrollWidth <= d.clientWidth + 1; })()`)}`);
    await setValue('[aria-label="Size 37, Color Red quantity"]', "5");
    await setValue('[aria-label="Size 38, Color Gray quantity"]', "2");
    await setValue('[aria-label="Size 39, Color White quantity"]', "1");
    await waitFor(`document.querySelector('[aria-label="Size 37, Color Red quantity"]').value === "5"`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Size 38, Color Gray quantity"]').value`), "2", "two-axis quantity persists");
    assert.ok(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes("Default prices")`));
    await shot(path.join(`add-matrix-${width}.png`));

    // Add the third axis → tabs.
    await clickButton("500 g", '[role="dialog"]');
    await waitFor(`!!document.querySelector('[role="dialog"] [role="tablist"]')`);
    report(`${width}: third-axis tablist shown = ${await evaluate(`!!document.querySelector('[role="dialog"] [role="tablist"]')`)}`);
    await setValue('[aria-label="Size 37, Color Red quantity"]', "7");
    await waitFor(`document.querySelector('[aria-label="Size 37, Color Red quantity"]').value === "7"`);
    await waitFor(`document.querySelectorAll('[role="dialog"] [aria-live="polite"]').length === 1`);
    report(`${width}: single summary bar = true`);

    await clickButton("750 g", '[role="dialog"]');
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]')).find((b) => b.textContent.trim().startsWith("750 g")).click()`);
    await setValue('[aria-label="Size 37, Color Red quantity"]', "3");
    await waitFor(`document.querySelector('[aria-label="Size 37, Color Red quantity"]').value === "3"`);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]')).find((b) => b.textContent.trim().startsWith("500 g")).click()`);
    await waitFor(`document.querySelector('[aria-label="Size 37, Color Red quantity"]').value === "7"`);
    report(`${width}: three-axis quantities persist independently = true`);
    await shot(path.join(`add-tabs-${width}.png`));

    // Preview: mobile cards vs desktop table.
    report(`${width}: preview cards visible = ${await evaluate(`(() => {
      const toggles = document.querySelectorAll('[role="dialog"] button[aria-expanded]').length;
      return toggles > 0 ? "cards" : "table";
    })()`)}`);
    await shot(path.join(`add-preview-${width}.png`));

    // Close (create path has no dirty guard).
    await clickButton("Cancel", '[role="dialog"]');
    await waitFor(`!document.querySelector('[role="dialog"]')`);

    // --- Edit product modal -------------------------------------------------
    await evaluate(`(() => {
      const card = Array.from(document.querySelectorAll("article, li, div")).find((el) => el.querySelector("h2, h3, p")?.textContent === "Ladies Heel" && Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Edit"));
      if (!card) return false;
      Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Edit").click();
      return true;
    })()`);
    await waitFor(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes("Save")`);
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] th')).some((th) => th.textContent === "Variant") || document.querySelectorAll('[role="dialog"] li input[type="checkbox"]').length >= 9`);
    const pricesFit = await evaluate(`(() => {
      const fields = Array.from(document.querySelectorAll('[role="dialog"] input[aria-label^="Cost price for"], [role="dialog"] input[aria-label^="Sale price for"]'));
      return fields.length === 18 && fields.every((field) => {
        const style = getComputedStyle(field);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = style.font;
        return field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= context.measureText(field.value).width;
      });
    })()`);
    assert.equal(pricesFit, true, `${width}: full maximum-length cost and sale price values fit`);
    report(`${width}: full maximum-length prices visible = true`);
    await evaluate(`document.querySelector('[role="dialog"] input[aria-label^="Cost price for"]').scrollIntoView({ block: "center" })`);
    await shot(path.join(`edit-variants-${width}.png`));
    report(`${width}: edit dialog = ${await evaluate(`document.querySelector('[role="dialog"]').innerText.replace(/\\n/g, " | ").slice(0, 500)`)}`);
    report(`${width}: sku inputs = ${await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] input[aria-label^="SKU for"]')).map((el) => el.value).slice(0, 4).join(",")`)}`);

    // One SKU edit → button shows the change count; closing asks to discard.
    const skuInput = await evaluate(`(() => {
      const input = Array.from(document.querySelectorAll('[role="dialog"] input[aria-label^="SKU for"]')).find((el) => el.value === "LH-37-RED");
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "LH-37-CRIMSON");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    report(`${width}: sku editable = ${skuInput}`);
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] button')).some((b) => b.textContent?.trim() === "Save 1 change")`);
    report(`${width}: save count label = true`);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent?.trim() === "Cancel").click()`);
    await waitFor(`document.body.innerText.includes("Discard variant changes?")`);
    await shot(path.join(`edit-discard-${width}.png`));
    await clickButton("Discard");
    await waitFor(`!document.querySelector('[role="dialog"]')`);
  }

  console.log(results.join("\n"));
  await socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);

}

async function cleanupFixture() {
  browserSocket?.close();
  if (browserTargetId) await fetch(`${endpoint}/json/close/${browserTargetId}`).catch(() => undefined);
  if (!fixtureTenantId) return;
  const tenantId = fixtureTenantId;
  await withRlsBypass(async (tx) => {
    const orm = tx.orm.public;
    await orm.AuditLog.where({ tenantId }).deleteAll();
    await orm.StockMovement.where({ tenantId }).deleteAll();
    await orm.ProductVariant.where({ tenantId }).deleteAll();
    await orm.Product.where({ tenantId }).deleteAll();
    await orm.VariantColor.where({ tenantId }).deleteAll();
    await orm.VariantSize.where({ tenantId }).deleteAll();
    await orm.VariantWeight.where({ tenantId }).deleteAll();
    await orm.RefreshSession.where({ tenantId }).deleteAll();
    await orm.User.where({ tenantId }).deleteAll();
    await orm.Tenant.where({ id: tenantId }).delete();
  });
}

main()
  .catch((error) => { console.error("QA failed:", error.message ?? error); process.exitCode = 1; })
  .finally(async () => {
    try { await cleanupFixture(); } finally { await db.close(); }
  });

void rawSql;
