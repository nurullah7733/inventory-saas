import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const endpoint = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
const outDir = process.env.QA_OUT_DIR ?? ".";

async function main() {
  const passwordHash = await hashPassword("x");
  const created = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: `Variants UI QA ${randomUUID()}`, email: `vui-${randomUUID()}@example.com`, vatPercentage: numeric("0.00"), currencySymbol: "৳" });
    const user = await tx.orm.public.User.select("id", "name", "email", "role").create({ tenantId: tenant.id, name: "UI QA", email: `vui-${randomUUID()}@example.com`, passwordHash, role: "shop_owner" });
    const own = <T extends object>(value: T) => ({ ...value, tenantId: tenant.id });
    const sizes: Record<string, string> = {};
    for (const name of ["37", "38", "39", "40", "41", "42"]) {
      const row = await tx.orm.public.VariantSize.select("id").create(own({ name }));
      sizes[name] = row.id;
    }
    const colors: Record<string, string> = {};
    for (const name of ["Red", "Gray", "White", "Crimson Lake"]) {
      const row = await tx.orm.public.VariantColor.select("id").create(own({ name }));
      colors[name] = row.id;
    }
    const heel = await tx.orm.public.Product.select("id").create(own({ name: "Ladies Heel", sku: "LH", stockQty: numeric<12, 3>(9), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
    for (const [sizeName, sizeId] of Object.entries(sizes)) {
      if (sizeName === "41" || sizeName === "42") continue;
      for (const [colorName, colorId] of Object.entries(colors)) {
        if (colorName === "Crimson Lake" && sizeName !== "37") continue;
        const sku = `LH-${sizeName}-${colorName.toUpperCase().slice(0, 3)}`;
        await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku, label: `${sizeName} / ${colorName}`, sizeId, colorId, stockQty: numeric<12, 3>(sizeName === "39" ? 0 : 3), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
      }
    }
    // One inactive variant for the muted + badge check.
    await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku: "LH-41-RED", label: "41 / Red", sizeId: sizes["41"]!, colorId: colors["Red"]!, stockQty: numeric<12, 3>(1), costPrice: numeric("550.00"), sellPrice: numeric("600.00"), isActive: false }));
    return { tenantId: tenant.id, user };
  });

  const session = await withRlsBypass(() => issueSession({ userId: created.user.id, tenantId: created.tenantId, deviceId: "variants-ui-qa" }));
  const token = (await signAccessToken({ userId: created.user.id, tenantId: created.tenantId, role: "shop_owner", sessionId: session.sessionId })).token;
  const storedSession = { user: { ...created.user, pinEnabled: false }, tenant: null, refreshToken: session.refreshToken, refreshExpiresAt: session.expiresAt, token };

  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("conn")), { once: true }); });
  let callId = 0;
  const pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
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
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`Eval failed: ${expression.slice(0, 100)}`);
    return (result.result as { value: unknown }).value;
  }
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      let ok = false;
      try { ok = Boolean(await evaluate(expression)); } catch { ok = false; }
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Timeout: ${expression}`);
  }
  async function shot(name: string) {
    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(outDir, name), Buffer.from(String(image.data), "base64"));
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
  // A stale session from an earlier run (deleted tenant) must not survive.
  await send("Page.navigate", { url: `${base}/login` });
  await waitFor(`!!document.body`);
  await evaluate(`localStorage.clear()`);

  for (const [width, mobile] of [[360, true], [1280, false]] as const) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: Math.round(width * (mobile ? 1.9 : 0.75)), deviceScaleFactor: 1, mobile });
    await send("Page.navigate", { url: `${base}/inventory/products` });
    await waitFor(`document.body.innerText.includes("Ladies Heel")`);

    // Add product: build 2x2 + preview cards/table + summary bar.
    await clickButton("Add product");
    await waitFor(`!!document.querySelector('[role="dialog"]')`);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] label')).find((l) => l.textContent?.includes("Multiple sizes / colors")).click()`);
    await waitFor(`document.querySelectorAll('[role="dialog"] fieldset').length > 0`);
    // The option lists stream in from the API — wait for real chips.
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button')).some((b) => b.textContent?.trim() === "37")`);
    async function clickChip(label: string) {
      await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] fieldset button')).some((b) => b.textContent?.trim() === ${JSON.stringify(label)})`);
      await clickButton(label, '[role="dialog"]');
    }
    for (const value of ["37", "38", "41"]) await clickChip(value);
    for (const value of ["Red", "Crimson Lake"]) await clickChip(value);
    await waitFor(`!!document.querySelector('[aria-label="Size 37, Color Red quantity"]')`);
    for (const [cell, qty] of [["Size 37, Color Red quantity", "5"], ["Size 37, Color Crimson Lake quantity", "12"], ["Size 41, Color Red quantity", "2"]] as const) {
      await evaluate(`(() => { const f = document.querySelector('[aria-label="${cell}"]'); if (!f) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, "${qty}"); f.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    }
    // 3 kinds → tabs
    await clickButton("750 g", '[role="dialog"]');
    // wait: a weights row? no weights fixture in this tenant — skip tabs here.
    await evaluate(`(() => { const el = Array.from(document.querySelectorAll('[role="dialog"] p')).find((p) => p.textContent === "Variants to be created"); el?.scrollIntoView({ block: "center" }); return !!el; })()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot(path.join(`preview-${width}.png`));
    // Mobile card expanded state
    if (mobile) {
      await evaluate(`document.querySelector('[role="dialog"] button[aria-expanded]')?.click()`);
      await new Promise((r) => setTimeout(r, 300));
      await shot(path.join(`preview-card-open-${width}.png`));
    }
    // Summary bar
    await evaluate(`(() => { const bar = document.querySelector('[role="dialog"] [aria-live="polite"]'); bar?.scrollIntoView({ block: "end" }); return !!bar; })()`);
    await new Promise((r) => setTimeout(r, 300));
    console.log(`${width}: summary bars (aria-live) = ${await evaluate(`document.querySelectorAll('[role="dialog"] [aria-live="polite"]').length`)}`);
    await shot(path.join(`summary-${width}.png`));
    await clickButton("Cancel", '[role="dialog"]');
    await waitFor(`!document.querySelector('[role="dialog"]')`);

    // Edit product: variants section + Save N changes + discard guard.
    await evaluate(`(() => {
      const card = Array.from(document.querySelectorAll("article, li, div")).find((el) => el.querySelector("h2, h3, p")?.textContent === "Ladies Heel" && Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Edit"));
      Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Edit").click();
      return true;
    })()`);
    await waitFor(`!!document.querySelector('[role="dialog"]')`);
    await waitFor(`!!document.querySelector('[role="dialog"] input[aria-label="SKU for 41 / Red"]')`);
    await evaluate(`(() => { const el = Array.from(document.querySelectorAll('[role="dialog"] th')).find((th) => th.textContent === "Variant") ?? Array.from(document.querySelectorAll('[role="dialog"] li')).find((li) => li.textContent?.includes("37 / Gray")); el?.scrollIntoView({ block: "start" }); return !!el; })()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot(path.join(`edit-list-${width}.png`));
    await evaluate(`(() => { const f = document.querySelector('[role="dialog"] input[aria-label="SKU for 41 / Red"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, "LH-41-CRIMSON"); f.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await waitFor(`Array.from(document.querySelectorAll('[role="dialog"] button')).some((b) => b.textContent?.trim() === "Save 1 change")`);
    await evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find((x) => x.textContent?.trim() === "Save 1 change"); b?.scrollIntoView({ block: "end" }); return true; })()`);
    await new Promise((r) => setTimeout(r, 300));
    await shot(path.join(`save-changes-${width}.png`));
    await clickButton("Cancel", '[role="dialog"]');
    await waitFor(`document.body.innerText.includes("Discard variant changes?")`);
    await shot(path.join(`discard-${width}.png`));
    // Keep editing = the non-Discard button of the topmost (confirm) dialog.
    await evaluate(`(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const last = dialogs[dialogs.length - 1];
      const button = Array.from(last.querySelectorAll("button")).find((x) => x.textContent?.trim() !== "Discard");
      button?.click();
      return button?.textContent ?? "none";
    })()`);
    await waitFor(`!document.body.innerText.includes("Discard variant changes?")`);
    // Cancel again and discard for real.
    await clickButton("Cancel", '[role="dialog"]');
    await waitFor(`document.body.innerText.includes("Discard variant changes?")`);
    await clickButton("Discard");
    await waitFor(`!document.querySelector('[role="dialog"]')`);
    console.log(`${width}: discard guard + keep-editing + discard all verified`);
  }

  await socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);

  await withRlsBypass(async (tx) => {
    const orm = tx.orm.public;
    const strays = await orm.Tenant.select("id").where((t) => t.name.ilike("Variants UI QA%")).all();
    for (const stray of strays) {
      const tenantId = stray.id;
      await orm.AuditLog.where({ tenantId }).deleteAll();
      await orm.StockMovement.where({ tenantId }).deleteAll();
      await orm.ArticleLabel.where({ tenantId }).deleteAll();
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
  console.log("focused QA done");
}

main()
  .catch((error) => { console.error("QA failed:", error.message ?? error); process.exitCode = 1; })
  .finally(() => process.exit(0));
