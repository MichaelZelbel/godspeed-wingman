// `site check <id>`: is this site ready? First what can be checked without the site (its site.json,
// its terms, whether this machine may run its code, the adapter's methods against what it promises,
// and the folder's own tests), then, unless offline, a live probe that only reads: the login, the
// queue, one profile, one picture, the list of conversations. The probe holds only the read-only
// copy of the adapter and a guarded browser or emulator (guard.mjs), so it cannot like, pass, skip
// or send, and nothing it reads about a person is printed: only what it found (how many fields, how
// long the bio). --show prints the one profile, for the person building the adapter.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listSites, adapterGaps, REQUIRED, PROMISED, VERDICTS } from "./index.mjs";
import { readOnlyAdapter, readOnlyBrowser, readOnlyAndroid, offlineDriver, REFUSED_SCRIPT } from "./guard.mjs";
import { ensureDir } from "../core/store.mjs";

const https = (u) => typeof u === "string" && u.startsWith("https://");
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// What is wrong with a profile an adapter returned, against contract.md.
export function profileProblems(p, id) {
  const bad = [];
  if (!isObj(p)) return ["profile() returned no object"];
  if (String(p.id) !== String(id)) bad.push(`its id is ${JSON.stringify(p.id)}, not the one asked for`);
  if (typeof p.name !== "string" || !p.name.trim()) bad.push("it has no name");
  if (!(p.age === null || p.age === undefined || Number.isFinite(p.age))) bad.push("age is not a number (or null)");
  for (const k of ["gender", "pronouns", "location", "country", "bio"]) if (p[k] !== undefined && typeof p[k] !== "string") bad.push(`${k} is not text`);
  if (p.fields !== undefined && !(isObj(p.fields) && Object.values(p.fields).every((v) => typeof v === "string"))) bad.push("fields must be { label: text }");
  if (p.prompts !== undefined && !(Array.isArray(p.prompts) && p.prompts.every((q) => isObj(q) && typeof q.q === "string" && typeof q.a === "string"))) bad.push("prompts must be [{ q, a }] with text");
  if (!Array.isArray(p.photos) || !p.photos.every(https)) bad.push("photos must be a list of https addresses");
  if (!(p.url === "" || https(p.url))) bad.push('url must be an https address (or "" for an app)');
  if (p.contact !== undefined && !isObj(p.contact)) bad.push("contact must be an object");
  return bad;
}

// The folder's own tests (*.test.mjs), run by Node's test runner: { ran, ok, summary }.
export function runOwnTests(dir, { node = process.execPath, timeoutMs = 120000 } = {}) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(dir, f)); } catch { /* none */ }
  if (!files.length) return Promise.resolve({ ran: false, ok: true, summary: "no tests in the folder" });
  return new Promise((resolve) => {
    const c = spawn(node, ["--test", "--test-reporter=tap", ...files], { cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, timeoutMs);
    c.on("close", (code) => {
      clearTimeout(timer);
      const n = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, "m")) || [])[1] || 0);
      const failed = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]).slice(0, 5);
      resolve({ ran: true, ok: code === 0, summary: `${n("pass")} of ${n("tests")} passed${failed.length ? `; failing: ${failed.join("; ")}` : ""}` });
    });
  });
}

// The adapter module, fresh from disk (a second check in one process sees the edits).
async function importAdapter(dir) {
  return import(`${pathToFileURL(path.join(dir, "adapter.mjs")).href}?at=${Date.now()}`);
}

