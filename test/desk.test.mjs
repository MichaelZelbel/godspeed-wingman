// The desk page: who may open it (this machine, with its key), who may change anything (the desk
// itself, never another page), and that everything the person does goes through the worker.
// Everyone here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDesk, cookieName, watchText } from "../lib/desk/server.mjs";
import { deskSecret, deskUrl, deskUp } from "../lib/desk/secret.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { readJson } from "../lib/core/store.mjs";
import { PREFERENCES_TEMPLATE } from "../lib/core/preferences.mjs";
import { tempMc, makeWorker, user } from "./helpers.mjs";

function req(port, { method = "GET", path: p = "/", host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host, ...headers } }, (res) => {
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => {
        const buf = Buffer.concat(parts);
        const text = buf.toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: text, buf, json });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

async function withDesk(fn, { mc, state, deps = {} } = {}) {
  const t = mc ? { mc, state } : tempMc();
  const d = await startDesk({ mcDir: t.mc, stateDir: t.state, port: 0, deps });
  try { return await fn({ ...t, d, port: d.port, secret: deskSecret(statePaths(t.state)) }); }
  finally { await d.close(); }
}

// The key, once, then the cookie.
async function login(port, secret) {
  const r = await req(port, { path: `/?t=${secret}` });
  return r.headers["set-cookie"][0].split(";")[0];
}

const post = (port, cookie, p, body, extra = {}) => req(port, { method: "POST", path: p, body, headers: { cookie, origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...extra } });

