// The Android driver: an Android emulator on this machine, driven through adb (the Android Debug
// Bridge from the SDK's platform-tools). An Android site adapter gets this instead of a browser.
//
// It reads the screen (a picture, and the list of what is on it from uiautomator), taps, swipes,
// types and starts apps, exactly the things a person's finger does. Every command to the device is
// built from checked parts (numbers, package names, quoted text), never from text a profile wrote.
//
// Which device: the settings may name one (android_device, for example "emulator-5554"); otherwise
// the only emulator that is running. A phone on USB is never used unless the settings name it.
// Which adb: GODSPEED_WINGMAN_ADB in the environment, the SDK that `godspeed-wingman android setup`
// recorded or found, or adb on PATH. The settings file never names a program.
import { spawn } from "node:child_process";
import { findProgram } from "../core/exe.mjs";
import { currentSdk, PACKAGE } from "../android/sdk.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { PACKAGE };
export const DEVICE = /^[A-Za-z0-9._:-]{1,64}$/;
const UI_FILE = "/data/local/tmp/wingman-ui.xml";

export function findAdb({ env = process.env, platform = process.platform, home } = {}) {
  if (env.GODSPEED_WINGMAN_ADB) return { exe: env.GODSPEED_WINGMAN_ADB, args: [] };
  const sdk = currentSdk({ env, platform, home });
  if (sdk?.adb) return { exe: sdk.adb, args: [] };
  return findProgram("adb", { env, platform });
}

// ---- reading the screen ----------------------------------------------------------------------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});

// uiautomator's XML -> [{ index, parent, depth, text, desc, id, class, package, bounds:[x1,y1,x2,y2],
// clickable, scrollable, enabled, checked, selected, focused, password }], in screen order.
export function parseNodes(xml) {
  const out = [];
  const stack = [];
  for (const m of String(xml).matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === "</node>") { stack.pop(); continue; }
    const a = {};
    for (const at of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[at[1]] = decode(at[2]);
    const b = (a.bounds || "").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    const node = {
      index: out.length, parent: stack.length ? stack[stack.length - 1] : -1, depth: stack.length,
      text: a.text || "", desc: a["content-desc"] || "", id: a["resource-id"] || "", class: a.class || "", package: a.package || "",
      bounds: b ? b.slice(1, 5).map(Number) : [0, 0, 0, 0],
      clickable: a.clickable === "true", scrollable: a.scrollable === "true", enabled: a.enabled !== "false",
      checked: a.checked === "true", selected: a.selected === "true", focused: a.focused === "true", password: a.password === "true",
    };
    out.push(node);
    if (m[2] !== "/") stack.push(node.index);
  }
  return out;
}

export const center = (node) => [Math.round((node.bounds[0] + node.bounds[2]) / 2), Math.round((node.bounds[1] + node.bounds[3]) / 2)];
const inside = (n, x, y) => x >= n.bounds[0] && x < n.bounds[2] && y >= n.bounds[1] && y < n.bounds[3];
const area = (n) => Math.max(0, n.bounds[2] - n.bounds[0]) * Math.max(0, n.bounds[3] - n.bounds[1]);

// The node a tap at x,y lands on: the deepest one there (the smallest on a tie).
export function nodeAt(nodes, x, y) {
  return nodes.filter((n) => inside(n, x, y)).sort((a, b) => b.depth - a.depth || area(a) - area(b))[0] || null;
}

// What to look for: { text, textContains, textMatches, id, desc, descContains, class, clickable, scrollable }.
// `id` matches the whole resource id or the part after ":id/".
export function matches(n, q) {
  if (q.text !== undefined && n.text !== q.text) return false;
  if (q.textContains !== undefined && !n.text.toLowerCase().includes(String(q.textContains).toLowerCase())) return false;
  if (q.textMatches instanceof RegExp && !q.textMatches.test(n.text)) return false;
  if (q.id !== undefined && n.id !== q.id && !n.id.endsWith(`:id/${q.id}`)) return false;
  if (q.desc !== undefined && n.desc !== q.desc) return false;
  if (q.descContains !== undefined && !n.desc.toLowerCase().includes(String(q.descContains).toLowerCase())) return false;
  if (q.class !== undefined && n.class !== q.class) return false;
  if (q.clickable !== undefined && n.clickable !== q.clickable) return false;
  if (q.scrollable !== undefined && n.scrollable !== q.scrollable) return false;
  return true;
}
const describe = (q) => Object.entries(q).map(([k, v]) => `${k} ${v instanceof RegExp ? v : JSON.stringify(v)}`).join(", ");

// ---- typing ----------------------------------------------------------------------------------
// `input text` turns "%s" into a space and goes through the device's shell. So: plain printable
// characters only (adb cannot type others, and a message must not arrive garbled), a space as %s,
// a real "%s" split into two typings ("…%" then "s…", which `input text` leaves alone), each
// typing in single quotes for the shell.
export function typingChunks(text) {
  const t = String(text ?? "");
  const bad = [...t].find((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e);
  if (bad !== undefined) throw new Error(`adb can type only plain letters, digits and punctuation, and this text holds ${bad === "\n" ? "a line break" : `"${bad}"`}`);
  const parts = t.split("%s");
  return parts.map((p, i) => `${i ? "s" : ""}${p}${i < parts.length - 1 ? "%" : ""}`).filter(Boolean)
    .map((c) => `'${c.replace(/ /g, "%s").replace(/'/g, "'\\''")}'`);
}

const int = (v, what) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error(`${what} must be a number on the screen, not ${v}`);
  return n;
};

