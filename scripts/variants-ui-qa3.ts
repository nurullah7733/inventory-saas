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
    for (const name of ["37", "38", "39"]) {
      const row = await tx.orm.public.VariantSize.select("id").create(own({ name }));
      sizes[name] = row.id;
    }
    const colors: Record<string, string> = {};
    for (const name of ["Red", "Gray"]) {
      const row = await tx.orm.public.VariantColor.select("id").create(own({ name }));
      colors[name] = row.id;
    }
    const heel = await tx.orm.public.Product.select("id").create(own({ name: "Ladies Heel with a deliberately long product name for label wrapping", sku: "LH", stockQty: numeric<12, 3>(9), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
    for (const [sizeName, sizeId] of Object.entries(sizes)) {
      for (const [colorName, colorId] of Object.entries(colors)) {
        await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku: `LH-${sizeName}-${colorName.slice(0, 3).toUpperCase()}`, label: `${sizeName} / ${colorName}`, sizeId, colorId, stockQty: numeric<12, 3>(3), costPrice: numeric("550.00"), sellPrice: numeric("600.00") }));
      }
    }
    await tx.orm.public.ProductVariant.select("id").create(own({ productId: heel.id, sku: "LH-40-RED", label: "40 / Red", sizeId: sizes["39"]!, colorId: colors["Red"]!, stockQty: numeric<12, 3>(1), costPrice: numeric("550.00"), sellPrice: numeric("600.00"), isActive: false }));
    return { tenantId: tenant.id, user };
  });

  const session = await withRlsBypass(() => issueSession({ userId: created.user.id, tenantId: created.tenantId, deviceId: "qa" }));
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
    if (result.exceptionDetails) {
      const detail = JSON.stringify(result.exceptionDetails, null, 1);
      throw new Error(`Eval failed for: ${expression.slice(0, 120)} :: ${detail.slice(0, 240)}`);
    }
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
  function scrollFirstVisible(selector: string, text: string) {
    return evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((n) => n.offsetParent !== null && n.textContent?.includes(${JSON.stringify(text)}));
      el?.scrollIntoView({ block: "center" });
      return !!el;
    })()`);
  }

  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)} && !localStorage.getItem("inventory-saas.session")) { localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(storedSession))}); document.cookie = "has_session=1; Path=/; SameSite=Lax"; }` });
  await send("Network.setCookie", { name: "has_session", value: "1", url: base, path: "/" });
  // A stale session from an earlier run (deleted tenant) must not survive.
  await send("Page.navigate", { url: `${base}/login` });
  await waitFor(`!!document.body`);
  await evaluate(`localStorage.clear()`);

  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 700, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${base}/inventory/products` });
  await waitFor(`document.body.innerText.includes("Ladies Heel")`);
  await evaluate(`(() => {
    const card = Array.from(document.querySelectorAll("article, li, div")).find((el) => (el.querySelector("h2, h3, p")?.textContent ?? "").includes("Ladies Heel") && Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Edit"));
    if (!card) return false;
    Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Edit").click();
    return true;
  })()`);
  await waitFor(`!!document.querySelector('[role="dialog"] input[aria-label="SKU for 37 / Red"]')`);
  await scrollFirstVisible("li", "37 / Gray");
  await new Promise((r) => setTimeout(r, 300));
  await shot(path.join(`edit-mobile-cards-360.png`));
  // Deactivate one via mobile card checkbox.
  await evaluate(`(() => {
    const box = Array.from(document.querySelectorAll('[role="dialog"] li input[type="checkbox"]')).find((b) => b.getAttribute("aria-label")?.includes("39 / Gray"));
    box?.click();
    return !!box;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await scrollFirstVisible("li", "37 / Gray");
  await new Promise((r) => setTimeout(r, 300));
  await shot(path.join(`edit-mobile-inactive-360.png`));
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find((x) => x.textContent?.trim() === "Save 1 change"); b?.scrollIntoView({ block: "end" }); return true; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await shot(path.join(`edit-mobile-save-360.png`));
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent?.trim() === "Cancel").click()`);
  await waitFor(`document.body.innerText.includes("Discard variant changes?")`);
  await shot(path.join(`discard-360.png`));
  await evaluate(`(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const last = dialogs[dialogs.length - 1];
    Array.from(last.querySelectorAll("button")).find((x) => x.textContent?.trim() === "Discard")?.click();
    return true;
  })()`);
  await waitFor(`!document.querySelector('[role="dialog"]')`);
  console.log("360 edit visuals captured");

  await socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);

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
  console.log("done");
}

main()
  .catch((error) => { console.error("QA failed:", error.message ?? error); process.exitCode = 1; })
  .finally(() => process.exit(0));
