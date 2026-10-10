// The Wingman's desk: a small web server on this computer only (127.0.0.1, port desk_port, 47860
// unless the settings say otherwise) that serves one page: the setup wizard, the practice
// questions, the reply ideas, who was who, the person's preferences and how the Wingman is doing.
// The worker serves it in its own process; `godspeed-wingman desk` serves it when no worker runs.
//
// Who may use it:
//   - only a request addressed to 127.0.0.1:<port> or localhost:<port> (a web page that points
//     another name at this computer is refused);
//   - only a browser that holds the desk's key: the page is opened once with ?t=<key> (from the
//     desk command, the setup or a notification), and from then on an HttpOnly, SameSite=Strict
//     cookie carries it;
//   - every change (a POST) also needs an Origin, or else a Referer, of the desk itself, and JSON;
//   - no CORS headers, ever.
//
// Everything the person does goes through the same requests queue as the commands, so the worker
// stays the only one that likes, passes or sends. The person's own files (preferences, watch list,
// settings) are written here the way the commands write them.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statePaths, routinePaths } from "../core/paths.mjs";
import { loadSettings, LANES } from "../core/settings.mjs";
import { ensureDir, readJson, writeJson } from "../core/store.mjs";
import * as requests from "../core/requests.mjs";
import { clean } from "../core/text.mjs";
import { readWatch, WATCH_TEMPLATE } from "../core/watch.mjs";
import { listSites, loadSite } from "../sites/index.mjs";
import { APP, deskSecret, deskUrl } from "./secret.mjs";
import * as view from "./view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "app.html");
const MAX_BODY = 512 * 1024;
const NOT_RUNNING = "The Wingman is not running right now. This is saved and done as soon as it is back.";
const BUSY = "Passed on to the Wingman. It is busy and does it within a minute or two.";
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const cookieName = (port) => `wingman_desk_${port}`;

