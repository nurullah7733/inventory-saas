import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import type { StoredSession } from "../lib/client/session.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real authenticated fixture sessions only; no intercepted responses or mock data. */
export async function runUsersBrowserCheck(base: string, session: StoredSession) {
  const executable = process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9228", `--user-data-dir=${process.cwd()}/.next/users-browser-profile`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  try {
    let websocketUrl = "";
    for (let attempt = 0; attempt < 60 && !websocketUrl; attempt++) {
      try { const tabs = await (await fetch("http://127.0.0.1:9228/json/list")).json() as { type: string; webSocketDebuggerUrl?: string }[]; websocketUrl = tabs.find((tab) => tab.type === "page" && tab.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? ""; } catch { /* browser still starting */ }
      if (!websocketUrl) await delay(500);
    }
    assert.ok(websocketUrl, "Headless browser did not start");
    socket = new WebSocket(websocketUrl);
    await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve(), { once: true }); socket!.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      if (!message.id) return;
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result ?? {});
    });
    async function cdp(method: string, params: object = {}) {
      const id = ++sequence;
      const result = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { resolve, reject }));
      socket!.send(JSON.stringify({ id, method, params })); return result;
    }
    async function evaluate(expression: string) {
      const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error("Browser evaluation failed");
      return (response.result as { value?: unknown })?.value;
    }
    async function until(expression: string, message: string) {
      for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(250); }
      throw new Error(`${message}: ${JSON.stringify(await evaluate("({url: location.href, ready: document.readyState, text: document.body?.textContent?.slice(0, 500)})"))}`);
    }
    const clickText = async (label: string) => evaluate(`Array.from((document.querySelector('[role=dialog]') ?? document).querySelectorAll('button')).find(b => b.offsetParent !== null && b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Page.navigate", { url: `${base}/login` });
    await until("location.pathname === '/login' && document.readyState === 'complete'", "Login page not ready");
    await evaluate(`localStorage.setItem('inventory-saas.session', ${JSON.stringify(JSON.stringify(session))}); document.cookie = 'has_session=1; Path=/; SameSite=Lax'`);
    await cdp('Page.navigate',{url:`${base}/people/users`});
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Add user') && document.body.textContent.includes('Manager renamed')`, 'Users screen not ready');
    await mkdir('.next/users-qa',{recursive:true});
    for (const width of [320,375,768,1023]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false}); await delay(300);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),true,`Overflow at ${width}px`);
      await clickText('Add user');
      await until(`document.querySelector('[role=dialog] input[name=name]')`, 'Add form missing');
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),true,`Form overflow at ${width}px`);
      const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(`.next/users-qa/users-form-${width}.png`,Buffer.from(String(screenshot.data),'base64'));
      await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await until(`!document.querySelector('[role=dialog]')`, 'Escape did not close form');
      console.log(`Users layout and form ${width}px passed.`);
    }
    await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:960,deviceScaleFactor:1,mobile:false});
    await clickText('Add user');
    async function setField(name:string,value:string) {
      await evaluate(`(()=>{const input=document.querySelector('[role=dialog] [name="${name}"]');const prototype=input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    const name='Browser QA User',email=`browser-${Date.now()}@example.com`;
    await setField('name',name);await setField('email',email);await setField('password','Browser-staff-password');await setField('role','manager');
    await clickText('Create user');
    await until(`!document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('article h2')).some(h=>h.textContent==='Browser QA User')`, 'Browser creation failed');
    await evaluate(`document.querySelector('button[aria-label="Edit Browser QA User"]').click()`);
    await until(`document.querySelector('[role=dialog] input[name=name]')`, 'Edit form missing');
    await setField('name','Browser QA Updated');await setField('role','staff');await clickText('Save user');
    await until(`!document.querySelector('[role=dialog]') && document.body.textContent.includes('Browser QA Updated')`, 'Browser edit failed');
    await evaluate(`document.querySelector('button[aria-label="Deactivate Browser QA Updated"]').click()`);
    await until(`document.querySelector('[role=dialog]')?.textContent.includes('Deactivate user?')`, 'Deactivation confirmation missing');
    await clickText('Deactivate');
    await until(`!document.querySelector('[role=dialog]') && document.querySelector('button[aria-label="Reactivate Browser QA Updated"]')`, 'Browser deactivation failed');
    await cdp('Page.reload');
    await until(`document.querySelector('button[aria-label="Reactivate Browser QA Updated"]')`, 'Changed user did not persist');
    await evaluate(`document.querySelector('button[aria-label="Reactivate Browser QA Updated"]').click()`);
    await until(`document.querySelector('[role=dialog]')?.textContent.includes('Reactivate user?')`, 'Reactivation confirmation missing');
    await clickText('Reactivate');
    await until(`!document.querySelector('[role=dialog]') && document.querySelector('button[aria-label="Deactivate Browser QA Updated"]')`, 'Browser reactivation failed');
    console.log('Users browser interactions passed: responsive list/forms, add, edit role/name, deactivate, persistence and reactivate.');
  } finally {
    socket?.close(); browser.kill();
  }
}
