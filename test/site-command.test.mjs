// `godspeed-wingman site ...`: making a site from the template, recording its terms, refusing to
// switch on a site whose terms were never read or forbid it, a new site starting in practice even
// when another runs on autopilot, and the check: offline (the contract, the folder's own tests) and
// live but read only (a pretend site, an adapter that tries to change something while reading is
// stopped and reported). Everyone here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempMc, setMode, makeWorker, user } from "./helpers.mjs";
import { newSite, recordTerms, useSite, offSite, siteRows, enabledSites } from "../lib/sites/manage.mjs";
import { checkSite, siteNetwork, siteLogin, profileProblems } from "../lib/sites/check.mjs";
import { routinePaths, statePaths } from "../lib/core/paths.mjs";
import { loadSettings } from "../lib/core/settings.mjs";
import { readState, siteState } from "../lib/core/state.mjs";
import { every } from "../lib/commands/site.mjs";
import { flagSpec, loadCommands } from "../lib/commands/index.mjs";
import { createDriver } from "../lib/drivers/android.mjs";
import { fakePage } from "./fixtures/fake-page.mjs";
import { fakeAdb } from "./fixtures/adb.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-wingman.mjs");
function cli(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
const sitesDir = (mc) => path.join(mc, "routines", "wingman", "sites");
const TERMS = { verdict: "silent", urls: ["https://kindmeet.example/terms"], quotes: ["Misuse will be investigated."], note: "Nothing about bots or AI.", day: "2026-10-10" };
function kindMeet(mc, { terms = true } = {}) {
  const r = newSite({ mcDir: mc, id: "kindmeet", kind: "browser", name: "Kind Meet", home: "https://kindmeet.example/" });
  if (terms) recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS });
  return r;
}
const quiet = () => { const lines = []; const out = { lines, ok: (t) => lines.push(`ok ${t}`), fail: (t) => lines.push(`FAIL ${t}`), note: (t) => lines.push(`NOTE ${t}`), info: (t) => lines.push(t) }; return out; };
const fails = (out) => out.lines.filter((l) => l.startsWith("FAIL"));

test("site new makes the person's own site from the template, with no terms yet", () => {
  const { mc } = tempMc();
  const r = kindMeet(mc, { terms: false });
  const dir = path.join(sitesDir(mc), "kindmeet");
  assert.equal(r.dir, dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), [".gitignore", "README.md", "adapter.mjs", "adapter.test.mjs", "site.json"]);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "site.json"), "utf8"));
  assert.deepEqual([meta.id, meta.name, meta.kind, meta.home, meta.login_url, meta.terms], ["kindmeet", "Kind Meet", "browser", "https://kindmeet.example", "https://kindmeet.example", undefined]);
  for (const f of ["adapter.mjs", "adapter.test.mjs", "README.md"]) assert.ok(!/__(ID|NAME|HOME|PACKAGE)__/.test(fs.readFileSync(path.join(dir, f), "utf8")), `${f} is filled in`);
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^private\/$/m);
  const a = newSite({ mcDir: mc, id: "app-date", kind: "android", pkg: "com.example.dating" });
  assert.deepEqual([a.meta.name, a.meta.kind, a.meta.android, a.meta.home], ["App Date", "android", { package: "com.example.dating" }, undefined]);
});

