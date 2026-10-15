// `godspeed-wingman check` tells a lost login apart from a browser that failed, and tells bridge
// users when their bridge is too old (0.5.4, after 2026-10-15: a bridge tab had crashed, every page
// answered "Page crashed" for a day while the bridge's /health said ok, and a check would have said
// "log in once", the one hint that sends the person to do something only a repair can fix).
// The command runs as its own process against a pretend Chrome Agent Bridge on this machine, with
// the real Flirtual adapter on top. Nobody real is touched: the pretend bridge answers by itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempMc } from "./helpers.mjs";
import { sessionLine, bridgeVersionLine, olderThan, firstLine, BRIDGE_MIN } from "../lib/commands/check.mjs";
import { SiteError } from "../lib/sites/errors.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-wingman.mjs");

// page = { origin, goto: { status, error } | undefined, session: { status, text } }
// caps = { status, body } for GET /capabilities (404 by default, like a bridge before 0.6.0).
async function fakeBridge(page, caps = { status: 404, body: "Cannot GET /capabilities" }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      const send = (status, json) => { res.writeHead(status, { "content-type": typeof json === "string" ? "text/html" : "application/json" }); res.end(typeof json === "string" ? json : JSON.stringify(json)); };
      if (req.url === "/health") return send(200, { status: "ok" });
      if (req.url === "/capabilities") return send(caps.status, caps.body);
      if (req.url === "/goto") return page.goto ? send(page.goto.status, { error: page.goto.error }) : send(200, { ok: true });
      if (req.url === "/eval") {
        const { js } = JSON.parse(body || "{}");
        if (js === "location.origin") return send(200, { result: page.origin });
        return send(200, { result: page.session });
      }
      send(404, { error: "no such route" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

function check(bridgeUrl) {
  const { mc, state } = tempMc({ browser: "bridge", bridge: bridgeUrl });
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, "check", "--godspeed", mc, "--state", state], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "", GODSPEED_WINGMAN_BRIDGE_TOKEN: "", BRIDGE_TOKEN: "" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => resolve({ code, out: out.replace(/\r/g, ""), err }));
  });
}

const flirtualLine = (out) => out.split("\n").find((l) => /Flirtual/.test(l) && /^\s+(ok|FAIL)/.test(l));
const versionLine = (out) => out.split("\n").find((l) => /bridge version/.test(l));
const NEW = { status: 200, body: { schemaVersion: 1, version: "0.6.0", upload: {} } };
const LOGGED_IN = { status: 200, text: JSON.stringify({ user: { id: "u_test_001", slug: "you_test", entitlements: [] } }) };

