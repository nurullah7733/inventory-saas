import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Optional mobile UI check using an isolated Edge/Chrome CDP instance. */
export async function verifyPurchaseReturnUi(base: string, storedSession: unknown) {
  const endpoint = process.env.BROWSER_CDP_URL;
  if (!endpoint) return;
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("Browser connection failed")), { once: true }); });
  let id = 0;
  const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error.message)); else call.resolve(data.result);
  });
  function send(method: string, params: Record<string, unknown> = {}) {
    return new Promise<Record<string, unknown>>((resolve, reject) => { const callId = ++id; pending.set(callId, { resolve, reject }); socket.send(JSON.stringify({ id: callId, method, params })); });
  }
  async function evaluate(expression: string) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed");
    return (result.result as { value: unknown }).value;
  }
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("Purchase return UI did not reach expected state");
  }
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(base)}) { localStorage.setItem("inventory-saas.session", ${JSON.stringify(JSON.stringify(storedSession))}); document.cookie = "has_session=1; Path=/; SameSite=Lax"; }` });
    await send("Network.setCookie", { name: "has_session", value: "1", url: base, path: "/" });
    await send("Page.navigate", { url: `${base}/inventory/purchase-returns` });
    await waitFor(`document.querySelectorAll("article").length === 2`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, "Purchase return page must fit the mobile viewport");
    await evaluate(`Array.from(document.querySelectorAll("article button")).find(b => b.textContent === "Return to supplier").click()`);
    await waitFor(`!!document.querySelector('[role="dialog"] textarea')`);
    await evaluate(`const field = document.querySelector('[role="dialog"] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Browser QA return"); field.dispatchEvent(new Event("input", { bubbles: true }));`);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Confirm return").click()`);
    await waitFor(`!document.querySelector('[role="dialog"]')`);
    await evaluate(`Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Return history").click()`);
    await waitFor(`document.querySelectorAll("article").length === 5 && document.body.innerText.includes("Browser QA return")`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(".next/purchase-return-mobile.png", Buffer.from(String(screenshot.data), "base64"));
    console.log("Purchase return mobile browser check passed: receipt selection, form submission, credit history and viewport fit.");
  } finally {
    socket.close(); await fetch(`${endpoint}/json/close/${target.id}`);
  }
}
