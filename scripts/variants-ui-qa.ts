import "dotenv/config";
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
const widths = [360, 390, 768, 1280];

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
    let index = 0;
    for (const [sizeName, sizeId] of Object.entries(sizes)) {
      if (sizeName === "40") continue;
      for (const [colorName, colorId] of Object.entries(colors)) {
        index += 1;
        const sku = `LH-${sizeName}-${colorName.toUpperCase().slice(0, 3)}`;
        await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku, label: `${sizeName} / ${colorName}`, sizeId, colorId, stockQty: numeric<12, 3>(3), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
      }
    }
    // A second product so the list has more than one row.
    await tx.orm.public.Product.select("id").create(own({ name: "Runner Pro", sku: "RP", stockQty: numeric<12, 3>(2), costPrice: numeric("150.00"), sellPrice: numeric("180.00") }));
    await tx.orm.public.ProductVariant.select("id").create(own({ productId: (await tx.orm.public.Product.where({ sku: "RP", tenantId: tenant.id }).select("id").first())!.id, sku: "RP", label: "Default", stockQty: numeric<12, 3>(2), costPrice: numeric("150.00"), sellPrice: numeric("180.00") }));
    return { tenantId: tenant.id, user };
  });

  const session = await withRlsBypass(() => issueSession({ userId: created.user.id, tenantId: created.tenantId, deviceId: "variants-ui-qa" }));
  const token = (await signAccessToken({ userId: created.user.id, tenantId: created.tenantId, role: "shop_owner", sessionId: session.sessionId })).token;
  const storedSession = { user: { ...created.user, pinEnabled: false }, tenant: null, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt, token };

  // --- CDP driver -----------------------------------------------------------
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
    } catch (error) {
      throw new Error(`CDP error for: ${expression.slice(0, 120)}`);
    }
    if (result.exceptionDetails) throw new Error(`Eval failed for: ${expression.slice(0, 160)} :: ${JSON.stringify(result.exceptionDetails.exception?.description ?? "").slice(0, 160)}`);
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)} && !localStorage.getItem("inventory-saas.session")) { localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(storedSession))}); document.cookie = "has_session=1; Path=/; SameSite=Lax"; }` });
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
    await shot(path.join(`add-matrix-${width}.png`));

    // Add the third axis → tabs.
    await clickButton("500 g", '[role="dialog"]');
    await waitFor(`!!document.querySelector('[role="dialog"] [role="tablist"]')`);
    report(`${width}: third-axis tablist shown = ${await evaluate(`!!document.querySelector('[role="dialog"] [role="tablist"]')`)}`);
    results.push; // keep signature
    report(`${width}: single summary bar = ${await evaluate(`(() => { const d = document.querySelector('[role="dialog"]').innerText; return (d.match(/·/g) ?? []).length === 1; })()`)}`);
    await clickButton("750 g", '[role="dialog"]');
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

  // --- cleanup ---------------------------------------------------------------
  await withRlsBypass(async (tx) => {
    const orm = tx.orm.public;
    const strays = await orm.Tenant.select("id").where((t) => t.name.ilike("Variants UI QA%")).all();
    for (const stray of strays) {
      const tenantId = stray.id;
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
    }
  });
}

main()
  .catch((error) => { console.error("QA failed:", error.message ?? error); process.exitCode = 1; })
  .finally(() => process.exit(0));

void rawSql;
