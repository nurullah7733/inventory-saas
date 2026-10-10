import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runRecoveryBrowserCheck(base: string, token: string, email: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-recovery-browser-"));
  const browser = spawn(process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9232", `--user-data-dir=${directory}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    let address = "";
    for (let i = 0; i < 60 && !address; i++) {
      try { const tabs = await (await fetch("http://127.0.0.1:9232/json/list")).json() as { type: string; webSocketDebuggerUrl?: string }[]; address = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* Starting. */ }
      if (!address) await delay(500);
    }
    assert.ok(address, "Browser did not start"); socket = new WebSocket(address);
    await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve(), { once: true }); socket!.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const tasks = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    socket.addEventListener("message", (event) => { const response = JSON.parse(String(event.data)); const task = tasks.get(response.id); tasks.delete(response.id); if (response.error) task?.reject(new Error(response.error.message)); else task?.resolve(response.result ?? {}); });
    const cdp = async (method: string, params: object = {}) => { const id = ++sequence; const promise = new Promise<Record<string, unknown>>((resolve, reject) => tasks.set(id, { resolve, reject })); socket!.send(JSON.stringify({ id, method, params })); return promise; };
    const evaluate = async (expression: string) => { const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); assert.equal(Boolean(response.exceptionDetails), false, "Browser evaluation failed"); return (response.result as { value?: unknown })?.value; };
    const until = async (expression: string, label: string) => { for (let i = 0; i < 160; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(250); } throw new Error(`${label}: ${JSON.stringify(await evaluate("({path:location.pathname,text:document.body.innerText.slice(-800)})"))}`); };
    const click = (text: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)} && !b.disabled)?.click()`);
    const fill = (name: string, value: string) => evaluate(`(()=>{const input=document.querySelector('input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
    await cdp("Network.setExtraHTTPHeaders", { headers: { "X-Forwarded-For": `198.18.10.${Date.now() % 254 + 1}` } });
    await mkdir(".next/recovery-qa", { recursive: true });
    for (const route of ["forgot-password", "reset-password"]) {
      await cdp("Page.navigate", { url: `${base}/${route}${route === "reset-password" ? `#token=${token}` : ""}` });
      await until(route === "forgot-password" ? "document.querySelector('input[name=email]')" : "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Reset password' && !b.disabled)", `${route} not ready`);
      for (const width of [320, 375, 768, 1023]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(250);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), true, `${route} overflow at ${width}px`);
        assert.equal(await evaluate("Array.from(document.querySelectorAll('form button,form a')).every(b=>b.getBoundingClientRect().height>=40)"), true, `${route} touch targets`);
        const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(`.next/recovery-qa/${route}-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
        console.log(`${route} ${width}px layout passed.`);
      }
      if (route === "forgot-password") {
        await fill("email", `browser-unknown-${Date.now()}@example.com`); await click("Send reset link");
        await until("document.querySelector('[role=status]')?.textContent.includes('If an eligible account')", "Generic request response missing");
      }
    }
    assert.equal(await evaluate("location.hash"), "", "Reset token not removed from address bar");
    await cdp("Page.reload"); await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Reset password' && !b.disabled)", "Reload lost reset token");
    await fill("newPassword", "Recovery-QA-browser-password"); await fill("confirmPassword", "mismatch"); await click("Reset password");
    await until("document.body.textContent.includes('Passwords do not match')", "Password confirmation missing");
    await fill("confirmPassword", "Recovery-QA-browser-password"); await click("Reset password");
    await until("document.body.textContent.includes('Your password has been reset')", "Browser reset did not succeed");
    assert.equal(await evaluate("sessionStorage.getItem('inventory-saas.password-reset-link')"), null, "Used token retained in tab");
    assert.equal(await evaluate("localStorage.getItem('inventory-saas.session')"), null, "Local session not cleared");
    await cdp("Page.navigate", { url: `${base}/login` }); await until("document.querySelector('input[name=email]')", "Login missing");
    await fill("email", email); await fill("password", "Recovery-QA-browser-password"); await click("Sign in");
    await until("location.pathname==='/dashboard' && localStorage.getItem('inventory-saas.session')", "New password browser login failed");
    await cdp("Page.navigate", { url: `${base}/reset-password#token=${token}` });
    await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Reset password' && !b.disabled)", "Recovery page unavailable while signed in");
    await fill("newPassword", "Recovery-QA-browser-password"); await fill("confirmPassword", "Recovery-QA-browser-password"); await click("Reset password");
    await until("document.body.textContent.includes('invalid') || document.body.textContent.includes('expired')", "Used reset link not rejected");
    console.log("Browser generic request, confirmation, token reload, single-use reset and password login passed.");
  } finally { socket?.close(); browser.kill(); }
}