function same(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function originOf(req) {
  if (req.headers.origin) return String(req.headers.origin);
  try { return req.headers.referer ? new URL(String(req.headers.referer)).origin : ""; } catch { return ""; }
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": type, ...extra });
  res.end(body);
}
const json = (res, status, value) => send(res, status, JSON.stringify(value), "application/json; charset=utf-8");

const DENIED_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Wingman's desk</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px;color:#24212b;background:#f3f1f6">
<h1 style="font-size:1.4rem">This page needs its key</h1>
<p>The Wingman's desk opens only from this computer, with the link that carries its key. Open it with the command <code>godspeed-wingman desk</code>, or ask your mission control to open the Wingman's desk.</p>
</body></html>`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 32"><path d="M2 28 13 3l11 25-11-6.5Z" fill="#24212b"/><path d="M22 31 29.5 14 37 31l-7.5-4.4Z" fill="#5a45c8"/></svg>`;

// The watch list with these names as its list items; every other line of the file stays.
export function watchText(file, names) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { text = WATCH_TEMPLATE; }
  const keep = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => !/^\s*[-*]\s+\S/.test(l)).join("\n").trimEnd();
  const list = [...new Set(names.map((n) => String(n).replace(/^\s*[-*]\s*/, "").replace(/[\r\n]/g, " ").trim().slice(0, 80)).filter(Boolean))];
  return `${keep}\n\n${list.map((n) => `- ${n}`).join("\n")}${list.length ? "\n" : ""}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (d) => {
      size += d.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("too much at once"), { status: 413 })); req.destroy(); return; }
      parts.push(d);
    });
    req.on("end", () => {
      const text = Buffer.concat(parts).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        const v = JSON.parse(text);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(Object.assign(new Error("not valid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

// The desk for one mission control and one state folder. `deps` stands in for the machine in
// tests: createDriver, loadSite, ask, telegramSend, notify, check, now.
export function createDesk({ mcDir, stateDir, log = () => {}, deps = {} }) {
  const paths = statePaths(stateDir);
  const routine = routinePaths(mcDir);
  ensureDir(paths.desk);
  const secret = deskSecret(paths);
  const desk = { port: 0, paths, routine, secret, handler: null };
  const settings = () => loadSettings(routine.settings);
  const now = () => (deps.now ? deps.now() : new Date());
  let seenWritten = 0;

  // A request to the worker, and its one-line answer when it comes within the wait.
  async function viaWorker(type, payload, waitMs = deps.waitMs ?? 20000) {
    const alive = view.workerAlive(paths);
    const id = requests.submit(paths, type, payload);
    if (!alive) return { ok: true, queued: true, text: NOT_RUNNING };
    const r = await requests.waitFor(paths, id, waitMs);
    return r ? { ok: !!r.ok, text: r.text } : { ok: true, queued: true, text: BUSY };
  }

  async function sync(message) {
    try {
      const { syncInBackground } = await import("../core/sync.mjs");
      syncInBackground(mcDir, message, settings().sync);
    } catch (e) { log(`desk: could not save the change in mission control's history: ${e.message}`); }
  }

  function siteOf(id) {
    const s = listSites({ mcDir }).find((x) => x.id === id && !x.shadowed);
    if (!s) throw Object.assign(new Error(`The Wingman knows no site called ${clean(id)}.`), { status: 400 });
    if (!s.ok) throw Object.assign(new Error(s.refused || `${s.name} cannot be used as it is: ${s.problems.join("; ")}`), { status: 400 });
    return s;
  }

  async function driverFor(set) {
    const make = deps.createDriver || (await import("../drivers/index.mjs")).createDriver;
    return make(set, { paths, tab: view.workerAlive(paths) ? "new" : "shared", keepOpen: true, log: (l) => log(`desk browser: ${l}`) });
  }

  const routes = {
    "GET /": async (req, res) => {
      const nonce = crypto.randomBytes(16).toString("base64");
      const page = fs.readFileSync(PAGE, "utf8").replaceAll("__NONCE__", nonce);
      send(res, 200, page, "text/html; charset=utf-8", {
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
      });
    },

    "GET /favicon.svg": async (req, res) => send(res, 200, FAVICON, "image/svg+xml", { "Cache-Control": "private, max-age=86400" }),

    "GET /api/state": async (req, res, url) => {
      if (url.searchParams.get("visible") === "1" && Date.now() - seenWritten > 10000) {
        seenWritten = Date.now();
        try { writeJson(path.join(paths.desk, "seen.json"), { at: new Date().toISOString() }); } catch { /* only a courtesy */ }
      }
      json(res, 200, view.view({ mcDir, paths, settings: settings(), now: now() }));
    },
    "GET /api/messages": async (req, res) => json(res, 200, { messages: view.messages(paths) }),
    "GET /api/log": async (req, res) => json(res, 200, { lines: view.log(paths) }),
    "GET /api/who": async (req, res, url) => {
      const q = String(url.searchParams.get("q") || "").slice(0, 80);
      json(res, 200, { q, retention: settings().retention_days, hits: q.trim() ? view.who(paths, mcDir, q) : [] });
    },
    "GET /api/picture": async (req, res, url) => {
      const file = view.pictureFor(paths, url.searchParams.get("ref"));
      if (!file) return json(res, 404, { ok: false, text: "No picture." });
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      send(res, 200, fs.readFileSync(file), type, { "Cache-Control": "private, max-age=60" });
    },
    "GET /api/files": async (req, res) => {
      const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
      json(res, 200, { preferences: read(routine.preferences), watch: read(routine.watch), names: readWatch(routine.watch), where: { preferences: routine.preferences, watch: routine.watch, settings: routine.settings, state: paths.root } });
    },

    "POST /api/answer": async (req, res, url, body) => {
      const decision = String(body.decision || "");
      if (!["agree", "disagree", "like", "pass", "judge"].includes(decision)) return json(res, 400, { ok: false, text: "Say agree or disagree." });
      const about = String(body.about || "");
      if (about && !ID.test(about)) return json(res, 400, { ok: false, text: "That answer is not about a profile I know." });
      json(res, 200, await viaWorker("answer", { decision, reason: String(body.reason || "").slice(0, 500), about, exception: body.exception === true }));
    },
    "POST /api/send": async (req, res, url, body) => {
      const to = String(body.to || "");
      if (!/^R\d{1,6}$/.test(to)) return json(res, 400, { ok: false, text: "Which reply ideas? They have a name like R3." });
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
      const option = Number(body.option);
      if (!text && !(option >= 1 && option <= 3)) return json(res, 400, { ok: false, text: "Pick 1, 2 or 3, or write your own words." });
      json(res, 200, await viaWorker("send", text ? { to, text } : { to, option }, 45000));
    },
    "POST /api/train": async (req, res, url, body) => {
      const count = Math.max(1, Math.min(50, Math.round(Number(body.count)) || settings().practice_round));
      const site = typeof body.site === "string" && body.site ? body.site : undefined;
      json(res, 200, await viaWorker("train", { count, site }));
    },
    "POST /api/do": async (req, res, url, body) => {
      const what = String(body.what || "");
      if (!["pause", "resume", "run", "inbox", "stop-practice", "review"].includes(what)) return json(res, 400, { ok: false, text: "Unknown action." });
      const payload = what === "review" ? { count: Math.max(1, Math.min(50, Number(body.count) || 5)) } : what === "run" && typeof body.site === "string" && body.site ? { site: body.site } : {};
      json(res, 200, await viaWorker(what, payload));
    },
    "POST /api/files": async (req, res, url, body) => {
      const done = [];
      fs.mkdirSync(routine.dir, { recursive: true });
      if (typeof body.preferences === "string") {
        if (!body.preferences.trim()) return json(res, 400, { ok: false, text: "Your preferences cannot be empty. Write at least who fits." });
        fs.writeFileSync(routine.preferences, `${body.preferences.replace(/\r\n?/g, "\n").trimEnd()}\n`);
        done.push("preferences");
      }
      if (typeof body.watch === "string") {
        fs.writeFileSync(routine.watch, `${body.watch.replace(/\r\n?/g, "\n").trimEnd()}\n`);
        done.push("watch list");
      } else if (Array.isArray(body.watchNames)) {
        fs.writeFileSync(routine.watch, watchText(routine.watch, body.watchNames));
        done.push("watch list");
      }
      if (!done.length) return json(res, 400, { ok: false, text: "Nothing to save." });
      await sync(`wingman: ${done.join(" and ")} changed on the desk`);
      json(res, 200, { ok: true, text: `Saved your ${done.join(" and ")}.`, names: readWatch(routine.watch) });
    },

    // ---- the setup wizard -------------------------------------------------------------------------
    "GET /api/onboarding": async (req, res) => {
      const ob = await import("../onboarding/index.mjs");
      const set = settings();
      const options = ob.loadOptions();
      for (const v of Object.values(options)) if (v && typeof v === "object") delete v._about;
      delete options._about;
      const draft = readJson(path.join(paths.desk, "wizard.json"), null);
      let prefs = null;
      try { prefs = fs.readFileSync(routine.preferences, "utf8"); } catch { prefs = null; }
      json(res, 200, {
        options,
        starters: ob.listStarters().map(({ id, title, pitch }) => ({ id, title, pitch })),
        answers: draft?.answers ? { ...ob.startingAnswers(set), ...draft.answers } : ob.startingAnswers(set),
        detect: await (deps.detect || ob.detect)({ mcDir, stateDir, settings: set }),
        prefs: { exists: prefs !== null, text: prefs || "" },
        watch: readWatch(routine.watch),
        onboarded: set.onboarded !== false,
      });
    },
    "POST /api/onboarding/preview": async (req, res, url, body) => {
      const ob = await import("../onboarding/index.mjs");
      const a = ob.cleanAnswers(body.answers || {}, { knownSites: listSites({ mcDir }).map((s) => s.id) });
      try { writeJson(path.join(paths.desk, "wizard.json"), { at: new Date().toISOString(), answers: body.answers || {} }); } catch { /* a draft only */ }
      json(res, 200, { ok: true, text: ob.renderPreferences(a.starter, a) });
    },
    "POST /api/onboarding/save": async (req, res, url, body) => {
      const ob = await import("../onboarding/index.mjs");
      const r = await ob.apply({ mcDir, stateDir, answers: body.answers || {}, mode: body.mode === "starter" ? "starter" : "keep", text: typeof body.text === "string" ? body.text : null, now: now() });
      try { fs.rmSync(path.join(paths.desk, "wizard.json"), { force: true }); } catch { /* fine */ }
      await sync("wingman: set up on the desk");
      const said = r.prefs === "replaced" ? "Your preferences were replaced; the old text is kept in the Wingman's private folder." : r.prefs === "written" ? "Your preferences are written." : "Your own preferences stay as they were.";
      json(res, 200, { ok: true, text: `Saved. ${said}`, prefs: r.prefs, backup: r.backup, watchAdded: r.watchAdded });
    },
    "POST /api/onboarding/skip": async (req, res) => {
      const raw = readJson(routine.settings, {}) || {};
      raw.onboarded = now().toISOString().slice(0, 10);
      fs.mkdirSync(routine.dir, { recursive: true });
      fs.writeFileSync(routine.settings, JSON.stringify(raw, null, 2) + "\n");
      await sync("wingman: setup marked done on the desk");
      json(res, 200, { ok: true, text: "Done. Your settings stay as they are." });
    },

    // ---- the parts the wizard tries out, each only when the person clicks ------------------------
    "POST /api/check": async (req, res) => {
      const lines = [];
      const set = settings();
      const ctx = { mcDir, stateDir, paths, routine, settings: set, flags: {}, rest: [], print: (s) => lines.push(...String(s).split("\n")), fail: (s) => lines.push(String(s)) };
      const run = deps.check || (await import("../commands/check.mjs")).run;
      const code = await run(ctx);
      json(res, 200, { ok: code === 0, lines });
    },
    "POST /api/browser/open": async (req, res, url, body) => {
      const set = settings();
      const site = siteOf(String(body.site || set.sites[0] || ""));
      if (site.kind !== "browser") return json(res, 400, { ok: false, text: `${site.name} is an app; its login happens in the Android emulator.` });
      if (set.browser === "local" && set.browser_headless) return json(res, 400, { ok: false, text: "The Wingman's browser is set to run without a window (browser_headless), so there is nothing to log in to here." });
      const driver = await driverFor(set);
      try {
        await driver.goto(site.meta.login_url || site.meta.home);
        try { await driver.send?.("Page.bringToFront"); } catch { /* the bridge has no such call */ }
      } finally {
        await (typeof driver.detach === "function" ? driver.detach() : driver.close?.());
      }
      json(res, 200, { ok: true, text: set.browser === "bridge"
        ? `The browser behind the bridge shows the login page of ${site.name}. Log in there once.`
        : `The Wingman's own browser shows the login page of ${site.name}. Log in there once, then come back and press "Check my login".` });
    },
    "POST /api/browser/session": async (req, res, url, body) => {
      const set = settings();
      const site = siteOf(String(body.site || set.sites[0] || ""));
      const loaded = await (deps.loadSite || loadSite)(site.id, { mcDir });
      const driver = await driverFor(set);
      let sess;
      try { sess = await loaded.create({ driver, settings: { kind: set.kind, ...(set.site_options[site.id] || {}) }, log: () => {} }).session(); }
      finally { await driver.close?.(); }
      json(res, 200, sess?.loggedIn
        ? { ok: true, loggedIn: true, text: `You are logged into ${site.name}${sess.me?.name ? ` as ${clean(sess.me.name)}` : ""}.` }
        : { ok: true, loggedIn: false, text: `${site.name} shows no login in the Wingman's browser yet. Open it, log in, then check again.` });
    },
    "POST /api/model/test": async (req, res, url, body) => {
      const lane = LANES.includes(body.lane) ? body.lane : null;
      const name = typeof body.name === "string" && (body.name === "" || /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(body.name)) ? body.name : null;
      if (!lane || name === null) return json(res, 400, { ok: false, text: "Choose a model first." });
      const ask = deps.ask || (await import("../core/model.mjs")).ask;
      const t0 = Date.now();
      try {
        const out = await ask({ system: "You check that a connection works. Answer with one word only.", prompt: "Answer with the one word: ready" }, { lane, name }, { timeoutMs: 120000 });
        json(res, 200, { ok: true, text: `It answered in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s: "${clean(out, 60)}"` });
      } catch (e) {
        json(res, 200, { ok: false, text: `No answer: ${clean(e.message, 300)}` });
      }
    },
    "POST /api/telegram/test": async (req, res) => {
      const sendTg = deps.telegramSend || (await import("../channels/telegram.mjs")).send;
      try {
        await sendTg({ text: "From your Wingman: a test message from the setup. Nothing to answer.", settings: settings() });
        json(res, 200, { ok: true, text: "Sent. It should be in your Telegram chat now." });
      } catch (e) { json(res, 200, { ok: false, text: `Telegram did not take it: ${clean(e.message, 300)}` }); }
    },
    "POST /api/notify/test": async (req, res) => {
      const d = await import("../channels/desktop.mjs");
      try {
        await (deps.notify || d.notify)({ body: "Notifications work. A waiting question looks like this.", url: deskUrl(settings(), paths, "practice") });
        json(res, 200, { ok: true, text: "Shown. Look at the corner of your screen." });
      } catch (e) { json(res, 200, { ok: false, text: `No notification: ${clean(e.message, 300)}` }); }
    },
  };

  desk.handler = async (req, res) => {
    const port = desk.port;
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, "This page answers only at its own address on this computer.\n", "text/plain; charset=utf-8");
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${port}`); } catch { return send(res, 400, "Bad address.\n", "text/plain; charset=utf-8"); }
    const api = url.pathname.startsWith("/api/");
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { app: APP });
    // The key, once: it becomes the cookie and leaves the address bar.
    if (url.searchParams.has("t")) {
      if (req.method === "GET" && !api && same(url.searchParams.get("t"), secret)) {
        // Always to the page itself (the browser keeps the #part), never to a path from the request.
        res.writeHead(303, { ...BASE_HEADERS, "Set-Cookie": `${cookieName(port)}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, Location: "/" });
        return res.end();
      }
      return api ? json(res, 403, { ok: false, text: "No key." }) : send(res, 403, DENIED_PAGE, "text/html; charset=utf-8");
    }
    if (!same(cookies(req)[cookieName(port)], secret)) return api ? json(res, 403, { ok: false, text: "This desk needs its key. Open it with godspeed-wingman desk." }) : send(res, 403, DENIED_PAGE, "text/html; charset=utf-8");
    let body = {};
    if (req.method === "POST") {
      const origin = originOf(req);
      if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return json(res, 403, { ok: false, text: "Changes are taken only from the desk page itself." });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return json(res, 415, { ok: false, text: "Send JSON." });
      try { body = await readBody(req); } catch (e) { return json(res, e.status || 400, { ok: false, text: e.message }); }
    } else if (req.method !== "GET") return json(res, 405, { ok: false, text: "Not here." });
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return api ? json(res, 404, { ok: false, text: "Not here." }) : send(res, 404, "Not here.\n", "text/plain; charset=utf-8");
    try { await route(req, res, url, body); }
    catch (e) {
      log(`desk: ${req.method} ${url.pathname} failed: ${e.stack || e}`);
      if (!res.headersSent) json(res, e.status || 500, { ok: false, text: clean(e.message || "That did not work.", 300) });
    }
  };
  return desk;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const fail = (e) => { server.off("listening", ok); reject(e); };
    const ok = () => { server.off("error", fail); resolve(); };
    server.once("error", fail);
    server.once("listening", ok);
    server.listen(port, host);
  });
}

