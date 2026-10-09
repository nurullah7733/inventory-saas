import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StoredSession } from "../lib/client/session.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runProfileBrowserCheck(base: string, session: StoredSession) {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-profile-browser-"));
  const executable = process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9229", `--user-data-dir=${directory}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    let address = "";
    for (let attempt = 0; attempt < 60 && !address; attempt++) {
      try {
        const tabs = await (await fetch("http://127.0.0.1:9229/json/list")).json() as { type: string; webSocketDebuggerUrl?: string }[];
        address = tabs.find((tab) => tab.type === "page")?.webSocketDebuggerUrl ?? "";
      } catch { /* Browser starting. */ }
      if (!address) await delay(500);
    }
    assert.ok(address, "Browser did not start");
    socket = new WebSocket(address);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data));
      const task = pending.get(response.id); pending.delete(response.id);
      if (response.error) task?.reject(new Error(response.error.message)); else task?.resolve(response.result ?? {});
    });
    async function cdp(method: string, params: object = {}) {
      const id = ++sequence;
      const result = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { resolve, reject }));
      socket!.send(JSON.stringify({ id, method, params })); return result;
    }
    async function evaluate(expression: string) {
      const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression}`);
      return (response.result as { value?: unknown })?.value;
    }
    async function until(expression: string, label: string) {
      for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(250); }
      throw new Error(`${label}: ${JSON.stringify(await evaluate("({url:location.href,text:document.body?.textContent?.slice(0,800)})"))}`);
    }
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Page.navigate", { url: `${base}/login` });
    await until("location.pathname === '/login' && document.readyState === 'complete'", "Login not ready");
    await evaluate(`localStorage.setItem('inventory-saas.session', ${JSON.stringify(JSON.stringify(session))}); document.cookie='has_session=1; Path=/; SameSite=Lax'`);
    await cdp("Page.navigate", { url: `${base}/settings/profile` });
    await until("document.querySelector('input[name=name]')?.value === 'Profile QA User'", "Profile not ready");
    await mkdir(".next/profile-qa", { recursive: true });
    for (const width of [320, 375, 768, 1023]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false }); await delay(300);
      assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `Profile overflow at ${width}px`);
      await evaluate("document.querySelector('button[aria-label^=\"Account menu\"]')?.click()");
      await until("document.querySelector('[role=menu] a[href=\"/settings/profile\"]')", "Profile shortcut missing");
      assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true, `Menu overflow at ${width}px`);
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`.next/profile-qa/profile-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
      console.log(`Profile ${width}px layout passed.`);
    }
    const name = "Browser profile updated", email = `browser-profile-${Date.now()}@example.com`;
    for (const [key, value] of [["name", name], ["email", email]]) {
      await evaluate(`(()=>{const input=document.querySelector('input[name="${key}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Save profile')?.click()");
    await until(`document.querySelector('button[aria-label="Account menu for ${name}"]') && JSON.parse(localStorage.getItem('inventory-saas.session')).user.email === '${email}'`, "Header/session did not update");
    await cdp("Page.reload");
    await until(`document.querySelector('input[name=email]')?.value === '${email}' && document.querySelector('button[aria-label="Account menu for ${name}"]')`, "Profile did not persist after refresh");
    // Upload through the browser's own file input, then wait for auto-save.
    await evaluate(`(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'profile.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until("document.querySelector('button[aria-label^=\"Account menu\"] img') && JSON.parse(localStorage.getItem('inventory-saas.session')).user.photoUrl", "Photo upload did not update header");
    await cdp("Page.reload");
    await until("document.querySelector('button[aria-label^=\"Account menu\"] img')?.naturalWidth > 0 && document.querySelector('input[name=name]')", "Photo did not survive refresh");
    // Remove the browser-created file using only the URL returned for this fixture.
    const photoUrl = String(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).user.photoUrl"));
    await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Remove')?.click()");
    await until("!document.querySelector('button[aria-label^=\"Account menu\"] img') && JSON.parse(localStorage.getItem('inventory-saas.session')).user.photoUrl === null", "Photo removal failed");
    console.log("Profile browser save, header/session refresh, photo upload/removal and persistence passed.");
    return photoUrl;
  } finally { socket?.close(); browser.kill(); }
}