export class AndroidDriver {
  // adb: { exe, args } (tests hand in a pretend adb); device: the settings' android_device.
  constructor({ adb = null, device = "", log = () => {}, env = process.env, home, timeoutMs = 30000 } = {}) {
    this.adbProgram = adb;
    this.home = home;
    this.wanted = typeof device === "string" && DEVICE.test(device) ? device : "";
    this.log = log;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.serial = null;
  }

  get kind() { return "android"; }
  get where() { return this.serial ? `the Android device ${this.serial}` : "an Android emulator"; }

  program() {
    if (!this.adbProgram) this.adbProgram = findAdb({ env: this.env, home: this.home });
    if (!this.adbProgram) throw new Error("adb (Android's platform-tools) was not found; run `godspeed-wingman android setup` first.");
    return this.adbProgram;
  }

  // Runs adb once: { code, out (a Buffer with binary, else text), err }.
  run(args, { binary = false, timeoutMs = this.timeoutMs } = {}) {
    const p = this.program();
    return new Promise((resolve, reject) => {
      const c = spawn(p.exe, [...p.args, ...args], { env: this.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const out = [], err = [];
      const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } reject(new Error(`adb ${args.filter((a) => a !== "-s" && a !== this.serial).slice(0, 3).join(" ")} took longer than ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
      c.stdout.on("data", (d) => out.push(d));
      c.stderr.on("data", (d) => err.push(d));
      c.on("error", (e) => { clearTimeout(timer); reject(new Error(`adb could not be started: ${e.message}`)); });
      c.on("close", (code) => {
        clearTimeout(timer);
        const o = Buffer.concat(out);
        resolve({ code, out: binary ? o : o.toString("utf8"), err: Buffer.concat(err).toString("utf8") });
      });
    });
  }

  // [{ serial, state }] from `adb devices`.
  async devices() {
    const r = await this.run(["devices"]);
    if (r.code !== 0) throw new Error(`adb devices failed: ${(r.err || r.out).trim().split("\n")[0]}`);
    return r.out.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((x) => x.length >= 2 && x[0]).map(([serial, state]) => ({ serial, state }));
  }

  async device() {
    if (this.serial) return this.serial;
    const list = await this.devices();
    if (this.wanted) {
      const d = list.find((x) => x.serial === this.wanted);
      if (!d) throw new Error(`The Android device named in the settings (android_device: ${this.wanted}) is not connected.`);
      if (d.state !== "device") throw new Error(`The Android device ${this.wanted} is ${d.state}, not ready.`);
      return (this.serial = d.serial);
    }
    const emus = list.filter((d) => d.serial.startsWith("emulator-"));
    const ready = emus.filter((d) => d.state === "device");
    if (ready.length === 1) return (this.serial = ready[0].serial);
    if (ready.length > 1) throw new Error("Several Android emulators are running; name the Wingman's in the settings as android_device (for example emulator-5554).");
    if (emus.length) throw new Error(`The Android emulator is ${emus[0].state}, not ready yet.`);
    if (list.length) throw new Error("Only an Android device that is not an emulator is connected; the Wingman uses its emulator unless the settings name a device (android_device).");
    throw new Error("No Android emulator is running; start it with `godspeed-wingman android start`.");
  }

  async shell(args, opts) { return this.run(["-s", await this.device(), "shell", ...args], opts); }
  async execOut(args, opts) { return this.run(["-s", await this.device(), "exec-out", ...args], opts); }

  async health() {
    const serial = await this.device();
    const r = await this.shell(["getprop", "sys.boot_completed"]);
    if (r.out.trim() !== "1") throw new Error(`The Android emulator ${serial} is still starting.`);
    return { status: "ok", device: serial };
  }

  // ---- the picture and the screen ----
  async screencap() {
    const r = await this.execOut(["screencap", "-p"], { binary: true, timeoutMs: Math.max(this.timeoutMs, 60000) });
    if (r.code !== 0 || r.out.length < 8 || r.out.readUInt32BE(0) !== 0x89504e47) throw new Error(`the screen picture failed${r.err ? `: ${r.err.trim().split("\n")[0]}` : ""}`);
    return r.out;
  }
  screenshot() { return this.screencap(); }
  // The same shape as the browser's capture, so an adapter's picture() reads alike: the screen.
  async capture() {
    const data = await this.screencap();
    return { data, capture: "viewport", cut: false, size: `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}` };
  }

  // What is on the screen now. uiautomator sometimes refuses while the screen still moves, so it
  // is asked up to three times.
  async dump() {
    let last = "";
    for (let i = 0; i < 3; i++) {
      const d = await this.shell(["uiautomator", "dump", UI_FILE]);
      if (d.code === 0 && /dumped to/i.test(d.out)) {
        const r = await this.execOut(["cat", UI_FILE]);
        if (r.code === 0 && r.out.includes("<hierarchy")) return parseNodes(r.out);
        last = r.err || r.out;
      } else last = d.err || d.out;
      await sleep(500);
    }
    throw new Error(`could not read the screen: ${String(last).trim().split("\n")[0] || "uiautomator gave no answer"}`);
  }

  nodeAt(nodes, x, y) { return nodeAt(nodes, x, y); }
  find(q, nodes) { return (nodes || []).find((n) => matches(n, q)) || null; }
  findAll(q, nodes) { return (nodes || []).filter((n) => matches(n, q)); }

  async waitFor(q, { timeoutMs = 10000, everyMs = 500 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const n = this.find(q, await this.dump());
      if (n) return n;
      if (Date.now() >= end) throw new Error(`waited ${Math.round(timeoutMs / 1000)} s for ${describe(q)} on the screen`);
      await sleep(everyMs);
    }
  }

  // ---- the finger ----
  async tap(x, y) { await this.shell(["input", "tap", String(int(x, "x")), String(int(y, "y"))]); }
  async tapNode(node) { const [x, y] = center(node); return this.tap(x, y); }
  async tapBy(q, what) {
    const n = this.find(q, await this.dump());
    if (!n) throw new Error(`nothing on the screen ${what}`);
    await this.tapNode(n);
    return n;
  }
  tapText(text, { contains = false } = {}) { return this.tapBy(contains ? { textContains: text } : { text }, `says "${text}"`); }
  tapId(id) { return this.tapBy({ id }, `has the id ${id}`); }
  tapDesc(desc, { contains = false } = {}) { return this.tapBy(contains ? { descContains: desc } : { desc }, `is described as "${desc}"`); }

  async swipe(x1, y1, x2, y2, ms = 300) {
    await this.shell(["input", "swipe", ...[x1, y1, x2, y2].map((v, i) => String(int(v, i % 2 ? "y" : "x"))), String(int(ms, "the time"))]);
  }

  async size() {
    const r = await this.shell(["wm", "size"]);
    const all = [...r.out.matchAll(/(\w+) size:\s*(\d+)x(\d+)/g)];
    const m = all.find((x) => x[1] === "Override") || all[0];
    if (!m) throw new Error("the screen size is unknown");
    return { width: Number(m[2]), height: Number(m[3]) };
  }

  // One screen further up or down (fraction of the screen), from the middle.
  async scroll(direction = "down", { fraction = 0.5, ms = 400 } = {}) {
    const { width, height } = await this.size();
    const x = Math.round(width / 2), a = Math.round(height * (0.5 + fraction / 2)), b = Math.round(height * (0.5 - fraction / 2));
    if (direction === "down") return this.swipe(x, a, x, b, ms);
    if (direction === "up") return this.swipe(x, b, x, a, ms);
    const y = Math.round(height / 2), l = Math.round(width * 0.15), r = Math.round(width * 0.85);
    if (direction === "left") return this.swipe(r, y, l, y, ms);
    if (direction === "right") return this.swipe(l, y, r, y, ms);
    throw new Error(`scroll goes down, up, left or right, not ${direction}`);
  }

  async type(text) {
    for (const chunk of typingChunks(text)) await this.shell(["input", "text", chunk]);
  }

  async key(code) {
    const c = String(code);
    if (!/^(KEYCODE_[A-Z0-9_]+|\d{1,3})$/.test(c)) throw new Error(`not a key: ${code}`);
    await this.shell(["input", "keyevent", c]);
  }
  back() { return this.key(4); }

  // ---- apps ----
  async launch(pkg) {
    if (!PACKAGE.test(String(pkg))) throw new Error(`not an app package name: ${pkg}`);
    const r = await this.shell(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
    if (/no activities found|aborted/i.test(r.out + r.err) || r.code !== 0) throw new Error(`the app ${pkg} could not be started; is it installed in the emulator?`);
  }

  async current() {
    const r = await this.shell(["dumpsys", "window"]);
    const m = r.out.match(/mCurrentFocus=Window\{[^}]*?\s([\w.]+)\/([\w.$]+)\}/) || r.out.match(/mFocusedApp=.*?\s([\w.]+)\/([\w.$]+)/);
    if (!m) return { package: null, activity: null };
    return { package: m[1], activity: m[2].startsWith(".") ? m[1] + m[2] : m[2] };
  }

  async installed(pkg) {
    if (!PACKAGE.test(String(pkg))) throw new Error(`not an app package name: ${pkg}`);
    const r = await this.shell(["pm", "path", pkg]);
    return r.code === 0 && /^package:/m.test(r.out);
  }

  // The emulator keeps running when the worker stops; nothing to let go of.
  async close() {}
}

export function createDriver({ settings = {}, paths, log = () => {}, adb, env = process.env, home, timeoutMs } = {}) {
  return new AndroidDriver({ adb, device: settings.android_device || "", log, env, home, timeoutMs });
}