test("site new refuses, in one sentence each: a built-in id, an existing folder, a bad id, name, address or package", () => {
  const { mc } = tempMc();
  kindMeet(mc, { terms: false });
  const no = (opts, re) => assert.throws(() => newSite({ mcDir: mc, kind: "browser", home: "https://x.example", ...opts }), re);
  no({ id: "flirtual" }, /The Wingman already has a built-in site called flirtual\./);
  no({ id: "kindmeet" }, /There is already a folder for kindmeet/);
  no({ id: "Kind Meet" }, /lower-case letters, digits and dashes/);
  no({ id: "x1", kind: "phone" }, /either --kind browser .* or --kind android/);
  no({ id: "x2", home: "" }, /Say where the website is: --home https:\/\/\.\.\./);
  no({ id: "x3", home: "http://x.example" }, /must start with https:\/\//);
  no({ id: "x4", name: 'Bad "name"' }, /letters, digits, spaces and simple punctuation/);
  no({ id: "x5", kind: "android", pkg: "not a package" }, /--package com\.example\.app/);
});

test("site terms records the check with today's date; a verdict that is not silent needs the sentences", () => {
  const { mc } = tempMc();
  kindMeet(mc, { terms: false });
  assert.throws(() => recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, urls: [] }), /Name the https address of every page of terms you read/);
  assert.throws(() => recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, urls: ["http://kindmeet.example/terms"] }), /https/);
  assert.throws(() => recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, verdict: "allowed", quotes: [] }), /A verdict of allowed rests on sentences in the terms; quote them word for word/);
  assert.throws(() => recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, verdict: "probably" }), /allowed .* silent .* or forbidden/);
  assert.throws(() => recordTerms({ mcDir: mc, id: "flirtual", ...TERMS }), /built into the Wingman/);
  assert.throws(() => recordTerms({ mcDir: mc, id: "nowhere", ...TERMS }), /knows no site called nowhere; make it first/);
  const r = recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS });
  assert.deepEqual(r.meta.terms, { checked_on: "2026-10-10", urls: ["https://kindmeet.example/terms"], verdict: "silent", quotes: ["Misuse will be investigated."], note: "Nothing about bots or AI." });
  assert.ok(Object.keys(r.meta).indexOf("terms") === Object.keys(r.meta).indexOf("can") - 1, "terms sits right before can");
});

test("a site is never switched on before its terms are read, nor when they forbid it", () => {
  const { mc } = tempMc();
  const routine = routinePaths(mc);
  kindMeet(mc, { terms: false });
  assert.throws(() => useSite({ mcDir: mc, routine, id: "kindmeet" }), /^Error: Nobody has checked yet whether the terms of Kind Meet allow a helper like the Wingman, so it cannot be switched on\. Read them and record what they say: godspeed-wingman site terms kindmeet/);
  recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, verdict: "forbidden", quotes: ["You may not use bots, scripts or other automated means."] });
  assert.throws(() => useSite({ mcDir: mc, routine, id: "kindmeet" }), /The terms of Kind Meet forbid bots, automation or AI use \(read on 2026-10-10\), so the Wingman does not work there\. It cannot be switched on\./);
  assert.throws(() => useSite({ mcDir: mc, routine, id: "nowhere" }), /knows no site called nowhere/);
  assert.deepEqual(loadSettings(routine.settings).sites, ["flirtual"], "nothing changed");
});

test("site use and site off edit only settings.sites; a new site starts in practice while another is on autopilot", async () => {
  const { mc, state } = tempMc({ daily_start: "19:00", custom_note: "kept" });
  const routine = routinePaths(mc);
  kindMeet(mc);
  const paths = statePaths(state);
  fs.writeFileSync(paths.state, JSON.stringify({ sites: { flirtual: { mode: "auto" } } }));
  const r = await cli(["site", "use", "kindmeet", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Kind Meet is switched on\. The Wingman works there in the daily session, after Flirtual\./);
  assert.match(r.out, /It starts in practice, whatever the other sites do: every like or pass there waits for your answer until you agree with 9 of its last 10\./);
  const file = JSON.parse(fs.readFileSync(routine.settings, "utf8"));
  assert.deepEqual(file.sites, ["flirtual", "kindmeet"]);
  assert.equal(file.daily_start, "19:00");
  assert.equal(file.custom_note, "kept", "every other key stays as the person wrote it");
  const s = readState(paths.state);
  assert.equal(siteState(s, "flirtual").mode, "auto");
  assert.equal(siteState(s, "kindmeet").mode, "practice", "not inherited from Flirtual");
  const st = await cli(["status", "--godspeed", mc, "--state", state]);
  assert.match(st.out, /Flirtual: autopilot/);
  assert.match(st.out, /Kind Meet: practice/);
  assert.equal((await cli(["site", "use", "kindmeet", "--godspeed", mc, "--state", state])).out, "Kind Meet is already switched on.");
  const off = await cli(["site", "off", "flirtual", "--godspeed", mc, "--state", state]);
  assert.match(off.out, /^Flirtual is switched off\. Its folder, and everything the Wingman learned there, stay\.$/);
  assert.deepEqual(enabledSites(routine.settings), ["kindmeet"]);
  assert.deepEqual(offSite({ mcDir: mc, routine, id: "kindmeet" }).sites, []);
  assert.deepEqual(loadSettings(routine.settings).sites, [], "an empty list is kept empty");
});

test("site terms forbidden switches the site off at once", async () => {
  const { mc, state } = tempMc();
  kindMeet(mc);
  useSite({ mcDir: mc, routine: routinePaths(mc), id: "kindmeet" });
  const r = await cli(["site", "terms", "kindmeet", "--verdict", "forbidden", "--url", "https://kindmeet.example/terms", "--quote", "You", "may", "not", "use", "bots.", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /The Wingman will not work on Kind Meet, so it is switched off\. That is the end of it for this site\./);
  assert.deepEqual(enabledSites(routinePaths(mc).settings), ["flirtual"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sitesDir(mc), "kindmeet", "site.json"), "utf8")).terms.quotes, ["You may not use bots."]);
});