test("the desk answers only on 127.0.0.1 and only to its own address", async () => {
  await withDesk(async ({ d, port, secret }) => {
    assert.equal(d.server.address().address, "127.0.0.1", "bound to this machine only");
    assert.equal((await req(port, { path: "/health" })).json.app, "godspeed-wingman-desk");
    assert.equal(await deskUp(port), true);
    const cookie = await login(port, secret);
    for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1:${port + 1}`, `192.168.1.5:${port}`]) {
      const r = await req(port, { path: "/", host, headers: { cookie } });
      assert.equal(r.status, 403, `Host ${host} is refused`);
      assert.equal((await req(port, { path: `/?t=${secret}`, host })).status, 403, "not even with the key");
    }
    assert.equal((await req(port, { path: "/", host: `localhost:${port}`, headers: { cookie } })).status, 200, "localhost with the port is this machine too");
  });
});

test("without the key nothing opens: no secret, a wrong secret or a wrong cookie is 403", async () => {
  await withDesk(async ({ port, secret }) => {
    const page = await req(port, { path: "/" });
    assert.equal(page.status, 403);
    assert.match(page.body, /godspeed-wingman desk/, "it says how to open it");
    for (const p of ["/api/state", "/api/who?q=a", "/api/picture?ref=waiting", "/api/files", "/api/onboarding"]) assert.equal((await req(port, { path: p })).status, 403, p);
    assert.equal((await req(port, { path: "/?t=0000" })).status, 403);
    // One character off (never the right one by chance: a key may end in "0" itself).
    assert.equal((await req(port, { path: `/?t=${secret.slice(0, -1)}${secret.endsWith("0") ? "1" : "0"}` })).status, 403);
    assert.equal((await req(port, { path: "/api/state", headers: { cookie: `${cookieName(port)}=${"a".repeat(64)}` } })).status, 403);
    assert.equal((await req(port, { method: "POST", path: "/api/do", body: { what: "pause" }, headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" } })).status, 403, "a change without the cookie");
  });
});

test("the key becomes an HttpOnly, SameSite=Strict cookie and leaves the address; the page carries no CORS and a strict policy", async () => {
  await withDesk(async ({ port, secret }) => {
    const r = await req(port, { path: `/?t=${secret}` });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, "/", "the key leaves the address bar");
    const odd = await req(port, { path: `/.//evil.example/?t=${secret}` });
    assert.equal(odd.headers.location, "/", "never a path taken from the request");
    const c = r.headers["set-cookie"][0];
    assert.match(c, new RegExp(`^${cookieName(port)}=${secret};`));
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    const cookie = c.split(";")[0];
    const page = await req(port, { path: "/", headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.equal(page.headers["access-control-allow-origin"], undefined, "no CORS");
    const csp = page.headers["content-security-policy"];
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
    assert.ok(page.body.includes(`<script nonce="${nonce}">`), "the page's own script carries this response's nonce");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(page.body.replaceAll("http://www.w3.org/2000/svg", ""), /https?:\/\/(?!127\.0\.0\.1)[a-z]/i, "no outside address: no CDN, no font service");
    assert.equal(page.headers["x-frame-options"], "DENY");
    const state = await req(port, { path: "/api/state", headers: { cookie } });
    assert.equal(state.status, 200);
    assert.equal(state.json.onboarded, true);
    assert.equal(state.headers["access-control-allow-origin"], undefined);
  });
});

test("a change needs the cookie AND the desk's own Origin or Referer, and JSON", async () => {
  await withDesk(async ({ port, secret, state }) => {
    const cookie = await login(port, secret);
    const base = { cookie, "content-type": "application/json" };
    const tryPost = (headers) => req(port, { method: "POST", path: "/api/do", body: { what: "pause" }, headers });
    assert.equal((await tryPost(base)).status, 403, "no Origin and no Referer");
    assert.equal((await tryPost({ ...base, origin: "http://evil.example" })).status, 403);
    assert.equal((await tryPost({ ...base, origin: "null" })).status, 403);
    assert.equal((await tryPost({ ...base, origin: `http://127.0.0.1:${port + 1}` })).status, 403);
    assert.equal((await tryPost({ ...base, referer: "http://evil.example/page" })).status, 403);
    assert.equal((await tryPost({ cookie, origin: `http://127.0.0.1:${port}`, "content-type": "text/plain" })).status, 415, "a plain form post is refused");
    const ok = await tryPost({ ...base, origin: `http://127.0.0.1:${port}` });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.queued, true, "no worker runs, so it waits in the queue");
    assert.match(ok.json.text, /not running right now/);
    const viaReferer = await tryPost({ ...base, referer: `http://127.0.0.1:${port}/#status` });
    assert.equal(viaReferer.status, 200, "the desk's own Referer works when a browser sends no Origin");
    const queued = fs.readdirSync(statePaths(state).requests).filter((n) => n.endsWith(".json"));
    assert.equal(queued.length, 2, "both went to the worker's queue, nothing was done here");
    assert.equal(readJson(path.join(statePaths(state).requests, queued[0])).type, "pause");
  });
});

test("an answer on the desk goes through the worker and comes back as its one sentence", async () => {
  const h = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await h.w.tick();
  assert.equal(h.w.state.waiting.name, "Mara");
  await withDesk(async ({ port, secret }) => {
    const cookie = await login(port, secret);
    const v = (await req(port, { path: "/api/state", headers: { cookie } })).json;
    assert.equal(v.waiting.kind, "practice");
    assert.equal(v.waiting.name, "Mara");
    assert.equal(v.worker.alive, true);
    assert.deepEqual(v.sites.map((s) => [s.id, s.mode]), [["flirtual", "practice"]]);
    let done = false;
    const p = post(port, cookie, "/api/answer", { decision: "disagree", reason: "they only want friends", about: "a1" }).then((r) => { done = true; return r; });
    while (!done) { await h.w.tick(); await new Promise((r) => setTimeout(r, 100)); }
    const r = await p;
    assert.equal(r.json.ok, true);
    assert.equal(r.json.text, "Noted: you passed on Mara because they only want friends. Next one in a moment.");
    assert.deepEqual(h.fl.responses[0], { type: "pass", userId: "a1" });
    assert.equal((await post(port, cookie, "/api/answer", { decision: "maybe" })).status, 400);
    assert.equal((await post(port, cookie, "/api/answer", { decision: "agree", about: "../x" })).status, 400);
    assert.equal((await post(port, cookie, "/api/send", { to: "R1" })).status, 400, "send needs 1, 2, 3 or the person's words");
  }, { mc: h.mc, state: h.state });
});

test("pictures come only from the private folder, by reference, never by a path", async () => {
  const h = makeWorker([user("a1", "Mara")]);
  await h.w.tick();
  const w = h.w.state.waiting;
  const pic = path.join(h.w.paths.archive, w.dir, `2026-10-03 Mara a1.png`);
  fs.writeFileSync(pic, Buffer.from("89504e470d0a1a0a0000", "hex"));
  await withDesk(async ({ port, secret }) => {
    const cookie = await login(port, secret);
    const ok = await req(port, { path: "/api/picture?ref=waiting", headers: { cookie } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["content-type"], "image/png");
    assert.equal((await req(port, { path: `/api/picture?ref=dir:${w.dir}`, headers: { cookie } })).status, 200);
    for (const bad of ["dir:../../etc/passwd", "dir:..%2F..%2Fsecret", `dir:${w.dir}/../../desk/secret`, "C:/Windows/win.ini", "/etc/passwd", "reply:R99"]) {
      assert.equal((await req(port, { path: `/api/picture?ref=${encodeURIComponent(bad)}`, headers: { cookie } })).status, 404, bad);
    }
  }, { mc: h.mc, state: h.state });
});

test("the desk edits the person's own files: preferences, and the watch list by names", async () => {
  await withDesk(async ({ port, secret, mc }) => {
    const cookie = await login(port, secret);
    const f = (await req(port, { path: "/api/files", headers: { cookie } })).json;
    assert.match(f.preferences, /People who play VRChat/);
    let r = await post(port, cookie, "/api/files", { preferences: "# Mine\n\n## Who fits\n\n- Someone kind.\n" });
    assert.equal(r.json.ok, true);
    assert.equal(fs.readFileSync(path.join(mc, "routines", "wingman", "preferences.md"), "utf8"), "# Mine\n\n## Who fits\n\n- Someone kind.\n");
    assert.equal((await post(port, cookie, "/api/files", { preferences: "   " })).status, 400, "never an empty preferences page");
    r = await post(port, cookie, "/api/files", { watchNames: ["Robin", "- Lena", "", "Robin"] });
    assert.deepEqual(r.json.names, ["Robin", "Lena"]);
    const text = fs.readFileSync(path.join(mc, "routines", "wingman", "watch.md"), "utf8");
    assert.match(text, /^# Watch list/, "the explanation stays");
    r = await post(port, cookie, "/api/files", { watchNames: ["Lena"] });
    assert.deepEqual(r.json.names, ["Lena"], "a name taken off the list is gone");
  });
  const dir = tempMc().mc;
  const file = path.join(dir, "watch.md");
  fs.writeFileSync(file, "# Watch\nmy note\n- Old\n");
  assert.equal(watchText(file, ["New"]), "# Watch\nmy note\n\n- New\n");
});

test("the wizard on the desk: the questions, a preview, and saving never replaces an existing page unless asked", async () => {
  const detect = async () => ({ desktop: true, platform: "win32", sites: [{ id: "flirtual", name: "Flirtual", builtin: true, kind: "browser", ok: true, why: "", login_url: "https://flirtu.al/login" }], lanes: [], telegram: { found: false, file: "" }, assistant: { hermes: false, claude: false }, notifications: { ok: true, how: "x" }, timezone: "UTC" });
  await withDesk(async ({ port, secret, mc, state }) => {
    const cookie = await login(port, secret);
    const ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.prefs.exists, true);
    assert.deepEqual(ob.starters.map((s) => s.id), ["looking-for-a-partner", "flirty-and-playful", "friends-first", "just-exploring"]);
    assert.equal(ob.options._about, undefined);
    assert.ok(ob.options.green_flags.choices.some((c) => c.id === "vrchat"));
    const answers = { ...ob.answers, me: "a person in my thirties", looking_for: ["anyone"], starter: "friends-first", watch: ["Robin"] };
    const pv = await post(port, cookie, "/api/onboarding/preview", { answers });
    assert.match(pv.json.text, /I am a person in my thirties/);
    assert.doesNotMatch(pv.json.text, /\{[a-z_]+\}/);
    const prefs = path.join(mc, "routines", "wingman", "preferences.md");
    const before = fs.readFileSync(prefs, "utf8");
    let r = await post(port, cookie, "/api/onboarding/save", { answers, mode: "keep" });
    assert.equal(r.json.prefs, "kept");
    assert.equal(fs.readFileSync(prefs, "utf8"), before, "kept: not one byte changed");
    const set = readJson(path.join(mc, "routines", "wingman", "settings.json"));
    assert.match(set.onboarded, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(fs.readFileSync(path.join(mc, "routines", "wingman", "watch.md"), "utf8"), /^- Robin$/m);
    r = await post(port, cookie, "/api/onboarding/save", { answers, mode: "starter" });
    assert.equal(r.json.prefs, "replaced");
    assert.match(fs.readFileSync(prefs, "utf8"), /## Who fits/);
    assert.equal(fs.readFileSync(r.json.backup, "utf8"), before, "the old page is kept in the private folder");
    assert.ok(path.resolve(r.json.backup).startsWith(path.resolve(state)));
  }, { deps: { detect } });
});

test("the wizard on the desk offers the notebook list only when the notebook answers, and saves the choice", async () => {
  const base = { desktop: true, platform: "win32", sites: [{ id: "flirtual", name: "Flirtual", builtin: true, kind: "browser", ok: true, why: "", login_url: "https://flirtu.al/login" }], lanes: [], telegram: { found: false, file: "" }, assistant: { hermes: false, claude: false }, notifications: { ok: true, how: "x" }, timezone: "UTC" };
  let found = true;
  await withDesk(async ({ port, secret, mc }) => {
    const cookie = await login(port, secret);
    let ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.detect.notebook.found, true);
    assert.equal(ob.answers.notebook_collection, false, "unticked on a new install");
    assert.equal(ob.options.notebook_collection.label, "Also keep a list of every like and pass in my Godspeed notebook (it stays until I delete it)");
    assert.equal(ob.options.notebook_collection._about, undefined);
    const file = path.join(mc, "routines", "wingman", "settings.json");
    await post(port, cookie, "/api/onboarding/save", { answers: { ...ob.answers, notebook_collection: true }, mode: "keep" });
    assert.equal(readJson(file).notebook_collection, true);
    ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.answers.notebook_collection, true, "a yes already given shows ticked");
    await post(port, cookie, "/api/onboarding/save", { answers: { ...ob.answers, notebook_collection: false }, mode: "keep" });
    assert.equal(readJson(file).notebook_collection, false);
    found = false;
    ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.detect.notebook.found, false);
  }, { deps: { detect: async () => ({ ...base, notebook: { found } }) } });
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "desk", "app.html"), "utf8");
  assert.match(page, /function notebookChoice\(\) \{\n  if \(!S\.ob\.detect\.notebook\?\.found\) return null;/, "the page shows it only when the notebook answers");
  assert.match(page, /checked: a\.notebook_collection === true/, "and unticked unless the answers say yes");
});

