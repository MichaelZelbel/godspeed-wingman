// The Wingman's own browser on this machine: Chrome or Edge with a profile of its own
// (<state>/browser), started with the remote debugging port on a free port of 127.0.0.1 and driven
// over the Chrome DevTools Protocol, through Node's own WebSocket (no extra package). It has the
// same methods as the Chrome Agent Bridge (bridge.mjs), so a site adapter never knows which one
// it has: health, goto, evaluate, capture (one element or the whole page, also beyond the window),
// screenshot, content.
//
// The person logs into the dating site once in that window; the login stays in the profile folder.
// The browser keeps running when the worker restarts, and the worker attaches to it again.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../core/exe.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// Chrome first, then Edge, then Chromium; GODSPEED_WINGMAN_BROWSER names another one.
export function findBrowser({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.GODSPEED_WINGMAN_BROWSER && isFile(env.GODSPEED_WINGMAN_BROWSER)) return env.GODSPEED_WINGMAN_BROWSER;
  let candidates = [];
  if (platform === "win32") {
    const pf = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    candidates = [
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(local, "Chromium", "Application", "chrome.exe"),
    ];
  } else if (platform === "darwin") {
    for (const root of ["/Applications", path.join(home, "Applications")]) {
      candidates.push(
        path.join(root, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        path.join(root, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        path.join(root, "Chromium.app", "Contents", "MacOS", "Chromium"),
      );
    }
  } else {
    for (const n of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"]) {
      const p = findProgram(n, { env, platform });
      if (p) return p.exe;
    }
    candidates = ["/snap/bin/chromium", "/usr/bin/chromium", "/opt/google/chrome/chrome"];
  }
  return candidates.find(isFile) || null;
}

// The port a running browser of this profile listens on, from the file Chrome writes into it.
function activePort(profileDir) {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(profileDir, "DevToolsActivePort"), "utf8").split(/\r?\n/);
    return Number(port) > 0 ? { port: Number(port), wsPath: wsPath || "" } : null;
  } catch { return null; }
}

async function getJson(url, { method = "GET", timeoutMs = 3000 } = {}) {
  const r = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}

// How long a browser the Wingman starts may take to open its control port. The first start after
// the computer started reads the whole browser program from a disk that has not read it yet:
// Chrome's main library alone is about 300 MB. On fresh GitHub Windows machines (October 2026,
// Chrome 156) that first read ran at 11 to 160 MB/s, against about 3400 MB/s once read, and the
// first start answered after 5.6 to 47 s, 6 of 20 after more than 20 s. Meanwhile the browser uses
// no CPU and looks hung, but it is waiting for the disk: two browsers started 10 s apart carried on
// in the same millisecond, and the next start on that machine answered in 0.3 s. So the wait is
// long, and it lasts only while the browser that was started still runs.
export const START_MS = 120000;
// After this long without an answer the log says the browser is still starting.
export const SLOW_MS = 20000;

// Waits until a browser started for `profileDir` opens its control port, the one Chrome names in
// the DevToolsActivePort file it writes into the profile, and that port answers. Returns the port,
// or null when the browser ended (`ended()`) or `startMs` passed. `alive(port)` asks the port.
export async function waitForPort({ profileDir, ended, startMs = START_MS, slowMs = SLOW_MS, log = () => {}, alive = (port) => getJson(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false) }) {
  const t0 = Date.now();
  let told = false;
  do {
    const p = activePort(profileDir);
    if (p && (await alive(p.port))) return p.port;
    if (ended()) return null;
    if (!told && Date.now() - t0 >= slowMs) {
      told = true;
      log(`the browser is still starting after ${Math.round((Date.now() - t0) / 1000)} s; the first start after the computer started can take a minute or two, so the Wingman waits up to ${Math.round(startMs / 1000)} s`);
    }
    await sleep(200);
  } while (Date.now() - t0 < startMs);
  return null;
}