test("--url and --quote may be given once per page and once per sentence", async () => {
  const spec = flagSpec(await loadCommands());
  const argv = ["site", "terms", "x", "--url", "https://a.example/terms", "--quote", "First", "sentence.", "--url", "https://a.example/rules", "--quote", "Second", "--note", "n"];
  assert.deepEqual(every(argv, "url", spec), ["https://a.example/terms", "https://a.example/rules"]);
  assert.deepEqual(every(argv, "quote", spec), ["First sentence.", "Second"]);
});

test("site list: built in and the person's own, kind, terms and date, on or off, practice or autopilot", async () => {
  const { mc, state } = tempMc();
  kindMeet(mc);
  newSite({ mcDir: mc, id: "app-date", kind: "android", pkg: "com.example.dating" });
  fs.writeFileSync(statePaths(state).state, JSON.stringify({ sites: { flirtual: { mode: "auto" } } }));
  const rows = siteRows({ mcDir: mc, routine: routinePaths(mc), state: readState(statePaths(state).state) });
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.builtin, r.verdict, r.on, r.mode]), [
    ["flirtual", "browser", true, "silent", true, "autopilot"],
    ["app-date", "android", false, null, false, "practice"],
    ["kindmeet", "browser", false, "silent", false, "practice"],
  ]);
  const r = await cli(["site", "list", "--godspeed", mc, "--state", state]);
  assert.match(r.out, /flirtual +Flirtual +website +built in +terms silent, read 2026-10-10 +ON, autopilot/);
  assert.match(r.out, /app-date +App Date +Android app +your own +terms NOT CHECKED yet +off\n +Nobody has checked yet whether the terms of App Date allow/);
  assert.match(r.out, /kindmeet +Kind Meet +website +your own +terms silent, read 2026-10-10 +off/);
});

test("site check --offline: the template passes once its terms are recorded, and runs the folder's own tests", async () => {
  const { mc, state } = tempMc();
  kindMeet(mc, { terms: false });
  let r = await cli(["site", "check", "kindmeet", "--offline", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL terms: not checked yet\. Read them, then record what they say: godspeed-wingman site terms kindmeet/);
  assert.match(r.out, /ok   the adapter has every method it promises: session, queue, profile, like, pass, skip, conversations, send, open, picture/, "the contract is checked while building");
  recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS });
  r = await cli(["site", "check", "kindmeet", "--offline", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok   site\.json is complete\n  ok   terms: silent, read on 2026-10-10 \(https:\/\/kindmeet\.example\/terms\)/);
  assert.match(r.out, /ok   tests: (\d+) of \1 passed/);
  assert.match(r.out, /Offline checks passed\.$/);
});