test("the desk's address carries the key; the page names the desk command when it is locked", () => {
  const { state } = tempMc();
  const paths = statePaths(state);
  const s = deskSecret(paths);
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(deskSecret(paths), s, "made once");
  assert.equal(deskUrl({ desk_port: 47860 }, paths, "practice"), `http://127.0.0.1:47860/?t=${s}#practice`);
});

test("the wizard on a new install: the installer's blank page is no page of one's own, so the starters come first", async () => {
  const detect = async () => ({ desktop: true, platform: "win32", sites: [{ id: "flirtual", name: "Flirtual", builtin: true, kind: "browser", ok: true, why: "", login_url: "https://flirtu.al/login" }], lanes: [], telegram: { found: false, file: "" }, assistant: { hermes: false, claude: false }, notifications: { ok: true, how: "x" }, timezone: "UTC" });
  const t = tempMc({ onboarded: false });
  const prefs = path.join(t.mc, "routines", "wingman", "preferences.md");
  fs.writeFileSync(prefs, PREFERENCES_TEMPLATE);
  await withDesk(async ({ port, secret, state }) => {
    const cookie = await login(port, secret);
    let ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.deepEqual(ob.prefs, { exists: false, text: "" }, "the blank page: straight to the starters");
    const answers = { ...ob.answers, me: "a person in my thirties", looking_for: ["anyone"], starter: "looking-for-a-partner" };
    const r = await post(port, cookie, "/api/onboarding/save", { answers, mode: "starter" });
    assert.equal(r.json.prefs, "written");
    assert.equal(r.json.backup, null, "no copy of a blank page");
    assert.match(r.json.text, /Your preferences are written\./);
    assert.match(fs.readFileSync(prefs, "utf8"), /I am a person in my thirties, and I am looking for anyone who fits/);
    assert.ok(!fs.readdirSync(statePaths(state).desk).some((n) => n.startsWith("preferences-before-")));
    ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.prefs.exists, true, "now it is a page of their own");
    fs.writeFileSync(prefs, PREFERENCES_TEMPLATE.replace("## Who fits\n", "## Who fits\n\n- Someone kind.\n"));
    ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.equal(ob.prefs.exists, true, "one real line is enough to offer keeping it");
    assert.match(ob.prefs.text, /- Someone kind\./);
  }, { ...t, deps: { detect } });
});