// The bounding box of the first element matching `selector`, in page coordinates.
const boxScript = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const d = document.documentElement;
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, dw: Math.max(d.scrollWidth, d.clientWidth), dh: Math.max(d.scrollHeight, d.clientHeight) };
})()`;

export class ChromeDriver {
  // tab: "shared" drives the browser's first tab (the worker); "new" opens a tab of its own and
  // closes it again (a `check` while the worker runs). keepOpen: leave the browser running on close.
  // startMs: how long a browser it starts may take to open its control port (START_MS says why).
  constructor({ profileDir, headless = false, exe = null, log = () => {}, tab = "shared", keepOpen = true, timeoutMs = 45000, startMs = START_MS, windowSize = "1280,900" } = {}) {
    if (!profileDir) throw new Error("the local browser needs a profile folder");
    this.profileDir = profileDir;
    this.headless = headless;
    this.exe = exe;
    this.log = log;
    this.tab = tab;
    this.keepOpen = keepOpen;
    this.timeoutMs = timeoutMs;
    this.startMs = startMs;
    this.windowSize = windowSize;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.waiters = [];
    this.port = null;
    this.child = null;
    this.targetId = null;
    this.ownTab = false;
  }

  get kind() { return "local"; }
  get where() { return `the Wingman's own browser (${this.profileDir})`; }

  async alive(port) {
    try { return await getJson(`http://127.0.0.1:${port}/json/version`); } catch { return null; }
  }

  // Attaches to the profile's running browser, or starts one.
  async launch() {
    const running = activePort(this.profileDir);
    if (running && (await this.alive(running.port))) { this.port = running.port; return; }
    if (typeof globalThis.WebSocket !== "function") throw new Error("this Node has no WebSocket; the Wingman needs Node 22 or newer");
    const exe = this.exe || findBrowser();
    if (!exe) throw new Error("no Chrome or Edge found on this computer (install one, or set GODSPEED_WINGMAN_BROWSER to its program)");
    fs.mkdirSync(this.profileDir, { recursive: true });
    try { fs.unlinkSync(path.join(this.profileDir, "DevToolsActivePort")); } catch { /* none */ }
    const args = [
      `--user-data-dir=${this.profileDir}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
      `--window-size=${this.windowSize}`, ...(this.headless ? ["--headless=new", "--hide-scrollbars", "--mute-audio"] : []), "about:blank",
    ];
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: this.headless });
    this.child = child;
    // A program that cannot be started never sets an exit code, so its error ends the wait too.
    let failed = null;
    child.on("error", (e) => { failed = e; this.log(`the browser did not start: ${e.message}`); });
    if (this.keepOpen) child.unref();
    const t0 = Date.now();
    const ended = () => failed !== null || child.exitCode !== null || child.signalCode !== null;
    const port = await waitForPort({ profileDir: this.profileDir, ended, startMs: this.startMs, log: this.log, alive: async (p) => Boolean(await this.alive(p)) });
    if (port) { this.port = port; this.log(`browser started: ${path.basename(exe)}, port ${port}, after ${((Date.now() - t0) / 1000).toFixed(1)} s`); return; }
    if (failed) throw new Error(`the browser did not start: ${failed.message}`);
    if (ended()) throw new Error("the browser closed again before its control port answered");
    // A browser nobody can steer is of no use: it would hold the profile, so the next start only
    // hands over to it, and without keepOpen it keeps this process from ever ending.
    await this.stopChild();
    throw new Error(`the browser started but its control port never answered within ${Math.round(this.startMs / 1000)} s`);
  }

  // Stops the browser this driver started, if it still runs, and gives it up to 5 s to go.
  async stopChild() {
    const c = this.child;
    const gone = () => c.exitCode !== null || c.signalCode !== null;
    // Without a pid it never started.
    if (!c || c.pid === undefined || gone()) return;
    try { c.kill(); } catch { /* gone */ }
    for (let i = 0; i < 25 && !gone(); i++) await sleep(200);
  }

  async target() {
    const base = `http://127.0.0.1:${this.port}`;
    if (this.tab === "shared") {
      const list = await getJson(`${base}/json/list`).catch(() => []);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && !/^(devtools|chrome-extension|edge):/.test(t.url || ""));
      if (page) return page;
    }
    // Chrome 111 and newer want PUT here; older ones GET.
    let t = await getJson(`${base}/json/new?about:blank`, { method: "PUT" }).catch(() => null);
    if (!t) t = await getJson(`${base}/json/new?about:blank`);
    this.ownTab = this.tab === "new";
    return t;
  }

  async start() {
    if (this.ws && this.ws.readyState === 1) return;
    if (!this.port || !(await this.alive(this.port))) await this.launch();
    const t = await this.target();
    this.targetId = t.id;
    await this.connect(t.webSocketDebuggerUrl);
    await this.send("Page.enable");
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { try { ws.close(); } catch { /* gone */ } reject(new Error("the browser's control connection did not open")); }, 10000);
      ws.onopen = () => { clearTimeout(timer); this.ws = ws; resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("the browser refused the control connection")); };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        for (const [, p] of this.pending) p.reject(new Error("the browser closed the connection"));
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result || {});
          return;
        }
        if (msg.method) for (const w of [...this.waiters]) if (w.method === msg.method) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(msg.params || {}); }
      };
    });
  }

  send(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error("the browser is not connected"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} took longer than ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
      this.pending.set(id, { method, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs) {
    let entry, timer;
    const p = new Promise((resolve, reject) => {
      entry = { method, resolve: (v) => { clearTimeout(timer); resolve(v); } };
      this.waiters.push(entry);
      timer = setTimeout(() => { const i = this.waiters.indexOf(entry); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error(`${method} did not come within ${Math.round(timeoutMs / 1000)} s`)); } }, timeoutMs);
      timer.unref?.();
    });
    p.catch(() => {});
    return p;
  }

  async health() {
    await this.start();
    const v = await getJson(`http://127.0.0.1:${this.port}/json/version`);
    return { status: "ok", browser: v.Browser || "", port: this.port };
  }

  async goto(url) {
    await this.start();
    const loaded = this.once("Page.loadEventFired", this.timeoutMs);
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`the page did not open: ${r.errorText}`);
    // A move within the same page (only the #part changed) fires no load event.
    if (r.loaderId) await loaded.catch((e) => { this.log(`page load: ${e.message}`); });
    return { ok: true };
  }

  // Runs `js` in the page and returns its value (a promise is waited for). Reads may be repeated
  // after a lost connection (`attempts`); a script that changes something is run once.
  async evaluate(js, { attempts = 3 } = {}) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.start();
        const r = await this.send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          const err = new Error(`the page script failed: ${d.exception?.description || d.text || "an error"}`.slice(0, 400));
          err.script = true;
          throw err;
        }
        return r.result?.value;
      } catch (e) {
        last = e;
        if (e.script) throw e;
        if (i < attempts - 1) await sleep(1000 * (i + 1));
      }
    }
    throw last;
  }

  async screenshot() {
    await this.start();
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(r.data, "base64");
  }

  // A picture of one element (selector) or the whole page (full), also the parts below the window.
  // `max` caps the height in pixels; a longer one is cut and `cut` says so.
  async capture({ selector, full, pad = 0, format = "png", quality, max = 16000 } = {}) {
    await this.start();
    let clip;
    if (selector) {
      const b = await this.evaluate(boxScript(selector), { attempts: 1 });
      if (!b || !(b.w > 0) || !(b.h > 0)) throw new Error(`nothing on the page matches ${selector}`);
      const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
      clip = { x, y, width: Math.min(b.w + 2 * pad, Math.max(1, b.dw - x)), height: Math.min(b.h + 2 * pad, Math.max(1, b.dh - y)) };
    } else {
      const m = await this.send("Page.getLayoutMetrics");
      const c = m.cssContentSize || m.contentSize;
      clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height) };
    }
    const cut = clip.height > max;
    if (cut) clip.height = max;
    clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.max(1, Math.round(clip.width)), height: Math.max(1, Math.round(clip.height)), scale: 1 };
    const fmt = format === "jpeg" || format === "jpg" ? "jpeg" : "png";
    const r = await this.send("Page.captureScreenshot", { format: fmt, ...(fmt === "jpeg" && quality ? { quality: Math.max(1, Math.min(100, Math.round(quality))) } : {}), clip, captureBeyondViewport: true, fromSurface: true }, { timeoutMs: Math.max(this.timeoutMs, 90000) });
    return { data: Buffer.from(r.data, "base64"), capture: selector ? "element" : "full", cut, size: `${clip.width}x${clip.height}` };
  }

  content() { return this.evaluate("document.documentElement.outerHTML"); }

  // Lets go of the browser and leaves the tab as it is: the person logs in there (the desk's
  // "Open the Wingman's browser").
  async detach() {
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }

  // Lets go of the browser. With keepOpen false (tests, a one-off check that started it), the
  // browser itself is closed too.
  async close() {
    const port = this.port;
    if (this.ownTab && this.targetId && port) await fetch(`http://127.0.0.1:${port}/json/close/${this.targetId}`, { signal: AbortSignal.timeout(3000) }).catch(() => {});
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
    if (this.keepOpen) return;
    // Without a port there is nothing to ask; a browser this driver started is stopped all the same.
    if (port) {
      try {
        const v = await getJson(`http://127.0.0.1:${port}/json/version`);
        await new Promise((resolve) => {
          const ws = new WebSocket(v.webSocketDebuggerUrl);
          const done = () => { try { ws.close(); } catch { /* gone */ } resolve(); };
          ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: "Browser.close" })); setTimeout(done, 500); };
          ws.onerror = done;
          setTimeout(done, 3000);
        });
      } catch { /* already gone */ }
      for (let i = 0; i < 25 && this.child && this.child.exitCode === null; i++) await sleep(200);
    }
    await this.stopChild();
  }
}