test("the Android template passes the offline check too", async () => {
  const { mc, state } = tempMc();
  newSite({ mcDir: mc, id: "app-date", kind: "android", name: "App Date", pkg: "com.example.dating" });
  recordTerms({ mcDir: mc, id: "app-date", ...TERMS, urls: ["https://app-date.example/terms"] });
  const r = await cli(["site", "check", "app-date", "--offline", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /an Android app/);
  assert.match(r.out, /ok   tests: (\d+) of \1 passed/);
});

test("the offline check finds a missing method, an adapter that reaches for the site when made, a failing test, old terms", async () => {
  const { mc, state } = tempMc();
  const { dir } = kindMeet(mc);
  const settings = loadSettings(routinePaths(mc).settings);
  const run = async (opts = {}) => { const out = quiet(); await checkSite({ id: "kindmeet", mcDir: mc, settings, paths: statePaths(state), offline: true, out, deps: { runTests: async () => ({ ran: true, ok: true, summary: "3 of 3 passed" }), ...opts } }); return out; };
  const adapter = path.join(dir, "adapter.mjs");
  const original = fs.readFileSync(adapter, "utf8");
  fs.writeFileSync(adapter, original.replace("send: (conversationId, text) =>", "sendLater: (conversationId, text) =>"));
  assert.deepEqual(fails(await run()), ['FAIL the adapter lacks send, which its site.json "can" promises']);
  fs.writeFileSync(adapter, original.replace("let me = null;", "let me = null; driver.goto(HOME);"));
  assert.match(fails(await run())[0], /^FAIL create\(\) reached for the site when it was only made: an offline check has no browser \(the adapter called goto\(\)\)/);
  fs.writeFileSync(adapter, original);
  assert.deepEqual(fails(await run({ runTests: async () => ({ ran: true, ok: false, summary: "2 of 3 passed; failing: profile" }) })), ["FAIL tests: 2 of 3 passed; failing: profile"]);
  const old = await run({ now: () => new Date("2027-06-01T00:00:00Z") });
  assert.deepEqual(fails(old), []);
  assert.ok(old.lines.some((l) => /^NOTE The terms of Kind Meet were last read 234 days ago \(2026-10-10\)\. Read them again/.test(l)), "a reminder, not a refusal");
});

// The imagined Kind Meet, for the template's adapter: invented people only.
function kindMeetPage() {
  const person = { id: "u_test_001", display_name: "Mara", age: 27, about: "<p>Board games.</p>", details: { Height: "168 cm" }, photos: [{ url: "https://cdn.example.test/1.jpg" }] };
  return fakePage({
    elements: { main: { innerText: "the profile" } },
    routes: (m, u) => {
      const p = new URL(u).pathname;
      if (m !== "GET") return { status: 200, body: { match: false } };
      if (p === "/api/me") return { status: 200, body: { id: "me_test", display_name: "You" } };
      if (p === "/api/suggestions") return { status: 200, body: { people: [{ id: "u_test_001" }, { id: "u_test_002" }], likes_left: 3 } };
      if (p === "/api/people/u_test_001") return { status: 200, body: person };
      if (p === "/api/conversations") return { status: 200, body: { conversations: [{ id: "c1", other: { id: "u_test_002", name: "Juno" }, messages: [{ id: "m1", from: "u_test_002", text: "Hi" }] }] } };
      return undefined;
    },
  });
}

test("the live check reads the login, the queue, one profile, one picture and the conversations, and changes nothing", async () => {
  const { mc, state } = tempMc();
  kindMeet(mc);
  const page = kindMeetPage();
  const out = quiet();
  const settings = loadSettings(routinePaths(mc).settings);
  const r = await checkSite({ id: "kindmeet", mcDir: mc, settings, paths: statePaths(state), out, deps: { runTests: async () => ({ ran: true, ok: true, summary: "11 of 11 passed" }), browser: async () => page.driver, wait: async () => {} } });
  assert.equal(r.failed, 0, out.lines.join("\n"));
  const text = out.lines.join("\n");
  assert.match(text, /ok logged in as You/);
  assert.match(text, /ok queue: 2 profile\(s\) waiting, 3 likes left/);
  assert.match(text, /ok profile u_test_001: a name, an age, 1 field\(s\), 0 question\(s\), a bio of 12 characters, 1 picture address\(es\)/);
  assert.ok(!text.includes("Mara") && !text.includes("Board games"), "nothing a person wrote is printed");
  assert.match(text, /ok picture: \d+ KB \(element\), kept to look at in .*kindmeet-picture\.png/);
  assert.ok(fs.existsSync(path.join(state, "check", "kindmeet-picture.png")));
  assert.match(text, /ok conversations: 1 \(only counted\)/);
  assert.match(text, /All checks passed\. Switch it on with: godspeed-wingman site use kindmeet$/);
  assert.deepEqual(page.changes, [], "nothing that changes anything reached the site");
  assert.ok(page.closed, "the browser tab was let go");
});

test("an adapter that changes something while reading is stopped by the guard, and the check says so", async () => {
  const { mc, state } = tempMc();
  const { dir } = kindMeet(mc);
  const adapter = path.join(dir, "adapter.mjs");
  fs.writeFileSync(adapter, fs.readFileSync(adapter, "utf8").replace('const q = await call("GET", ROUTES.queue);', 'await call("POST", ROUTES.like("u_test_002"), {}); const q = await call("GET", ROUTES.queue);'));
  const page = kindMeetPage();
  const out = quiet();
  await checkSite({ id: "kindmeet", mcDir: mc, settings: loadSettings(routinePaths(mc).settings), paths: statePaths(state), out, deps: { runTests: async () => ({ ran: true, ok: true, summary: "ok" }), browser: async () => page.driver, wait: async () => {} } });
  assert.deepEqual(page.changes, [], "the like never reached the site");
  assert.match(fails(out)[0], /^FAIL queue\(\) tried to change something: .*The check is read-only, so it refused POST https:\/\/kindmeet\.example\/api\/people\/u_test_002\/like\. A reading method must never like, pass, skip or send\.$/);
});

test("the live check asks for the login, and never runs for terms that forbid it or were never read", async () => {
  const { mc, state } = tempMc();
  kindMeet(mc);
  const loggedOut = fakePage({ routes: () => ({ status: 401, body: { error: "login" } }) });
  const out = quiet();
  const settings = loadSettings(routinePaths(mc).settings);
  await checkSite({ id: "kindmeet", mcDir: mc, settings, paths: statePaths(state), out, deps: { runTests: async () => ({ ran: true, ok: true, summary: "ok" }), browser: async () => loggedOut.driver } });
  assert.deepEqual(fails(out), ["FAIL not logged into Kind Meet: log in once in the Wingman's browser at https://kindmeet.example"]);
  recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS, verdict: "forbidden", quotes: ["No bots."] });
  let asked = 0;
  const out2 = quiet();
  await checkSite({ id: "kindmeet", mcDir: mc, settings, paths: statePaths(state), out: out2, deps: { browser: async () => { asked++; return loggedOut.driver; } } });
  assert.equal(asked, 0, "no browser was even opened");
  assert.match(fails(out2)[0], /forbid bots, automation or AI use .* Nothing more is checked, and the Wingman is not built or used there\./);
});