// out = { ok(text), fail(text), note(text), info(text) }. deps stand in for the machine in tests:
// { browser(settings) -> driver, android(settings) -> driver, runTests(dir), alive, now }.
export async function checkSite({ id, mcDir, settings, paths, offline = false, show = false, profileId = null, out, deps = {} }) {
  let failed = 0;
  const ok = (t) => out.ok(t), note = (t) => out.note(t), info = (t) => out.info(t);
  const fail = (t) => { failed++; out.fail(t); };
  const now = deps.now ? deps.now() : new Date();

  const site = listSites({ mcDir, now, trust: deps.trust }).find((s) => s.id === id && !s.shadowed);
  if (!site) { fail(`The Wingman knows no site called ${id}.`); return { failed }; }
  const meta = site.meta || {};
  info(`${site.name} (${site.builtin ? "built in" : `your own, ${site.dir}`}), ${site.kind === "android" ? "an Android app" : "a website"}`);

  // site.json and the terms
  for (const p of site.problems) fail(`site.json: ${p}`);
  if (!site.problems.length) ok("site.json is complete");
  const t = meta.terms;
  const termsOk = !!t && VERDICTS.includes(t.verdict) && t.verdict !== "forbidden";
  if (!t || !VERDICTS.includes(t.verdict)) fail(`terms: not checked yet. Read them, then record what they say: godspeed-wingman site terms ${id} --verdict allowed|silent|forbidden --url ... --quote ...`);
  else if (t.verdict === "forbidden") fail(`terms: ${site.refused} Nothing more is checked, and the Wingman is not built or used there.`);
  else {
    ok(`terms: ${t.verdict}, read on ${t.checked_on} (${(t.urls || []).join(", ")})`);
    if (site.reminder) note(site.reminder);
  }
  if (t?.verdict === "forbidden") return { failed };

  // May this machine run the code?
  if (site.untrusted) { fail(site.untrusted); return { failed }; }

  // The adapter, without the site.
  let create = null;
  try {
    const mod = await importAdapter(site.dir);
    create = mod.default || mod.create;
    if (typeof create !== "function") fail("adapter.mjs exports no create function (export default function create(...))");
  } catch (e) { fail(`adapter.mjs does not load: ${e.message}`); }
  if (!create) return { failed };
  const options = { kind: settings.kind, ...(settings.site_options?.[id] || {}) };
  let offlineAdapter = null;
  try { offlineAdapter = create({ driver: offlineDriver(meta.kind), settings: options, log: () => {}, wait: async () => {}, now: () => now }); }
  catch (e) { fail(`create() reached for the site when it was only made: ${e.message} (create() must only prepare; the work starts in the methods)`); }
  if (offlineAdapter) {
    const gaps = adapterGaps(offlineAdapter, meta);
    const promised = [...new Set([...REQUIRED, ...(meta.can || []).flatMap((c) => PROMISED[c] || [])])];
    if (gaps.length) fail(`the adapter lacks ${gaps.join(", ")}, which ${gaps.some((g) => REQUIRED.includes(g)) ? "every adapter needs or " : ""}its site.json "can" promises`);
    else ok(`the adapter has every method it promises: ${promised.join(", ")}`);
  }
  if (!site.builtin) {
    const r = await (deps.runTests || runOwnTests)(site.dir);
    if (!r.ran) note(`tests: ${r.summary}; adapter.test.mjs with invented people catches most mistakes before the live site does`);
    else if (r.ok) ok(`tests: ${r.summary}`);
    else fail(`tests: ${r.summary}`);
  }

  if (offline) { info(failed ? `${failed} problem(s).` : "Offline checks passed."); return { failed }; }
  if (!termsOk) { note("the live check runs once the terms are recorded"); return { failed }; }
  if (failed) { note("the live check runs once the problems above are fixed"); return { failed }; }

  // The live probe, read only.
  const android = meta.kind === "android";
  let raw = null;
  try {
    raw = android ? await deps.android(settings) : await deps.browser(settings);
    try { await raw.health(); } catch (e) { fail(android ? `the Android emulator: ${e.message}` : `the Wingman's browser: ${e.message}`); return { failed }; }
    const driver = android ? readOnlyAndroid(raw) : readOnlyBrowser(raw, { postReads: meta.post_reads || [] });
    const adapter = readOnlyAdapter(create({ driver, settings: options, log: () => {}, wait: deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms))), now: () => now }));
    const step = async (name, fn) => {
      try { return { value: await fn() }; } catch (e) {
        if (e?.readOnly || /The check is read-only/.test(e?.message || "")) fail(`${name} tried to change something: ${e.message} A reading method must never like, pass, skip or send.`);
        else if (e?.loggedOut) fail(`${name}: ${site.name} shows no login (${e.message})`);
        else fail(`${name} failed: ${e?.message || e}`);
        return { error: e };
      }
    };

    const s = await step("session()", () => adapter.session());
    if (s.error) return { failed };
    if (!s.value?.loggedIn) {
      fail(android ? `not logged into ${site.name}: open the app in the emulator and log in once` : `not logged into ${site.name}: log in once with godspeed-wingman site login ${id} (the Wingman's own browser opens at ${meta.login_url || meta.home})`);
      return { failed };
    }
    ok(`logged in${s.value.me?.name ? ` as ${s.value.me.name}` : ""}`);

    const q = await step("queue()", () => adapter.queue());
    if (q.error) return { failed };
    const v = q.value;
    if (!v || !Array.isArray(v.next) || typeof v.done !== "boolean" || !v.next.every((x) => typeof x === "string" && x)) fail("queue() must return { next: [profile id...], limits, done: true|false }");
    else ok(`queue: ${v.next.length} profile(s) waiting${v.limits?.likes !== undefined && v.limits?.likes !== null ? `, ${v.limits.likes} likes left` : ""}${v.done ? ", done for today" : ""}`);

    const pid = profileId || v?.next?.[0];
    if (!pid) note("the queue is empty right now, so no profile was read; try again later, or name one with --profile <id>");
    else {
      const pr = await step(`profile(${pid})`, () => adapter.profile(pid));
      if (pr.value) {
        const bad = profileProblems(pr.value, pid);
        for (const b of bad) fail(`profile ${pid}: ${b}`);
        const p = pr.value;
        if (!bad.length) ok(`profile ${pid}: a name, ${Number.isFinite(p.age) ? "an age, " : "no age, "}${Object.keys(p.fields || {}).length} field(s), ${(p.prompts || []).length} question(s), a bio of ${(p.bio || "").length} characters, ${(p.photos || []).length} picture address(es)`);
        if (show) { const { raw: _r, ...shown } = p; info(JSON.stringify(shown, null, 2)); }
        if ((meta.can || []).includes("picture")) {
          const o = await step("open()", () => adapter.open(p));
          const pic = o.error ? null : await step("picture()", () => adapter.picture(p));
          const pv = pic?.value;
          if (pv) {
            if (!Buffer.isBuffer(pv.data) || !pv.data.length) fail("picture() must return { data: a Buffer with the picture, ext, capture }");
            else {
              const ext = ["png", "jpg"].includes(pv.ext) ? pv.ext : "png";
              const dir = ensureDir(path.join(paths.root, "check"));
              const file = path.join(dir, `${id}-picture.${ext}`);
              fs.writeFileSync(file, pv.data);
              ok(`picture: ${Math.round(pv.data.length / 1024)} KB (${pv.capture || "unknown"}), kept to look at in ${file}`);
            }
          }
        }
      }
    }
    if ((meta.can || []).includes("inbox")) {
      const c = await step("conversations()", () => adapter.conversations());
      if (c.value !== undefined) {
        const list = c.value;
        if (!Array.isArray(list) || !list.every((x) => isObj(x) && x.id !== undefined && Array.isArray(x.messages))) fail("conversations() must return [{ id, with, messages: [...] }]");
        else ok(`conversations: ${list.length} (only counted)`);
      }
    }
    if (!android) {
      const refused = await raw.evaluate(REFUSED_SCRIPT, { attempts: 1 }).catch(() => []);
      if (Array.isArray(refused) && refused.length) fail(`while reading, the adapter tried to change something, and the guard stopped it: ${[...new Set(refused)].slice(0, 5).join("; ")}`);
    }
  } catch (e) {
    fail(`the live check stopped: ${e.message}`);
  } finally {
    try { await raw?.close?.(); } catch { /* gone */ }
  }
  info(failed ? `${failed} problem(s).` : `All checks passed. Switch it on with: godspeed-wingman site use ${id}`);
  return { failed };
}

