// The local browser driver against a real Chrome or Edge on this machine, without a window: open a
// page, run a script in it, take a picture of an element far below the window. Skipped when no
// Chrome or Edge is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { ChromeDriver, findBrowser, waitForPort, START_MS } from "../lib/drivers/chrome.mjs";
import { createDriver } from "../lib/drivers/index.mjs";
import { Bridge } from "../lib/drivers/bridge.mjs";
import { imageSize } from "../lib/core/image.mjs";

const exe = findBrowser();
const skip = exe ? false : "no Chrome or Edge on this machine";

// The colour of one pixel of an 8-bit RGB or RGBA PNG (no interlace), enough to see what a picture shows.
function pngPixel(buf, x, y) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], type = buf[25];
  assert.equal(depth, 8);
  const bpp = type === 6 ? 4 : type === 2 ? 3 : null;
  assert.ok(bpp, `colour type ${type}`);
  const parts = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), kind = buf.toString("ascii", i + 4, i + 8);
    if (kind === "IDAT") parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  let row = null;
  for (let r = 0; r <= Math.min(y, h - 1); r++) {
    const f = raw[r * (stride + 1)];
    const line = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[i] = (line[i] + pred) & 0xff;
    }
    prev = line;
    row = line;
  }
  return [...row.subarray(x * bpp, x * bpp + 3)];
}

const PAGE = `<!doctype html><html><head><title>wingman test</title></head><body style="margin:0;background:#fff">
<div style="height:3000px">top of a long page</div>
<div id="far" data-mask style="width:320px;height:240px;background:rgb(200,30,40)">far below the window</div>
<div style="height:600px"></div></body></html>`;

