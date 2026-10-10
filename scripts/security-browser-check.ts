import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StoredSession } from "../lib/client/session.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runSecurityBrowserCheck(base: string, session: StoredSession, password: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-security-browser-"));
  const executable = process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9230", `--user-data-dir=${directory}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    let address = "";
    for (let attempt = 0; attempt < 60 && !address; attempt++) {
      try {
        const tabs = await (await fetch("http://127.0.0.1:9230/json/list")).json() as { type: string; webSocketDebuggerUrl?: string }[];
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
      throw new Error(`${label}: ${JSON.stringify(await evaluate("({url:location.href,text:document.body?.textContent?.slice(-1100)})"))}`);
    }
    const click = (text: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.offsetParent!==null && button.textContent===${JSON.stringify(text)})?.click()`);
    async function field(name: string, value: string) {
      await evaluate(`(()=>{const input=document.querySelector('input[name="${name}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Network.enable");
    // Isolate test rate-limit buckets from the operator's development browser.
    await cdp("Network.setExtraHTTPHeaders", { headers: { "X-Forwarded-For": `198.18.1.${Date.now() % 254 + 1}` } });
    await cdp("Page.navigate", { url: `${base}/login` });
    await until("location.pathname === '/login' && document.readyState === 'complete'", "Login not ready");
    await evaluate(`localStorage.setItem('inventory-saas.session', ${JSON.stringify(JSON.stringify(session))}); document.cookie='has_session=1; Path=/; SameSite=Lax'`);
    await cdp("Page.navigate", { url: `${base}/settings/profile` });
    await until("document.querySelector('input[name=currentPassword]') && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Enable PIN')?.disabled", "Security form not ready");
    await mkdir(".next/security-qa", { recursive: true });
    for (const width of [320, 375, 768, 1023]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false }); await delay(300);
      await evaluate("document.querySelector('#account-security-heading').scrollIntoView()");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), true, `Security overflow at ${width}px`);
      const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`.next/security-qa/security-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
      console.log(`Account security ${width}px layout passed.`);
    }
    await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 960, deviceScaleFactor: 1, mobile: false });
    const originalRefresh = await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).refreshToken");
    const nextPassword = "Security-browser-new-password";
    await field("currentPassword", "wrong-password"); await field("newPassword", nextPassword); await field("confirmPassword", nextPassword);
    await click("Change password");
    await until("document.body.textContent.includes('Your current password is incorrect.')", "Wrong current password not shown");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).refreshToken"), originalRefresh, "Wrong password rotated session");
    await field("password", password); await field("pin", "1111"); await field("confirmPin", "1111"); await click("Enable PIN");
    await until("document.body.textContent.includes('PIN cannot be four identical digits.')", "Weak PIN validation missing");
    await field("pin", "8317"); await field("confirmPin", "8317"); await click("Enable PIN");
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Disable PIN') && JSON.parse(localStorage.getItem('inventory-saas.session')).user.pinEnabled", "PIN enable did not update session");
    assert.equal(await evaluate("document.querySelector('input[name=password]').value"), "", "Password not cleared after PIN enable");
    await click("Lock screen");
    await until("location.pathname==='/unlock' && document.querySelector('input[name=pin]')", "Lock did not open unlock screen");
    for (const width of [320, 375, 768, 1023]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false }); await delay(300);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), true, `Unlock overflow at ${width}px`);
      const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`.next/security-qa/unlock-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
      console.log(`PIN unlock ${width}px layout passed.`);
    }
    await cdp("Page.reload");
    await until("location.pathname==='/unlock' && document.querySelector('input[name=pin]')", "Reload bypassed lock");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).locked"), true);
    await field("pin", "9999"); await click("Unlock");
    await until("document.body.textContent.includes('Incorrect PIN.')", "Incorrect PIN not shown");
    await field("pin", "8317"); await click("Unlock");
    await until("location.pathname==='/settings/profile' && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Change password' && !b.disabled)", "Correct PIN did not resume profile");
    assert.notEqual(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).refreshToken"), originalRefresh, "PIN unlock did not rotate session");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).locked===true"), false);
    await field("currentPassword", password); await field("newPassword", nextPassword); await field("confirmPassword", "mismatched-password");
    await click("Change password");
    await until("document.body.textContent.includes('Passwords do not match.')", "Password confirmation missing");
    const beforePassword = await evaluate("JSON.parse(localStorage.getItem('inventory-saas.session')).refreshToken");
    await field("confirmPassword", nextPassword); await click("Change password");
    await until(`document.querySelector('input[name=currentPassword]')?.value==='' && JSON.parse(localStorage.getItem('inventory-saas.session')).refreshToken !== ${JSON.stringify(beforePassword)}`, "Password token replacement failed");
    await cdp("Page.reload");
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Disable PIN' && !b.disabled)", "New session did not survive reload");
    await field("password", nextPassword); await click("Disable PIN");
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Enable PIN') && !JSON.parse(localStorage.getItem('inventory-saas.session')).user.pinEnabled", "PIN disable failed");
    await field("password", nextPassword); await field("pin", "8317"); await field("confirmPin", "8317"); await click("Enable PIN");
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Disable PIN')", "PIN re-enable failed");
    // Use the header shortcut as well as the profile's Lock screen button.
    await evaluate("document.querySelector('button[aria-label^=\"Account menu\"]')?.click()");
    await until("document.querySelector('[role=menu]')", "Account menu missing");
    await evaluate("Array.from(document.querySelectorAll('[role=menu] button')).find(b=>b.textContent==='Lock screen')?.click()");
    await until("location.pathname==='/unlock' && document.querySelector('input[name=pin]')", "Header lock failed");
    for (let attempt = 0; attempt < 5; attempt++) {
      await field("pin", "9999"); await click("Unlock");
      await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Use password instead' && !b.disabled) && document.querySelector('input[name=pin]')?.value===''", "PIN attempt not completed");
    }
    await until("document.body.textContent.includes('Too many incorrect PINs.')", "PIN lockout missing");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Unlock')?.disabled"), true);
    await click("Use password instead");
    await until("location.pathname==='/login' && document.querySelector('input[name=email]')", "Password fallback unreachable");
    await field("email", session.user.email); await field("password", nextPassword); await click("Sign in");
    await until("location.pathname==='/dashboard' && !JSON.parse(localStorage.getItem('inventory-saas.session')).locked", "Password sign-in fallback failed");
    console.log("Browser security interactions passed: confirmation, PIN enable/disable, header/profile lock, lock persistence, wrong PIN, unlock rotation, password token replacement, PIN lockout and full password fallback.");
  } finally { socket?.close(); browser.kill(); }
}