// Opens the Wingman's own browser on the site's login page, so the person can log in once. Only
// for a site whose terms are recorded and do not forbid it.
export async function siteLogin({ id, mcDir, settings, out, deps = {} }) {
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed);
  if (!site) { out.fail(`The Wingman knows no site called ${id}.`); return 1; }
  const t = site.meta?.terms;
  if (!t || !VERDICTS.includes(t.verdict)) { out.fail(`Record what the terms of ${site.name} say first: godspeed-wingman site terms ${id} ...`); return 1; }
  if (t.verdict === "forbidden") { out.fail(site.refused); return 1; }
  if (site.kind === "android") { out.info(`${site.name} is an app: open it in the emulator (godspeed-wingman android start) and log in there.`); return 0; }
  if (settings.browser === "bridge") { out.info(`The Wingman uses the browser behind the bridge (${settings.bridge || "no address set"}): log into ${site.name} in that browser, on that machine.`); return 0; }
  const page = site.meta.login_url || site.meta.home;
  const raw = await deps.browser(settings);
  try {
    await raw.health();
    await raw.goto(page);
    out.info(`The Wingman's own browser shows ${page}. Log in there once; the login stays in that browser, apart from your everyday one.`);
    return 0;
  } finally {
    try { await raw.close?.(); } catch { /* the browser itself stays open */ }
  }
}