// The first start on a fresh machine may take up to START_MS (two minutes); the work after it a few seconds.
test("the local driver opens a page, runs a script, and pictures an element far below the window", { skip, timeout: START_MS + 60000 }, async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-chrome-"));
  const d = new ChromeDriver({ profileDir, headless: true, keepOpen: false });
  let second = null;
  try {
    const health = await d.health();
    assert.equal(health.status, "ok");
    assert.match(health.browser, /Chrome|Edg|Chromium/i);
    assert.ok(fs.existsSync(path.join(profileDir, "DevToolsActivePort")), "the browser keeps its own profile folder");
    await d.goto(`data:text/html,${encodeURIComponent(PAGE)}`);
    assert.equal(await d.evaluate("document.title"), "wingman test");
    assert.deepEqual(await d.evaluate("(async () => { await new Promise((r) => setTimeout(r, 30)); return { tall: document.body.scrollHeight > 3500, below: document.getElementById('far').getBoundingClientRect().top > innerHeight }; })()"), { tall: true, below: true });
    await assert.rejects(d.evaluate("(() => { throw new Error('boom from the page'); })()"), /boom from the page/);

    const shot = await d.capture({ selector: "#far", format: "png" });
    assert.equal(shot.capture, "element");
    assert.deepEqual(imageSize(shot.data), { width: 320, height: 240 });
    assert.deepEqual(pngPixel(shot.data, 160, 120), [200, 30, 40], "the picture shows the element, not the top of the page");
    const padded = await d.capture({ selector: "[data-mask]", pad: 16, format: "jpeg", quality: 72 });
    assert.equal(padded.data[0], 0xff, "a JPEG when asked");
    assert.deepEqual(imageSize(padded.data), { width: 352, height: 272 });
    const full = await d.capture({ full: true, format: "jpeg", quality: 60 });
    assert.equal(full.capture, "full");
    assert.ok(imageSize(full.data).height >= 3800, `the whole page: ${JSON.stringify(imageSize(full.data))}`);
    const cut = await d.capture({ full: true, format: "png", max: 1000 });
    assert.equal(cut.cut, true);
    assert.equal(imageSize(cut.data).height, 1000);
    await assert.rejects(d.capture({ selector: "#nothing" }), /nothing on the page matches #nothing/);
    assert.match(await d.content(), /far below the window/);
    assert.ok((await d.screenshot()).length > 100, "the window alone too");

    // A second driver on the same profile attaches to the running browser in a tab of its own.
    second = new ChromeDriver({ profileDir, headless: true, tab: "new", keepOpen: true });
    assert.equal((await second.health()).port, health.port, "no second browser is started");
    await second.goto("data:text/html,<title>second tab</title>");
    assert.equal(await second.evaluate("document.title"), "second tab");
    assert.equal(await d.evaluate("document.title"), "wingman test", "the first tab was left alone");
  } finally {
    await second?.close();
    await d.close();
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a browser whose control port never answers is stopped again, so nothing is left running", { skip, timeout: 60000 }, async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-chrome-"));
  // A folder where the browser writes the file that names its port: it starts, the port is never found.
  fs.mkdirSync(path.join(profileDir, "DevToolsActivePort"));
  const d = new ChromeDriver({ profileDir, headless: true, keepOpen: false, startMs: 3000 });
  try {
    await assert.rejects(d.health(), /control port never answered/);
    assert.ok(d.child, "a browser was started");
    await d.close();
    assert.ok(d.child.exitCode !== null || d.child.signalCode !== null, "and stopped again: a browser left running keeps this process from ever ending");
  } finally {
    // So that a regression fails here instead of hanging the whole test run.
    try { if (d.child && d.child.exitCode === null && d.child.signalCode === null) d.child.kill(); } catch { /* gone */ }
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// A stand-in for a browser's control port, and the file a browser writes to name it.
async function fakePort() {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ Browser: "Fake/1.0" })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
const writePortFile = (dir, port) => fs.writeFileSync(path.join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/fake`);

test("a browser that is slow to open its control port is waited for, and the log says it is still starting", async () => {
  // Measured on fresh GitHub Windows machines: a first start answered after 5.6 to 47 s, and a
  // 20 s wait cut 6 of 20 off. The wait is two minutes.
  assert.ok(START_MS >= 120000, `the start time is ${START_MS} ms`);
  assert.equal(new ChromeDriver({ profileDir: "x" }).startMs, START_MS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-wait-"));
  const fake = await fakePort();
  try {
    const logs = [];
    setTimeout(() => writePortFile(dir, fake.port), 900);
    const t0 = Date.now();
    assert.equal(await waitForPort({ profileDir: dir, ended: () => false, startMs: 10000, slowMs: 300, log: (l) => logs.push(l) }), fake.port);
    assert.ok(Date.now() - t0 >= 800, "it waited for the file");
    assert.equal(logs.length, 1, logs.join("\n"));
    assert.match(logs[0], /^the browser is still starting after \d+ s; the first start after the computer started can take a minute or two, so the Wingman waits up to 10 s$/);
  } finally {
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("waiting for the control port ends at once when the browser ends, and after the start time when nothing answers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-wait-"));
  try {
    let t0 = Date.now();
    assert.equal(await waitForPort({ profileDir: dir, ended: () => true, startMs: 60000 }), null);
    assert.ok(Date.now() - t0 < 2000, "a browser that closed is not waited for");
    t0 = Date.now();
    assert.equal(await waitForPort({ profileDir: dir, ended: () => false, startMs: 600, slowMs: 60000 }), null);
    assert.ok(Date.now() - t0 >= 550 && Date.now() - t0 < 3000, `gave up after ${Date.now() - t0} ms`);
    // A port named in the file that does not answer is not taken.
    writePortFile(dir, 9);
    assert.equal(await waitForPort({ profileDir: dir, ended: () => false, startMs: 300, alive: async () => false }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a browser program that cannot be started is reported at once, not after the start time", async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-chrome-"));
  const d = new ChromeDriver({ profileDir, exe: path.join(profileDir, "no-such-browser.exe"), keepOpen: false });
  try {
    const t0 = Date.now();
    await assert.rejects(d.health(), /the browser did not start: .*ENOENT/);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  } finally {
    await d.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test("the settings choose the driver: the local browser by default, the bridge with its address", () => {
  const paths = { browser: path.join(os.tmpdir(), "wingman-x", "browser") };
  const local = createDriver({ browser: "local", browser_headless: false }, { paths });
  assert.ok(local instanceof ChromeDriver);
  assert.equal(local.kind, "local");
  assert.equal(local.profileDir, paths.browser);
  const bridge = createDriver({ browser: "bridge", bridge: "http://127.0.0.1:9" }, { paths });
  assert.ok(bridge instanceof Bridge);
  assert.equal(bridge.where, "http://127.0.0.1:9");
});

test("a bridge without an address says so instead of calling nowhere", async () => {
  await assert.rejects(new Bridge("").goto("https://example.org"), /no bridge address/);
});

test("the browser is found where Chrome and Edge install themselves", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-find-"));
  const edge = path.join(dir, "x86", "Microsoft", "Edge", "Application", "msedge.exe");
  fs.mkdirSync(path.dirname(edge), { recursive: true });
  fs.writeFileSync(edge, "");
  assert.equal(findBrowser({ platform: "win32", env: { ProgramFiles: path.join(dir, "pf"), "ProgramFiles(x86)": path.join(dir, "x86"), LOCALAPPDATA: path.join(dir, "local") } }), edge);
  const chrome = path.join(dir, "local", "Google", "Chrome", "Application", "chrome.exe");
  fs.mkdirSync(path.dirname(chrome), { recursive: true });
  fs.writeFileSync(chrome, "");
  assert.equal(findBrowser({ platform: "win32", env: { ProgramFiles: path.join(dir, "pf"), "ProgramFiles(x86)": path.join(dir, "x86"), LOCALAPPDATA: path.join(dir, "local") } }), chrome, "Chrome before Edge");
  assert.equal(findBrowser({ platform: "win32", env: { GODSPEED_WINGMAN_BROWSER: edge, LOCALAPPDATA: path.join(dir, "none") } }), edge, "the environment can name one");
  const mac = path.join(dir, "home", "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge");
  fs.mkdirSync(path.dirname(mac), { recursive: true });
  fs.writeFileSync(mac, "");
  // /Applications comes before the home folder's; a Mac running the tests may have one there.
  const system = ["Google Chrome", "Microsoft Edge", "Chromium"].map((n) => path.join("/Applications", `${n}.app`, "Contents", "MacOS", n)).find((f) => fs.existsSync(f));
  assert.equal(findBrowser({ platform: "darwin", env: {}, home: path.join(dir, "home") }), system || mac);
});
