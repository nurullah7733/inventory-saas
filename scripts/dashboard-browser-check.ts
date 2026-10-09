import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import type { StoredSession } from "../lib/client/session.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real authenticated fixture sessions only; no intercepted responses or mock data. */
export async function runDashboardBrowserCheck(base: string, session: StoredSession) {
  const executable = process.env.DASHBOARD_BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9228", `--user-data-dir=${process.cwd()}/.next/dashboard-browser-profile`, "about:blank"], { stdio: "ignore", windowsHide: true });
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
      for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(expression)) return; await delay(250); }
      throw new Error(`${message}: ${JSON.stringify(await evaluate("({url: location.href, ready: document.readyState, text: document.body?.textContent?.slice(0, 500)})"))}`);
    }
    const clickText = async (label: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Page.navigate", { url: `${base}/login` });
    await until("location.pathname === '/login' && document.readyState === 'complete'", "Login page not ready");
    await evaluate(`localStorage.setItem('inventory-saas.session', ${JSON.stringify(JSON.stringify(session))}); document.cookie = 'has_session=1; Path=/; SameSite=Lax'`);
    await cdp("Page.navigate", { url: `${base}/dashboard` });
    await until("document.querySelector('[data-dashboard-amount]') && !document.body.textContent.includes('Loading comparison') && document.body.textContent.includes('DASH-1')", "Dashboard data did not load");
    await mkdir(".next/dashboard-qa", { recursive: true });
    async function chooseTheme(value: "system" | "light" | "dark") {
      if (value === "system") await evaluate("localStorage.removeItem('inventory-saas.theme'); window.dispatchEvent(new StorageEvent('storage', {key:'inventory-saas.theme', newValue:null}))");
      else {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (await evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(value)}`)) break;
          await evaluate("document.querySelector('button[role=\"switch\"][aria-label=\"Dark mode\"]').click()");
          await until("document.documentElement.dataset.theme !== 'system'", "Theme toggle did not apply");
        }
      }
      await until(`document.documentElement.dataset.theme === ${JSON.stringify(value)}`, "Theme preference did not apply");
    }
    await chooseTheme("system");
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await until("document.documentElement.classList.contains('dark')", "System dark theme did not apply");
    await chooseTheme("light");
    assert.equal(await evaluate("document.documentElement.style.colorScheme"), "light");
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await chooseTheme("dark");
    await cdp("Page.reload");
    await until("document.documentElement.dataset.theme === 'dark' && document.body.textContent.includes('DASH-1')", "Saved dark preference did not survive reload");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.ui-panel')).backgroundColor"), "rgb(33, 29, 42)");
    await chooseTheme("system");
    await until("document.documentElement.classList.contains('light')", "System light theme did not apply");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.ui-panel')).backgroundColor"), "rgb(255, 255, 255)");
    console.log("Theme browser checks passed: system dark/light, manual overrides, saved preference reload and actual CSS palette.");
    for (const width of [320, 375, 768, 1440]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
      await delay(400);
      const dimensions = await evaluate("({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})") as { width: number; scrollWidth: number };
      assert.ok(dimensions.scrollWidth <= dimensions.width, `Page overflow at ${width}: ${JSON.stringify(dimensions)}`);
      const layout = await evaluate(`(() => {
        const card = title => Array.from(document.querySelectorAll('section')).find(s => s.querySelector('h2')?.textContent === title)?.getBoundingClientRect();
        const sales = card('Sales overview'), dues = card('Receivable / Payable'), stock = card('Stock alerts'), products = card('Top selling products'), invoices = card('Recent invoices'), categories = card('Sales by category'), returns = card('Returns summary');
        const grid = document.querySelector('[aria-label="Dashboard analytics"] > .ui-card-grid'); return {gap:parseFloat(getComputedStyle(grid).rowGap), productsTop: products.top, invoicesTop: invoices.top, salesBottom: sales.bottom, duesBottom: dues.bottom, categoryBottom: categories.bottom, returnsBottom: returns.bottom};
      })()`) as Record<string, number>;
      assert.ok(layout.productsTop - layout.salesBottom >= layout.gap - 1, `Sales and products overlap at ${width}`);
      assert.ok(layout.invoicesTop - layout.duesBottom >= layout.gap - 1, `Dues and invoices overlap at ${width}`);
      if (width >= 1280) {
        assert.ok(Math.abs(layout.productsTop - layout.salesBottom - layout.gap) <= 1, "Extra gap between sales and products");
        assert.ok(Math.abs(layout.invoicesTop - layout.duesBottom - layout.gap) <= 1, "Extra gap between dues and invoices");
        assert.ok(Math.abs(layout.categoryBottom - layout.returnsBottom) <= 1, "Category/returns row heights differ");
      }
      if (width < 1024) {
        await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]')?.click()");
        await until("document.querySelector('#mobile-navigation')?.open", "Mobile navigation not open");
        await clickText("Products"); await delay(250);
        assert.equal(await evaluate("document.querySelector('#mobile-navigation button[aria-expanded=\"true\"]')?.textContent.trim()"), "Products");
        await clickText("Stock"); await delay(250);
        assert.equal(await evaluate("document.querySelector('#mobile-navigation button[aria-expanded=\"true\"]')?.textContent.trim()"), "Stock");
        assert.equal(await evaluate("document.querySelectorAll('#mobile-navigation button[aria-expanded=\"true\"]').length"), 1);
        await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await until("!document.querySelector('#mobile-navigation')?.open", "Escape did not close navigation");
      }
      const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`.next/dashboard-qa/dashboard-${width}.png`, Buffer.from(String(screenshot.data), "base64"));
      console.log(`Dashboard browser: ${width}px passed overflow and navigation checks.`);
    }
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('aside button[aria-label=\"Collapse sidebar\"]')?.focus(); Array.from(document.querySelectorAll('aside nav button')).find(b => b.textContent.trim() === 'Settings')?.scrollIntoView({block:'nearest'})");
    assert.equal(await evaluate("(() => { const signout = Array.from(document.querySelectorAll('aside nav button')).find(b => b.textContent.trim() === 'Settings').getBoundingClientRect(); const plan = document.querySelector('aside [aria-label=\"Workspace plan\"]').getBoundingClientRect(); return signout.bottom <= plan.top && signout.top >= 80; })()"), true, "Sidebar settings hidden behind plan");
    await evaluate("document.querySelector('button[aria-label=\"Collapse sidebar\"]')?.click()");
    const productPosition = await evaluate("(() => { const button = document.querySelector('aside button[aria-label=\"Products\"]'); button.scrollIntoView({block: 'nearest'}); const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()") as { x: number; y: number };
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...productPosition });
    await until("document.querySelector('aside button[aria-label=\"Products\"]')?.getAttribute('aria-expanded') === 'true'", "Collapsed hover flyout did not open");
    const flyoutCheck = await evaluate("(() => { const link = Array.from(document.querySelectorAll('aside a')).find(a => a.textContent.trim() === 'Variant options'); const r = link.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + 5, r.y + 5); return {visible: r.width > 0 && r.left >= 72 && hit?.closest('a') === link, rect: {x:r.x,y:r.y,width:r.width,height:r.height}, hit:hit?.outerHTML.slice(0,300), panel:link.closest('[aria-hidden]')?.outerHTML.slice(0,300)}; })()") as { visible: boolean; rect: { x: number; y: number; width: number; height: number } };
    const flyoutScreenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(".next/dashboard-qa/sidebar-flyout.png", Buffer.from(String(flyoutScreenshot.data), "base64"));
    assert.equal(flyoutCheck.visible, true, `Flyout clipped: ${JSON.stringify(flyoutCheck)}`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: flyoutCheck.rect.x + flyoutCheck.rect.width / 2, y: flyoutCheck.rect.y + flyoutCheck.rect.height / 2 });
    assert.equal(await evaluate("document.querySelector('aside button[aria-label=\"Products\"]').getAttribute('aria-expanded')"), "true", "Flyout closed while moving to submenu");
    await evaluate("document.querySelector('button[aria-label=\"Expand sidebar\"]')?.click()");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}))");
    await until("Array.from(document.querySelectorAll('dialog')).some(d => d.open && d.textContent.includes('Pages & quick actions'))", "Command palette did not open");
    assert.equal(await evaluate("document.activeElement?.type"), "search");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await clickText("Today");
    await until("document.body.textContent.includes('1 completed invoices') && !document.body.textContent.includes('Updating…')", "Today filter did not settle");
    await evaluate("document.querySelector('button[aria-label=\"Choose date range\"]')?.click()");
    await until("Array.from(document.querySelectorAll('dialog')).some(d => d.open && d.getAttribute('aria-label') === 'Choose dashboard date range')", "Range picker did not open");
    for (const index of [0, 1]) {
      await evaluate(`(() => { const input = document.querySelectorAll('dialog[open] input[type=date]')[${index}]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2020-01-01'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    }
    await clickText("Use date range");
    await until("document.body.textContent.includes('2020-01-01 to 2020-01-01') && document.body.textContent.includes('No sales or purchases in this period yet') && !document.body.textContent.includes('Loading comparison') && !document.body.textContent.includes('Updating')", "Empty date range did not settle");
    const emptySpacing = await evaluate("(() => { const cards = Array.from(document.querySelectorAll('section')); const sales = cards.find(s => s.querySelector('h2')?.textContent === 'Sales overview'); const products = cards.find(s => s.querySelector('h2')?.textContent === 'Top selling products'); return {expectedGap:parseFloat(getComputedStyle(products.closest('.ui-card-grid')).rowGap), expectedPadding:parseFloat(getComputedStyle(sales).paddingBottom)+parseFloat(getComputedStyle(sales).borderBottomWidth), gap:products.getBoundingClientRect().top-sales.getBoundingClientRect().bottom, bottomPadding:sales.getBoundingClientRect().bottom-sales.lastElementChild.getBoundingClientRect().bottom}; })()") as { gap: number; bottomPadding: number; expectedGap: number; expectedPadding: number };
    assert.ok(Math.abs(emptySpacing.gap - emptySpacing.expectedGap) <= 1, `Empty Sales-to-Products gap: ${emptySpacing.gap}`);
    assert.ok(emptySpacing.bottomPadding <= emptySpacing.expectedPadding + 1, `Blank space inside empty Sales card: ${emptySpacing.bottomPadding}`);
    const emptyScreenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(".next/dashboard-qa/dashboard-empty.png", Buffer.from(String(emptyScreenshot.data), "base64"));
    await evaluate("document.querySelector('button[aria-label^=\"Account menu for\"]')?.click()");
    await until("document.querySelector('[role=menu]')?.textContent.includes('Subscription & billing')", "Profile menu not available");
    await evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).find(b => b.textContent.trim() === 'Sign out')?.click()");
    await until("location.pathname === '/login'", "Sign out did not redirect to login");
    console.log("Dashboard browser interactions passed: accordion, drawer Escape, command palette, Today preset, range picker, profile billing link and real sign out.");
  } finally {
    socket?.close(); browser.kill();
  }
}