// Serves the desk on 127.0.0.1 only. Port 0 picks a free one (the tests).
export async function startDesk({ mcDir, stateDir, port, log = () => {}, deps = {} }) {
  const desk = createDesk({ mcDir, stateDir, log, deps });
  const p = port ?? loadSettings(desk.routine.settings).desk_port;
  const server = http.createServer((req, res) => { desk.handler(req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } }); });
  await listen(server, p, "127.0.0.1");
  desk.port = server.address().port;
  return {
    server, desk, port: desk.port,
    url: `http://127.0.0.1:${desk.port}/?t=${desk.secret}`,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

// The worker serves the desk for as long as it runs. When the port is taken (a `desk` command
// serving it right now), it tries again every minute.
export function keepDeskServed({ mcDir, stateDir, port, log = () => {}, retryMs = 60000 }) {
  let running = null, timer = null, stopped = false, said = false;
  const attempt = async () => {
    if (stopped || running) return;
    try {
      running = await startDesk({ mcDir, stateDir, port, log });
      log(`desk: serving http://127.0.0.1:${running.port}/`);
    } catch (e) {
      if (!said) { said = true; log(`desk: port ${port} is taken (${e.code || e.message}); trying again every minute`); }
      timer = setTimeout(attempt, retryMs);
      timer.unref?.();
    }
  };
  attempt();
  return { stop: async () => { stopped = true; clearTimeout(timer); if (running) await running.close(); } };
}