test("check: Flirtual saying logged out is a lost login, the one thing that needs the person", async () => {
  const br = await fakeBridge({ origin: "https://flirtu.al", session: { status: 401, text: JSON.stringify({ error: "invalid_credentials" }) } }, NEW);
  try {
    const r = await check(br.url);
    assert.equal(r.code, 1, r.err);
    assert.match(r.out, /ok {3}browser through the bridge at http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(flirtualLine(r.out), "  FAIL logged into Flirtual: log in once in the browser behind the bridge, at https://flirtu.al/login");
  } finally { await br.close(); }
});

test("check: a crashed bridge tab is named as what it is, with the restart, and never as a login", async () => {
  const br = await fakeBridge({ origin: "null", goto: { status: 500, error: 'page.goto: Page crashed\nCall log:\n  - navigating to "https://flirtu.al/en", waiting until "load"' } }, NEW);
  try {
    const r = await check(br.url);
    assert.equal(r.code, 1, r.err);
    assert.equal(flirtualLine(r.out), `  FAIL Flirtual reachable through the bridge: could not ask Flirtual whether you are logged in (not a login problem): bridge /goto answered 500: page.goto: Page crashed. The bridge's tab crashed: restart every bridge instance on that computer (a bridge before ${BRIDGE_MIN} never replaces a crashed tab, so update it first)`);
    assert.doesNotMatch(r.out, /log in once/);
    assert.doesNotMatch(r.out, /Call log/, "only the first line of the error");
  } finally { await br.close(); }
});

test("check: Flirtual answering with a server error is not a login problem either", async () => {
  const br = await fakeBridge({ origin: "https://flirtu.al", session: { status: 503, text: "" } }, NEW);
  try {
    const r = await check(br.url);
    assert.equal(flirtualLine(r.out), "  FAIL Flirtual reachable through the bridge: could not ask Flirtual whether you are logged in (not a login problem): Flirtual /session answered 503");
    assert.doesNotMatch(r.out, /log in once|crashed/);
  } finally { await br.close(); }
});

test("check: logged in shows the account, and a bridge of 0.6.0 is fine", async () => {
  const br = await fakeBridge({ origin: "https://flirtu.al", session: LOGGED_IN }, NEW);
  try {
    const r = await check(br.url);
    assert.equal(flirtualLine(r.out), "  ok   logged into Flirtual");
    assert.match(r.out, /Flirtual account you_test, paid plan: no/);
    assert.equal(versionLine(r.out), "  ok   bridge version 0.6.0");
    assert.ok(br.seen.includes("GET /capabilities"));
  } finally { await br.close(); }
});

test("check: a bridge without a version (before 0.6.0) fails, with the update and the restart", async () => {
  const br = await fakeBridge({ origin: "https://flirtu.al", session: LOGGED_IN });
  try {
    const r = await check(br.url);
    assert.equal(r.code, 1, r.err);
    assert.equal(versionLine(r.out), `  FAIL bridge version: older than ${BRIDGE_MIN} (it does not say its version): bridges before ${BRIDGE_MIN} keep a crashed tab forever, and then the Wingman cannot like or pass anyone. Update the Chrome Agent Bridge to ${BRIDGE_MIN} or newer, then restart every bridge instance on that computer, because each one runs the code it started with`);
    assert.equal(br.seen.filter((x) => x === "GET /capabilities").length, 1, "tried once");
    assert.equal(flirtualLine(r.out), "  ok   logged into Flirtual", "the rest of the check still runs");
  } finally { await br.close(); }
});

test("check: a bridge that says an old version fails the same way", async () => {
  const br = await fakeBridge({ origin: "https://flirtu.al", session: LOGGED_IN }, { status: 200, body: { schemaVersion: 1, version: "0.5.0" } });
  try {
    const r = await check(br.url);
    assert.equal(r.code, 1, r.err);
    assert.match(versionLine(r.out), /^ {2}FAIL bridge version 0\.5\.0: bridges before 0\.6\.0 keep a crashed tab forever/);
  } finally { await br.close(); }
});

test("bridge version: compared as numbers, and anything that is not a version counts as too old", async () => {
  assert.equal(olderThan("0.6.0", "0.6.0"), false);
  assert.equal(olderThan("0.6.1", "0.6.0"), false);
  assert.equal(olderThan("0.10.0", "0.6.0"), false);
  assert.equal(olderThan("1.0", "0.6.0"), false);
  assert.equal(olderThan("v0.7.2", "0.6.0"), false);
  assert.equal(olderThan("0.5.9", "0.6.0"), true);
  assert.equal(olderThan("", "0.6.0"), true);
  assert.equal(olderThan("latest", "0.6.0"), true);
  const missing = await bridgeVersionLine({ capabilities: async () => ({ schemaVersion: 1 }) });
  assert.equal(missing.ok, false);
  const broken = await bridgeVersionLine({ capabilities: async () => { throw Object.assign(new Error("bridge /capabilities answered 500: boom"), { status: 500 }); } });
  assert.equal(broken.ok, false);
  assert.match(broken.fix, /^the bridge did not say its version \(bridge \/capabilities answered 500: boom\); bridges before 0\.6\.0 keep a crashed tab forever/);
  assert.deepEqual(await bridgeVersionLine({ capabilities: async () => ({ version: "0.7.0" }) }), { ok: true, what: "bridge version 0.7.0" });
});

test("the login line: only the site's own logged-out answer asks for a login", () => {
  const out = sessionLine("Flirtual", { error: new SiteError("Flirtual shows no login", { site: "flirtual", loggedOut: true }) }, { loginAt: "https://flirtu.al/login" });
  assert.deepEqual(out, { ok: false, what: "logged into Flirtual", fix: "log in once in the Wingman's browser at https://flirtu.al/login" });
  assert.equal(sessionLine("Flirtual", { sess: { loggedIn: false } }, { loginAt: "x" }).fix, "log in once in the Wingman's browser at x");
  assert.equal(sessionLine("Flirtual", { sess: { loggedIn: true } }, {}).ok, true);
  const slow = sessionLine("Flirtual", { error: new Error("Runtime.evaluate took longer than 45 s") }, { loginAt: "x" });
  assert.deepEqual(slow, { ok: false, what: "Flirtual reachable through the Wingman's browser", fix: "could not ask Flirtual whether you are logged in (not a login problem): Runtime.evaluate took longer than 45 s" });
  const refused = new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });
  assert.equal(firstLine(refused), "fetch failed (ECONNREFUSED)");
  assert.equal(firstLine(new Error(`${"x".repeat(300)}\nmore`)).length, 200);
});