test("an Android adapter that taps Like while reading is stopped before the tap reaches the emulator", async () => {
  const { mc, state } = tempMc();
  const { dir } = newSite({ mcDir: mc, id: "app-date", kind: "android", name: "App Date", pkg: "com.example.dating" });
  recordTerms({ mcDir: mc, id: "app-date", ...TERMS });
  fs.writeFileSync(path.join(dir, "adapter.mjs"), `export default function create({ driver }) {
  return {
    session: async () => ({ loggedIn: true, me: { id: "me", name: null } }),
    queue: async () => ({ next: ["card_1"], limits: null, done: false }),
    profile: async (id) => { await driver.tapDesc("Like"); return { id, name: "x", photos: [], url: "" }; },
    like: async () => driver.tapDesc("Like"), pass: async () => driver.tapDesc("Pass"),
    open: async () => {}, picture: async () => ({ data: await driver.screencap(), ext: "png", capture: "viewport" }),
    conversations: async () => [], send: async () => {},
  };
}
`);
  const f = fakeAdb();
  const out = quiet();
  await checkSite({ id: "app-date", mcDir: mc, settings: loadSettings(routinePaths(mc).settings), paths: statePaths(state), out, deps: { runTests: async () => ({ ran: true, ok: true, summary: "ok" }), android: async (s) => createDriver({ settings: s, adb: f.adb, env: f.env }) } });
  assert.match(fails(out)[0], /^FAIL profile\(card_1\) tried to change something: The check is read-only, so it refused a tap on a button marked "like"\./);
  assert.deepEqual(f.calls().filter((c) => c.includes("input")), [], "no tap reached the emulator");
});

