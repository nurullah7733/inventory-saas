import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuthSessionPayload } from "../lib/auth/payload.ts";
import { localVerificationToken } from "./email-test-helpers.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runEmailBrowserCheck(base: string, payload: AuthSessionPayload, token: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-email-browser-"));
  const browser = spawn(process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9231", `--user-data-dir=${directory}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    let address = "";
    for (let i = 0; i < 60 && !address; i++) {
      try { const tabs = await (await fetch("http://127.0.0.1:9231/json/list")).json() as { type: string; webSocketDebuggerUrl?: string }[]; address = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* Starting. */ }
      if (!address) await delay(500);
    }
    assert.ok(address, "Browser did not start");
    socket = new WebSocket(address);
    await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve(), { once: true }); socket!.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const tasks = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    socket.addEventListener("message", (event) => { const response = JSON.parse(String(event.data)); const task = tasks.get(response.id); tasks.delete(response.id); if (response.error) task?.reject(new Error(response.error.message)); else task?.resolve(response.result ?? {}); });
    const cdp = async (method: string, params: object = {}) => { const id = ++sequence; const promise = new Promise<Record<string, unknown>>((resolve, reject) => tasks.set(id, { resolve, reject })); socket!.send(JSON.stringify({ id, method, params })); return promise; };
    const evaluate = async (expression: string) => { const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); assert.equal(Boolean(response.exceptionDetails), false, "Browser evaluation failed"); return (response.result as { value?: unknown })?.value; };
    const until = async (expression: string, label: string) => { for (let i = 0; i < 120; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(250); } throw new Error(`${label}: ${JSON.stringify(await evaluate("({path:location.pathname,hasFragment:Boolean(location.hash),text:document.body.innerText.slice(-800)})"))}`); };
    const click = (text: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)} && !b.disabled)?.click()`);
    await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
    await cdp("Network.setExtraHTTPHeaders", { headers: { "X-Forwarded-For": `198.18.5.${Date.now() % 254 + 1}` } });
    await cdp("Page.navigate", { url: `${base}/login` });
    await until("location.pathname==='/login' && document.readyState==='complete'", "Login not ready");
    const session = { user: payload.user, tenant: payload.tenant, refreshToken: payload.tokens.refreshToken, refreshExpiresAt: payload.tokens.refreshExpiresAt };
    await evaluate(`localStorage.setItem('inventory-saas.session',${JSON.stringify(JSON.stringify(session))});document.cookie='has_session=1; Path=/; SameSite=Lax'`);
    await cdp("Page.navigate", { url: `${base}/dashboard` });
    await until("location.pathname==='/verify-email' && document.querySelector('input[name=email]')", "Unverified web account was not redirected");
    await mkdir(".next/email-qa", { recursive: true });
    for (const width of [320, 375, 768, 1023]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false }); await delay(250);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), true, `Verification overflow at ${width}px`);
      assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).every(b=>b.getBoundingClientRect().height>=40)"), true, "Verification touch target too small");
      const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`.next/email-qa/verification-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
      console.log(`Email verification ${width}px layout passed.`);
    }
    await cdp("Page.navigate", { url: `${base}/verify-email#token=${token}` });
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Verify email')", "Verification button missing");
    assert.equal(await evaluate("location.hash"), "", "Verification token stayed in address bar");
    await cdp("Page.reload");
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Verify email')", "Reload lost verification link");
    await click("Verify email");
    await until("location.pathname==='/dashboard' && JSON.parse(localStorage.getItem('inventory-saas.session')).user.emailVerifiedAt", "Verification did not enable web workspace");
    assert.equal(await evaluate("sessionStorage.getItem('inventory-saas.email-verification-link')"), null, "Consumed verification link remained in tab storage");
    await cdp("Page.navigate", { url: `${base}/settings/profile` });
    await until("document.querySelector('input[name=email]') && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save profile')?.disabled", "Profile not ready");
    const oldEmail = payload.user.email, nextEmail = `browser-email-${Date.now()}@example.com`;
    await evaluate(`(()=>{const input=document.querySelector('input[name=email]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(nextEmail)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click("Save profile");
    await until(`JSON.parse(localStorage.getItem('inventory-saas.session')).user.pendingEmail===${JSON.stringify(nextEmail)}`, "Profile did not show pending email");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).user.email"), oldEmail, "Profile changed existing email before verification");
    const nextToken = await localVerificationToken(payload.user.id);
    await cdp("Page.navigate", { url: `${base}/verify-email#token=${nextToken}` });
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Verify email')", "New email verification button missing");
    await click("Verify email");
    await until(`location.pathname==='/dashboard' && JSON.parse(localStorage.getItem('inventory-saas.session')).user.email===${JSON.stringify(nextEmail)}`, "Verified new email did not update session");
    console.log("Browser verification redirect, explicit link confirmation, pending profile email and session refresh passed.");
  } finally { socket?.close(); browser.kill(); }
}