// The addresses a page of the site called, to find the site's own requests: opens the page in the
// guarded browser, waits, and reads the browser's own list of what the page loaded.
export const NETWORK_SCRIPT = `performance.getEntriesByType("resource").filter((e) => ["fetch", "xmlhttprequest", "beacon", "other"].includes(e.initiatorType)).map((e) => ({ url: e.name, type: e.initiatorType }))`;

export async function siteNetwork({ id, mcDir, settings, url, seconds = 6, out, deps = {} }) {
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed);
  if (!site) { out.fail(`The Wingman knows no site called ${id}.`); return 1; }
  if (site.kind !== "browser") { out.fail(`${site.name} is an app; \`godspeed-wingman android dump\` shows what is on its screen.`); return 1; }
  const t = site.meta?.terms;
  if (!t || !VERDICTS.includes(t.verdict)) { out.fail(`Record what the terms of ${site.name} say first: godspeed-wingman site terms ${id} ...`); return 1; }
  if (t.verdict === "forbidden") { out.fail(site.refused); return 1; }
  const page = url || site.meta.home;
  if (!https(page)) { out.fail("The page must be an https address."); return 1; }
  const raw = await deps.browser(settings);
  try {
    const driver = readOnlyBrowser(raw, { postReads: site.meta.post_reads || [] });
    await raw.health();
    await driver.goto(page);
    await (deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms))))(Math.max(1, Math.min(60, Number(seconds) || 6)) * 1000);
    const list = await driver.evaluate(NETWORK_SCRIPT);
    const seen = [...new Map((Array.isArray(list) ? list : []).map((e) => [e.url, e])).values()];
    const loc = await driver.evaluate("location.href").catch(() => page);
    out.info(`${seen.length} address(es) called by ${loc}:`);
    for (const e of seen.slice(0, 200)) out.info(`  ${e.type.padEnd(14)} ${e.url}`);
    out.info("These addresses may hold the ids of real people: use them to learn the site's routes, and never copy them into a test.");
    return 0;
  } finally {
    try { await raw.close?.(); } catch { /* gone */ }
  }
}