test("site network lists the addresses a page called, only after the terms are recorded", async () => {
  const { mc } = tempMc();
  kindMeet(mc, { terms: false });
  const page = fakePage({ resources: [{ name: "https://kindmeet.example/api/suggestions", initiatorType: "fetch" }, { name: "https://kindmeet.example/api/suggestions", initiatorType: "fetch" }, { name: "https://kindmeet.example/app.js", initiatorType: "script" }] });
  const settings = loadSettings(routinePaths(mc).settings);
  let out = quiet();
  assert.equal(await siteNetwork({ id: "kindmeet", mcDir: mc, settings, out, deps: { browser: async () => page.driver } }), 1);
  assert.match(fails(out)[0], /Record what the terms of Kind Meet say first/);
  recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS });
  out = quiet();
  assert.equal(await siteNetwork({ id: "kindmeet", mcDir: mc, settings, url: "https://kindmeet.example/discover", out, deps: { browser: async () => page.driver, wait: async () => {} } }), 0);
  assert.deepEqual(out.lines.slice(0, 2), ["1 address(es) called by https://kindmeet.example/discover:", "  fetch          https://kindmeet.example/api/suggestions"]);
  assert.match(out.lines.at(-1), /never copy them into a test/);
  assert.deepEqual(page.visited, ["https://kindmeet.example/discover"]);
});

test("site login opens the Wingman's browser on the login page, only after the terms are recorded", async () => {
  const { mc } = tempMc();
  kindMeet(mc, { terms: false });
  const page = fakePage();
  const settings = loadSettings(routinePaths(mc).settings);
  let out = quiet();
  assert.equal(await siteLogin({ id: "kindmeet", mcDir: mc, settings, out, deps: { browser: async () => page.driver } }), 1);
  assert.match(fails(out)[0], /Record what the terms of Kind Meet say first/);
  assert.deepEqual(page.visited, []);
  recordTerms({ mcDir: mc, id: "kindmeet", ...TERMS });
  out = quiet();
  assert.equal(await siteLogin({ id: "kindmeet", mcDir: mc, settings, out, deps: { browser: async () => page.driver } }), 0);
  assert.deepEqual(page.visited, ["https://kindmeet.example"]);
  assert.match(out.lines[0], /^The Wingman's own browser shows https:\/\/kindmeet\.example\. Log in there once/);
  out = quiet();
  await siteLogin({ id: "kindmeet", mcDir: mc, settings: { ...settings, browser: "bridge", bridge: "https://bridge.example" }, out, deps: { browser: async () => { throw new Error("no local browser on a server"); } } });
  assert.match(out.lines[0], /behind the bridge \(https:\/\/bridge\.example\): log into Kind Meet in that browser, on that machine/);
});

test("what the check expects of a profile", () => {
  const good = { id: "u1", name: "Kiri", age: null, bio: "", fields: { a: "b" }, prompts: [{ q: "x", a: "y" }], photos: ["https://cdn.example.test/1.jpg"], url: "", contact: {} };
  assert.deepEqual(profileProblems(good, "u1"), []);
  assert.deepEqual(profileProblems({ ...good, id: "u2", name: "", photos: ["http://x"], url: "ftp://x", fields: { a: 1 } }, "u1"), [
    'its id is "u2", not the one asked for', "it has no name", "fields must be { label: text }", "photos must be a list of https addresses", 'url must be an https address (or "" for an app)',
  ]);
});

test("a site that the worker cannot run is never used, even when the settings name it", async () => {
  const h = makeWorker([user("a1", "Mara")], { settings: { sites: ["kindmeet"] } });
  kindMeet(h.mc, { terms: false });
  setMode(h.w, "auto", "flirtual");
  await h.w.tick();
  assert.match(h.w.state.lastError.text, /Nobody has checked whether the terms of Kind Meet allow a helper like the Wingman/);
});