test("the model question on the desk: how to get Codex when neither program is found, and Look again finds it", async () => {
  const lanes = (codex) => [
    { lane: "claude", label: "Claude Code", found: false, where: "", name: "sonnet" },
    { lane: "codex", label: "Codex", found: codex, where: codex ? "C:/x/codex.exe" : "", name: "" },
    { lane: "openai", label: "An OpenAI-compatible service", found: false, where: "no key in OPENAI_API_KEY", name: "" },
  ];
  let codex = false;
  const detect = async () => ({ desktop: true, platform: "win32", sites: [], lanes: lanes(codex), telegram: { found: false, file: "" }, assistant: { hermes: false, claude: false }, notifications: { ok: true, how: "x" }, timezone: "UTC" });
  await withDesk(async ({ port, secret }) => {
    const cookie = await login(port, secret);
    const ob = (await req(port, { path: "/api/onboarding", headers: { cookie } })).json;
    assert.match(ob.detect.model_help.text, /^Neither Codex nor Claude Code is on this computer yet\..*Then press Look again\.$/);
    assert.equal(ob.detect.model_help.line, 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', "the line for the system the desk runs on");
    let d = (await req(port, { path: "/api/onboarding/detect", headers: { cookie } })).json;
    assert.equal(d.ok, true);
    assert.ok(d.detect.model_help, "still nothing found");
    codex = true;
    d = (await req(port, { path: "/api/onboarding/detect", headers: { cookie } })).json;
    assert.equal(d.detect.model_help, null, "Codex installed: no more help");
    assert.equal(d.detect.lanes.find((l) => l.lane === "codex").found, true);
    assert.equal((await req(port, { path: "/api/onboarding/detect" })).status, 403, "only with the desk's key");
  }, { deps: { detect } });
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "desk", "app.html"), "utf8");
  assert.match(page, /const help = S\.ob\.detect\.model_help;/, "the page shows the help only when the desk sends it");
  assert.match(page, /api\("\/api\/onboarding\/detect"\)/, "and Look again asks the desk to look again");
});
