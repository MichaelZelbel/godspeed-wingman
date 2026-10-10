// The worker: one process that owns the browser and the model. Every few seconds it reads the
// assistant's requests, and it runs the day's session at the person's chosen time, site after site:
// open the next profile, keep a copy, check the watch list, judge, then like or pass (on autopilot)
// or ask the owner (in practice). Between two profiles it waits a random 10 seconds to 3 minutes.
// Every 30 minutes it looks for matches and messages on every site. When no session runs, it takes
// again, at a person's pace, the picture of every kept profile whose picture showed only part of
// the page (retakeStep).
//
// Practice and autopilot are per site: a site goes on autopilot once the owner agreed with 9 of its
// last 10 practice verdicts, and a new site starts in practice even when another one is on
// autopilot. The owner's answers teach the judge on every site, because taste does not change per
// site.
//
// Everything it knows is in the state folder, so a restart continues where it stopped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { judge as runJudge } from "./judge.mjs";
import { readWatch, matchWatch } from "./watch.mjs";
import * as archive from "./archive.mjs";
import * as training from "./training.mjs";
import * as replies from "./replies.mjs";
import * as requests from "./requests.mjs";
import * as discord from "./discord.mjs";
import * as collection from "./collection.mjs";
import { Notebook } from "./notebook.mjs";
import { loadSettings, wallClock, randomBetween } from "./settings.mjs";
import { statePaths, routinePaths } from "./paths.mjs";
import { clean, headline } from "./text.mjs";
import { FRESH, readState, siteState, keyOf } from "./state.mjs";
import { adoptOwner, ensureDir, readJson, writeJson, appendJsonl, readJsonl, writeText } from "./store.mjs";
import { loadSite, listSites, adapterGaps } from "../sites/index.mjs";
import { SiteError, isLoggedOut } from "../sites/errors.mjs";
import { createDriver } from "../drivers/index.mjs";
import * as channels from "../channels/index.mjs";

export { FRESH };

// Between two pictures taken again: a random 10 seconds to a minute, like a person looking back.
export const RETAKE_SECONDS = [10, 60];
// The disk guard deletes a little more than it must, so it does not run again for every profile.
const GB = 1024 ** 3;
const ROOM_MARGIN = 256 * 1024 ** 2;
const MIN = 60000;
const FROM = "From your Wingman:";
const DRIVERS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drivers");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A practice example past the retention keeps what the person wrote about themselves, without
// their name.
export function forget(digestText, name) {
  let t = String(digestText || "").replace(/^Name:[^\n]*\n/, "");
  for (const part of String(name || "").split(/\s+/).filter((p) => p.length >= 3)) {
    t = t.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "(their name)");
  }
  return t;
}

// What the judge reads when a site's adapter has no digest of its own.
export function plainDigest(pr) {
  const lines = [
    `Name: ${pr.name}${Number.isFinite(pr.age) ? `, ${pr.age}` : ""}${pr.country ? `, ${String(pr.country).toUpperCase()}` : ""}`,
    `Gender: ${pr.gender || "not given"}`,
    `Pronouns: ${pr.pronouns || "not given"}`,
    pr.location ? `Location: ${pr.location}` : null,
    ...Object.entries(pr.fields || {}).map(([k, v]) => `${k}: ${v}`),
    `Bio:\n${pr.bio || "(empty)"}`,
  ].filter(Boolean);
  for (const q of pr.prompts || []) lines.push(`${q.q}: ${q.a}`);
  return lines.join("\n");
}

const currentSite = (run) => (run && Array.isArray(run.sites) ? run.sites[run.at || 0] || null : null);

export class Worker {
  constructor({ mcDir, stateDir, deps = {} }) {
    this.mcDir = mcDir;
    this.paths = statePaths(stateDir);
    this.routine = routinePaths(mcDir);
    // Tests replace: makeAdapter, loadSite, driver, ask, tell, now, rand, sleep, fetch, notebook,
    // noBrowserPage, freeBytes, roomMargin, screenshotsUrl.
    this.deps = deps;
    ensureDir(this.paths.root);
    adoptOwner(this.paths.root);
    ensureDir(this.paths.requests);
    ensureDir(this.paths.archive);
    this.sites = new Map();
    // The collection in the notebook is brought level once after every start, then after every
    // like, pass or review answer.
    this.collectionDirty = true;
    this.collectionTriedAt = 0;
    this.collectionLoggedAt = 0;
    this.stopping = false;
  }

  now() { return this.deps.now ? this.deps.now() : new Date(); }
  rand() { return this.deps.rand ? this.deps.rand() : Math.random(); }
  async wait(ms) { return this.deps.sleep ? this.deps.sleep(ms) : sleep(ms); }

  get settings() { return loadSettings(this.routine.settings); }
  get state() { return readState(this.paths.state); }
  save(s) { writeJson(this.paths.state, s); }
  update(fn) { const s = this.state; fn(s); this.save(s); return s; }
  updateSite(id, fn) {
    return this.update((s) => { const ss = siteState(s, id); fn(ss); s.sites = { ...(s.sites || {}), [id]: ss }; });
  }
  today() { return wallClock(this.now(), this.settings.timezone).day; }

  log(line) {
    const text = `${this.now().toISOString()} ${line}\n`;
    try {
      if (fs.existsSync(this.paths.log) && fs.statSync(this.paths.log).size > 2_000_000) fs.renameSync(this.paths.log, this.paths.log + ".1");
      fs.appendFileSync(this.paths.log, text);
    } catch { /* logging never stops the work */ }
  }

  // ---- the browser and the sites ----------------------------------------------------------------
  get driver() {
    if (this.deps.driver) return this.deps.driver;
    if (!this._driver) this._driver = createDriver(this.settings, { paths: this.paths, log: (l) => this.log(`browser: ${l}`) });
    return this._driver;
  }

  // What an adapter holds: the worker's browser, looked up at every call, so a test (or a change
  // of driver) reaches an adapter made before it.
  driverProxy() {
    return new Proxy({}, {
      get: (_, k) => {
        const d = this.driver;
        const v = d?.[k];
        return typeof v === "function" ? v.bind(d) : v;
      },
    });
  }

  async driverFor(meta) {
    if (meta.kind !== "android") return this.driverProxy();
    if (this.deps.androidDriver) return this.deps.androidDriver;
    const file = path.join(DRIVERS, "android.mjs");
    if (!fs.existsSync(file)) throw new SiteError(`${meta.name} is an Android app, and the Android driver is not part of this version.`, { site: meta.id, refused: true });
    const mod = await import(pathToFileURL(file).href);
    if (!this._android) this._android = mod.createDriver({ settings: this.settings, paths: this.paths, log: (l) => this.log(`android: ${l}`) });
    return this._android;
  }

  siteOptions(id) { const set = this.settings; return { kind: set.kind, ...(set.site_options[id] || {}) }; }

  // One site, loaded once: { id, name, meta, adapter }. Throws a SiteError with plain words when
  // the site is refused (its terms) or broken.
  async site(id) {
    if (this.sites.has(id)) return this.sites.get(id);
    const loaded = this.deps.loadSite ? await this.deps.loadSite(id) : await loadSite(id, { mcDir: this.mcDir, now: this.now() });
    const ctx = { driver: await this.driverFor(loaded.meta), settings: this.siteOptions(id), log: (l) => this.log(l), wait: (ms) => this.wait(ms), now: () => this.now() };
    const adapter = this.deps.makeAdapter ? this.deps.makeAdapter(id, ctx, loaded) : loaded.create(ctx);
    const gaps = adapterGaps(adapter, loaded.meta);
    if (gaps.length) throw new SiteError(`The adapter of ${loaded.meta.name} lacks ${gaps.join(", ")}, so the Wingman cannot use it.`, { site: id, refused: true });
    const site = { id, name: loaded.meta.name, meta: loaded.meta, adapter, can: new Set(loaded.meta.can || []) };
    this.sites.set(id, site);
    return site;
  }

  siteName(id) { return this.sites.get(id)?.name || id; }
  multiSite() { return this.settings.sites.length > 1; }
  headlineFor(site, profile) { return `${headline(profile)}${this.multiSite() ? ` on ${site.name}` : ""}`; }
  digestOf(site, profile) { return site?.adapter?.digest ? site.adapter.digest(profile) : plainDigest(profile); }
  about(site) { return site.meta.about || site.name; }

  get notebook() {
    if (this.deps.notebook) return this.deps.notebook;
    if (!this._nb) this._nb = new Notebook();
    return this._nb;
  }
  get screenshotsUrl() { return this.deps.screenshotsUrl ?? process.env.GODSPEED_WINGMAN_SCREENSHOTS_URL ?? ""; }

  preferences() { try { return fs.readFileSync(this.routine.preferences, "utf8"); } catch { return ""; } }

  // ---- telling the owner ------------------------------------------------------------------------
  // True only when at least one channel took the message. Never throws: a message no channel took
  // is retried by tick().
  async tell(text, picture) {
    try {
      if (this.deps.tell) return !!(await this.deps.tell(text, picture));
      const r = await channels.tell(text, picture, { settings: this.settings, paths: this.paths, log: (l) => this.log(l) });
      if (!r.delivered) this.log(`message not delivered: ${Object.entries(r.results).map(([k, v]) => `${k}: ${v}`).join(", ") || "no channel chosen (talk)"}`);
      return r.delivered;
    } catch (e) {
      this.log(`message failed: ${e.message}`);
      return false;
    }
  }

  // An open question is sent until a channel has taken it; notifiedAt marks that.
  async ask(waiting, text, picture) {
    this.update((st) => { st.waiting = { ...waiting, message: text, picture: picture || null, notifiedAt: null, triedAt: this.now().toISOString() }; });
    if (await this.tell(text, picture)) this.update((st) => { if (st.waiting?.id === waiting.id) st.waiting.notifiedAt = this.now().toISOString(); });
  }

  async resendIfNeeded() {
    const w = this.state.waiting;
    if (!w) return;
    const day = this.today();
    if (!w.notifiedAt) {
      if (this.now().getTime() - new Date(w.triedAt || 0).getTime() < 5 * MIN) return;
      this.update((st) => { st.waiting.triedAt = this.now().toISOString(); });
      if (await this.tell(w.message, this.pictureOf(w))) this.update((st) => { if (st.waiting) st.waiting.notifiedAt = this.now().toISOString(); });
      return;
    }
    // Once a day, at the session time, a question still open from an earlier day is shown again,
    // because the day's session waits for it.
    const set = this.settings;
    const askedDay = wallClock(new Date(w.askedAt), set.timezone).day;
    if (askedDay < day && w.remindedDay !== day && wallClock(this.now(), set.timezone).time >= set.daily_start) {
      this.update((st) => { st.waiting.remindedDay = day; });
      await this.tell(`${FROM} still open from ${askedDay}, and today's session waits for it.\n${w.message.replace(`${FROM} `, "")}`, this.pictureOf(w));
    }
  }

  // The picture of an open question, also when it was renamed after it was asked.
  pictureOf(w) {
    if (w?.picture && fs.existsSync(w.picture)) return w.picture;
    return w?.dir ? archive.picturePath(this.paths, { dir: w.dir }) : null;
  }

  // Names every kept picture by day and name and links it into screenshots/; an open question's
  // picture follows its new name.
  nameShots() {
    let moved = [];
    try { moved = archive.nameShots(this.paths); } catch (e) { this.log(`naming the screenshots failed: ${e.message}`); return; }
    if (!moved.length) return;
    const to = new Map(moved.map((m) => [path.resolve(m.from), m.to]));
    this.update((st) => { if (st.waiting?.picture && to.has(path.resolve(st.waiting.picture))) st.waiting.picture = to.get(path.resolve(st.waiting.picture)); });
    this.log(`screenshots: ${moved.length} named by day and name`);
  }

  // ---- the notebook: the collection of likes and passes ----------------------------------------
  async syncCollection({ force = false } = {}) {
    if (!this.settings.notebook_collection) return null;
    if (!force && (!this.collectionDirty || this.now().getTime() - this.collectionTriedAt < MIN)) return null;
    this.collectionTriedAt = this.now().getTime();
    this.collectionDirty = false;
    try {
      const sites = Object.fromEntries(listSites({ mcDir: this.mcDir }).filter((s) => s.meta).map((s) => [s.id, s.meta]));
      const set = this.settings;
      const r = await collection.sync(this.notebook, this.paths, { collectionId: this.state.collection?.id, timezone: set.timezone, screenshotsUrl: this.screenshotsUrl, sites, retentionDays: set.retention_days, log: (l) => this.log(l) });
      this.update((st) => { st.collection = { id: r.collectionId, slug: r.slug ?? st.collection?.slug ?? null, total: r.total, removed: !!r.removed, at: this.now().toISOString() }; });
      if (r.conflicts) this.collectionDirty = true;
      if (r.created) this.log(`notebook: made the collection "${collection.TITLE}"`);
      if (r.inserted || r.updated) this.log(`notebook: ${r.inserted} item(s) added, ${r.updated} updated, ${r.total} in all`);
      if (r.removed) this.log("notebook: the collection was deleted in the notebook, so nothing is written to it");
      return r;
    } catch (e) {
      this.collectionDirty = true;
      if (force || this.now().getTime() - this.collectionLoggedAt > 60 * MIN) { this.collectionLoggedAt = this.now().getTime(); this.log(`notebook: could not write the collection: ${e.message}`); }
      if (force) throw e;
      return null;
    }
  }

  // ---- the loop ---------------------------------------------------------------------------------
  // One worker at a time: a second one (a stray `worker` next to the service) stops at once.
  lock() {
    const f = this.paths.pid;
    const other = Number((() => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } })());
    if (other && other !== process.pid) {
      try { process.kill(other, 0); return false; } catch { /* that worker is gone */ }
    }
    writeText(f, `${process.pid}\n`);
    return true;
  }

  async loop({ once = false, intervalMs = 3000 } = {}) {
    if (!this.lock()) { console.error("Another godspeed-wingman worker is running; this one stops."); return false; }
    this.log(`worker started, pid ${process.pid}`);
    this.nameShots();
    this.slimOnce();
    try {
      for (;;) {
        try { await this.tick(); } catch (e) { this.log(`tick failed: ${e.stack || e}`); }
        if (once || this.stopping) return true;
        await sleep(intervalMs);
        if (this.stopping) return true;
      }
    } finally {
      if (!once) await this.close();
    }
  }

  stop() { this.stopping = true; }

  async close() {
    try { await this._driver?.close?.(); } catch { /* gone */ }
    try { await this._android?.close?.(); } catch { /* gone */ }
  }

  async tick() {
    for (const req of requests.pending(this.paths)) {
      let result;
      try { result = await this.handle(req.body); }
      catch (e) { result = { ok: false, text: `That did not work: ${e.message}` }; this.log(`request ${req.body.type} failed: ${e.stack || e}`); }
      requests.done(this.paths, req, result);
    }
    const s = this.state;
    // Read by the command against the real clock, so written with it (tests move this.now()).
    writeJson(this.paths.heartbeat, { at: new Date().toISOString(), pid: process.pid, run: !!s.run, site: currentSite(s.run), waiting: s.waiting?.kind || null, paused: s.paused });
    this.housekeeping(s);
    await this.syncCollection();
    if (s.paused) return;
    await this.resendIfNeeded();
    await this.resendDiscord();
    const set = this.settings;
    if (this.now().getTime() - (s.lastInboxAt || 0) >= set.inbox_every_minutes * MIN) await this.checkInbox();
    const fresh = this.state;
    if (!fresh.run && !fresh.waiting && this.dailyDue(fresh, set)) this.startRun("daily");
    const r = this.state;
    if (r.run && !r.waiting) {
      if (this.now().toISOString() >= r.run.endsAt) return this.endRun("the session reached its time limit");
      if (this.now().getTime() >= (r.nextActionAt || 0)) await this.guard(() => this.step(), currentSite(r.run));
    } else if (!r.run) {
      await this.retakeStep();
    }
  }

  dailyDue(s, set) {
    const w = wallClock(this.now(), set.timezone);
    return s.lastRunDay !== w.day && w.time >= set.daily_start;
  }

  startRun(why, { sites } = {}) {
    const set = this.settings;
    const list = (Array.isArray(sites) && sites.length ? sites : set.sites).filter((x) => typeof x === "string");
    this.update((s) => {
      s.lastRunDay = this.today();
      s.practiceStopped = false;
      s.run = { why, day: this.today(), startedAt: this.now().toISOString(), endsAt: new Date(this.now().getTime() + set.max_run_hours * 3600000).toISOString(), liked: 0, passed: 0, asked: 0, stopped: 0, skipped: 0, pendingRetries: 0, sites: list, at: 0, ended: {} };
      s.nextActionAt = 0;
      s.consecutiveErrors = 0;
    });
    this.log(`session started (${why}): ${list.join(", ") || "no site is switched on"}`);
  }

  endRun(why) {
    this.update((s) => {
      if (s.run) s.lastRun = { ...s.run, endedAt: this.now().toISOString(), why };
      s.run = null;
    });
    this.log(`session ended: ${why}`);
  }

  runSummary(run) {
    const said = (run?.sites || []).map((id) => run.ended?.[id]).filter(Boolean);
    return [...new Set(said)].join("; ");
  }

  // One site's part of the session is over: the session goes on with the next site, and ends
  // after the last. A site that is not the current one is marked, and skipped when its turn comes.
  siteDone(siteId, why) {
    const s = this.update((st) => {
      if (!st.run) return;
      st.run.ended = { ...(st.run.ended || {}), [siteId]: why };
      if (currentSite(st.run) === siteId) { st.run.at = (st.run.at || 0) + 1; st.run.pendingRetries = 0; st.nextActionAt = 0; }
    });
    if (!s.run) return;
    this.log(`${this.siteName(siteId)}: done for this session (${why})`);
    if ((s.run.at || 0) >= s.run.sites.length) this.endRun(this.runSummary(s.run) || why);
  }

  // One error is retried in two minutes; five in a row end the session. A lost login stops that
  // site and tells the owner once a day, because only they can log in again. A refused site (its
  // terms, a broken adapter) is left out of the session.
  async guard(fn, siteId = null) {
    try {
      await fn();
      if (this.state.consecutiveErrors) this.update((s) => { s.consecutiveErrors = 0; });
    } catch (e) {
      const msg = e?.message || String(e);
      const site = e?.site || siteId;
      this.log(`error${site ? ` (${site})` : ""}: ${e?.stack || msg}`);
      if (isLoggedOut(e) && site) {
        const name = this.siteName(site);
        const day = this.today();
        this.update((st) => { st.lastError = { at: this.now().toISOString(), text: `${name} logged the Wingman out` }; });
        this.updateSite(site, (ss) => { ss.loggedOutAt = ss.loggedOutAt || this.now().toISOString(); });
        if (this.state.run?.sites?.includes(site)) this.siteDone(site, `logged out of ${name}`);
        // Before the first login there is nothing to tell: setting up the login is part of the
        // setup, and `godspeed-wingman check` shows it. Only a login that worked and was lost
        // needs the owner.
        const ss = siteState(this.state, site);
        if (ss.me && ss.loggedOutNoticeDay !== day) {
          if (await this.tell(`${FROM} ${name} logged me out, so I cannot pick or read messages there until you log in again. Tell me when you have a minute and I walk you through it.`)) this.updateSite(site, (x) => { x.loggedOutNoticeDay = day; });
        }
        return;
      }
      if (e?.refused && site) {
        this.update((st) => { st.lastError = { at: this.now().toISOString(), text: msg.slice(0, 300) }; });
        if (this.state.run?.sites?.includes(site)) this.siteDone(site, msg.slice(0, 200));
        return;
      }
      const s = this.update((st) => { st.consecutiveErrors = (st.consecutiveErrors || 0) + 1; st.lastError = { at: this.now().toISOString(), text: msg.slice(0, 300) }; st.nextActionAt = this.now().getTime() + 2 * MIN; });
      if (s.consecutiveErrors >= 5 && s.run) this.endRun(`five errors in a row, the last: ${msg.slice(0, 200)}`);
    }
  }

  // Once a day: other people's data older than the retention goes. The archive folders, the log of
  // decisions, the reply ideas, the desk's messages, the "liked you" lists; practice examples keep
  // only what the person wrote about themselves, without their name or id.
  housekeeping(s) {
    const set = this.settings;
    const day = this.today();
    if (s.lastPruneDay === day) return;
    const removed = archive.prune(this.paths, set.retention_days, this.now());
    const cutoff = new Date(this.now().getTime() - set.retention_days * 86400000).toISOString();
    const keepLines = (file, keep) => {
      if (!fs.existsSync(file)) return;
      const rows = readJsonl(file);
      const kept = rows.map(keep).filter(Boolean);
      writeText(file, kept.map((d) => JSON.stringify(d)).join("\n") + (kept.length ? "\n" : ""));
    };
    keepLines(this.paths.decisions, (d) => ((d.at || "") >= cutoff ? d : null));
    keepLines(this.paths.examples, (e) => ((e.at || "") >= cutoff || !e.id ? e : { ...e, id: null, name: null, digest: forget(e.digest, e.name) }));
    keepLines(path.join(this.paths.desk, "messages.jsonl"), (m) => ((m.at || "") >= cutoff ? m : null));
    const all = readJson(this.paths.replies, {}) || {};
    for (const [k, v] of Object.entries(all)) if ((v.created || "") < cutoff) delete all[k];
    writeJson(this.paths.replies, all);
    let old = [];
    try { old = fs.readdirSync(this.paths.requestsDone).filter((n) => n.endsWith(".json")); } catch { /* none */ }
    for (const n of old) {
      const f = path.join(this.paths.requestsDone, n);
      try { if (this.now().getTime() - fs.statSync(f).mtimeMs > 7 * 86400000) fs.unlinkSync(f); } catch { /* gone */ }
    }
    this.update((st) => {
      st.lastPruneDay = day;
      const cutDay = cutoff.slice(0, 10);
      for (const [id, ss] of Object.entries(st.sites || {})) {
        st.sites[id] = { ...ss, likedYouSeen: Object.fromEntries(Object.entries(ss.likedYouSeen || {}).filter(([, d]) => d >= cutDay)) };
      }
      st.discordTold = Object.fromEntries(Object.entries(st.discordTold || {}).filter(([, d]) => (d.day || "") >= cutDay));
    });
    if (removed) this.log(`archive: deleted ${removed} day folder(s) older than ${set.retention_days} days`);
    this.nameShots();
  }

  practicing(s, siteId) { return siteState(s, siteId).mode === "practice" || (s.practiceLeft || 0) > 0; }

  // ---- one profile ------------------------------------------------------------------------------
  async step() {
    let s = this.state;
    let cur = currentSite(s.run);
    // A site whose part already ended (a lost login found by the inbox check) is skipped.
    while (cur && s.run.ended?.[cur]) {
      s = this.update((st) => { st.run.at = (st.run.at || 0) + 1; });
      cur = currentSite(s.run);
    }
    if (!cur) return this.endRun(this.runSummary(s.run) || "no site is switched on");
    const site = await this.site(cur);
    const q = await site.adapter.queue();
    if (siteState(s, cur).loggedOutAt) this.updateSite(cur, (x) => { x.loggedOutAt = null; });
    if (!q?.next?.length) {
      if (!q?.done && (s.run.pendingRetries || 0) < 6) {
        this.update((st) => { st.run.pendingRetries = (st.run.pendingRetries || 0) + 1; st.nextActionAt = this.now().getTime() + 30000; });
        return;
      }
      return this.siteDone(cur, `${site.name} has no more profiles for today`);
    }
    const id = q.next[0];
    try {
      await this.decide(site, id);
    } catch (e) {
      if (isLoggedOut(e) || e?.refused) throw e;
      // A profile that fails twice is taken out of today's queue without a like or a pass, so one
      // broken profile cannot block every session after it.
      const k = keyOf(cur, id);
      const n = this.update((st) => { st.failures = { ...(st.failures || {}), [k]: ((st.failures || {})[k] || 0) + 1 }; }).failures[k];
      if (n < 2) throw e;
      this.log(`skipping ${cur} ${id} after ${n} failures: ${e.message}`);
      try {
        if (typeof site.adapter.skip !== "function") throw new Error("the site has no skip");
        await site.adapter.skip(id);
      } catch (e2) { this.log(`skip refused (${e2.message}); passing instead`); await site.adapter.pass(id); }
      appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: cur, id, action: "skipped", why: e.message.slice(0, 200) });
      this.update((st) => { delete st.failures[k]; if (st.run) st.run.skipped++; st.nextActionAt = this.now().getTime() + 5000; });
    }
  }

  async decide(site, id) {
    const set = this.settings;
    const k = keyOf(site.id, id);
    const known = this.state.decided?.[k];
    const opened = await this.open(site, id, "queue");
    const { profile, entry } = opened;
    const hl = this.headlineFor(site, profile);
    if (known) {
      // The owner already decided on this profile on a day the site had no likes left: done now,
      // without asking again.
      const ok = await this.act(known.verdict, opened, { by: known.by, reason: known.reason });
      if (ok) this.update((st) => { delete st.decided[k]; st.nextActionAt = this.now().getTime() + randomBetween(set.wait_seconds, () => this.rand()) * 1000; });
      return;
    }
    const hit = matchWatch(readWatch(this.routine.watch), profile);
    if (hit) {
      appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: site.id, id, name: profile.name, action: "stopped", why: `watch list: ${hit.name} (${hit.field})` });
      this.update((st) => { if (st.run) st.run.stopped++; });
      await this.ask(
        { kind: "watch", site: site.id, siteName: site.name, id, name: profile.name, headline: hl, url: profile.url, dir: entry.dir, watchName: hit.name, field: hit.field, askedAt: this.now().toISOString() },
        `${FROM} ${hl} is on your watch list: their ${hit.field} matches "${hit.name}". I stopped before liking or passing. Say "like", "pass" or "you decide".\nTheir profile: ${profile.url}`,
        archive.picturePath(this.paths, entry));
      return;
    }
    const d = this.digestOf(site, profile);
    const v = await runJudge({ preferences: this.preferences(), examples: training.examples(this.paths), profileDigest: d, model: set.model, askImpl: this.deps.ask, about: this.about(site) });
    if (this.practicing(this.state, site.id)) {
      const a = training.agreement(this.paths, set.practice_until.of, site.id);
      appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: site.id, id, name: profile.name, action: "asked", verdict: v.verdict, reason: v.reason });
      this.update((st) => { if (st.run) st.run.asked++; });
      const tally = a.of ? ` (you agreed with ${a.agreed} of my last ${a.of})` : "";
      await this.ask(
        { kind: "practice", site: site.id, siteName: site.name, id, name: profile.name, headline: hl, url: profile.url, dir: entry.dir, verdict: v.verdict, sure: v.sure, reason: v.reason, digest: d, discord: v.discord, discordJudged: true, askedAt: this.now().toISOString() },
        `${FROM} practice${tally}. ${hl}: I would ${v.verdict === "like" ? "LIKE" : "PASS ON"} them, ${v.sure} sure. ${v.reason}\nAgree? Say "agree", or "disagree" and why.\nTheir profile: ${profile.url}`,
        archive.picturePath(this.paths, entry));
      return;
    }
    await this.wait(randomBetween(set.read_seconds, () => this.rand()) * 1000);
    await this.act(v.verdict, opened, { by: "wingman", reason: v.reason, sure: v.sure }, v.discord);
    this.update((st) => { st.nextActionAt = this.now().getTime() + randomBetween(set.wait_seconds, () => this.rand()) * 1000; });
  }

  // Opens the profile's page (as a person would), keeps the copy, returns the profile.
  async open(site, id, source) {
    const profile = await site.adapter.profile(id);
    const raw = profile.raw ?? null;
    delete profile.raw;
    profile.site = site.id;
    let screenshot = null, html = null, shot = null;
    if (!this.deps.noBrowserPage && typeof site.adapter.open === "function") {
      try {
        await site.adapter.open(profile);
        if (typeof site.adapter.picture === "function") {
          const pic = await site.adapter.picture(profile);
          screenshot = pic?.data || null;
          shot = pic?.meta || null;
        }
        if (typeof site.adapter.html === "function") html = await site.adapter.html();
      } catch (e) { this.log(`could not picture ${clean(profile.name)}: ${e.message}`); }
    }
    this.ensureRoom();
    const entry = await archive.save(this.paths, { day: this.today(), site: site.id, raw, profile, screenshot, shot, html, source, fetchImpl: this.deps.fetch || fetch, log: (l) => this.log(`${clean(profile.name)}: ${l}`) });
    return { raw, profile, entry, site };
  }

  // ---- the disk guard ---------------------------------------------------------------------------
  // Before a picture is kept: when the disk has less than min_free_gb free, the pictures of the
  // oldest kept profiles go first (archive.makeRoom, never the profiles themselves, never the last
  // seven days), logged, and shown by `status` and `check`. Never throws and never stops a session:
  // at worst a picture is not kept. When the rest of the disk is not the Wingman's to free, it
  // looks again in half an hour instead of for every profile.
  freeBytes() { return this.deps.freeBytes ? this.deps.freeBytes(this.paths.root) : archive.freeBytes(this.paths.root); }

  ensureRoom() {
    try {
      const min = this.settings.min_free_gb * GB;
      if (!min) return;
      const free = this.freeBytes();
      if (free === null || free >= min) {
        if (free !== null && this.state.disk?.short) this.update((st) => { st.disk = { ...st.disk, short: false, free, checkedAt: this.now().toISOString() }; });
        return;
      }
      if (this.now().getTime() < (this.diskQuietUntil || 0)) return;
      const keep = [this.state.waiting?.dir].filter(Boolean);
      const r = archive.makeRoom(this.paths, min - free + (this.deps.roomMargin ?? ROOM_MARGIN), { keep, now: this.now() });
      const after = this.freeBytes() ?? free + r.freed;
      const at = this.now().toISOString();
      const gb = (b) => (b / GB).toFixed(1);
      this.update((st) => {
        const d = st.disk || {};
        st.disk = {
          checkedAt: at, free: after, min, short: after < min,
          ...(r.files ? { cleanedAt: at, files: (d.files || 0) + r.files, profiles: (d.profiles || 0) + r.profiles, freed: (d.freed || 0) + r.freed, first: d.first && d.first < r.first ? d.first : r.first, last: d.last && d.last > r.last ? d.last : r.last }
            : { cleanedAt: d.cleanedAt || null, files: d.files || 0, profiles: d.profiles || 0, freed: d.freed || 0, first: d.first || null, last: d.last || null }),
        };
      });
      if (r.files) this.log(`disk: only ${gb(free)} GB free (the guard keeps ${gb(min)} GB), so the pictures of the ${r.profiles} oldest kept profiles (${r.first} to ${r.last}, ${r.files} files, ${Math.round(r.freed / 1024 ** 2)} MB) were deleted; the profiles stay. Now ${gb(after)} GB free.`);
      if (after < min) {
        this.diskQuietUntil = this.now().getTime() + 30 * MIN;
        this.log(`disk: still only ${gb(after)} GB free; the rest is not the Wingman's to delete (it keeps the pictures of the last seven days), looking again in half an hour`);
      }
    } catch (e) { this.log(`disk guard: ${e.message}`); }
  }

  // Once: separate pictures go where the picture of the page shows them all, and every kept page
  // is compressed.
  slimOnce() {
    if (this.state.slimmed) return;
    try {
      const r = archive.slimArchive(this.paths);
      this.update((st) => { st.slimmed = { at: this.now().toISOString(), ...r }; });
      if (r.avatars || r.pages) this.log(`archive: ${r.avatars} separate picture(s) shown in the whole-profile picture deleted, ${r.pages} page(s) compressed, ${Math.round(r.freed / 1024 ** 2)} MB freed`);
    } catch (e) { this.log(`archive: making it lean failed: ${e.message}`); }
  }

  // ---- pictures taken again ---------------------------------------------------------------------
  // One kept profile per call, only while no session runs and nothing is paused: open its page
  // again (read only, never a like, pass or message), take the whole picture, put it in place of
  // the old one under the same name scheme. The old picture stays when the new one is no better
  // (the card never appeared). A lost login stops the job for half an hour without counting the try.
  async retakeStep() {
    if (this.deps.noBrowserPage) return;
    const s = this.state;
    if (this.now().getTime() < (s.retake?.nextAt || 0)) return;
    const todo = archive.needingRetake(this.paths);
    if (!todo.length) {
      if (s.retake && !s.retake.finishedAt) {
        this.update((st) => { st.retake = { ...st.retake, finishedAt: this.now().toISOString() }; });
        this.log(`screenshots: done taking pictures again (${s.retake.done || 0} new, ${s.retake.kept || 0} kept as they were)`);
      }
      return;
    }
    if (!s.retake || s.retake.finishedAt) {
      this.update((st) => { st.retake = { startedAt: this.now().toISOString(), done: 0, kept: 0, nextAt: 0, finishedAt: null }; });
      this.log(`screenshots: taking ${todo.length} picture(s) again, whole profile, while no session runs`);
    }
    const t = todo[0];
    const dir = path.join(this.paths.archive, t.dir);
    const profile = readJson(path.join(dir, "profile.json")) || {};
    const later = (sec) => this.update((st) => { st.retake.nextAt = this.now().getTime() + sec * 1000; });
    const siteId = profile.site || t.site;
    let site = null;
    try { site = siteId && this.settings.sites.includes(siteId) ? await this.site(siteId) : null; } catch { site = null; }
    if (!site || typeof site.adapter.open !== "function" || typeof site.adapter.picture !== "function") { archive.retakeFailed(this.paths, t.dir, `the site ${siteId || "(unknown)"} is not switched on`); return later(1); }
    if (!profile.id) { archive.retakeFailed(this.paths, t.dir, "no profile id kept"); return later(1); }
    let pic;
    try {
      await site.adapter.open(profile);
      pic = await site.adapter.picture(profile);
    } catch (e) {
      this.log(`screenshots: could not open the page of ${clean(profile.name)} again: ${e.message}`);
      return later(5 * 60);
    }
    if (pic?.meta?.loggedIn === false) {
      this.log(`screenshots: ${site.name} shows no login, so taking pictures again waits half an hour`);
      return later(30 * 60);
    }
    if (pic?.meta?.shown && pic.data?.length) {
      let html = null;
      try { html = typeof site.adapter.html === "function" ? await site.adapter.html() : null; } catch { html = null; }
      this.ensureRoom();
      let file;
      try { file = archive.replaceShot(this.paths, t.dir, { buf: pic.data, shot: pic.meta, html }); }
      catch (e) { this.log(`screenshots: could not keep the new picture of ${clean(profile.name)}: ${e.message}`); return later(5 * 60); }
      this.collectionDirty = true;
      this.update((st) => {
        st.retake.done = (st.retake.done || 0) + 1;
        if (st.waiting?.dir === t.dir) st.waiting.picture = file;
      });
      this.log(`screenshots: ${path.basename(file)} taken again${pic.meta.ready ? "" : " (a picture on it was still loading)"}`);
    } else {
      archive.retakeFailed(this.paths, t.dir, pic?.meta?.unfinished ? `the profile card did not appear (${JSON.stringify(pic.meta.unfinished)})` : "no picture");
      this.update((st) => { st.retake.kept = (st.retake.kept || 0) + 1; });
      this.log(`screenshots: the page of ${clean(profile.name)} did not show the profile, so the old picture stays`);
    }
    later(randomBetween(RETAKE_SECONDS, () => this.rand()));
  }

  // Like or pass. False when the site has no likes or profiles left today (nothing was done).
  // `judged` is the judge's find of a Discord name (null: none; undefined: no judge ran).
  async act(verdict, { profile, entry, site }, meta, judged) {
    const set = this.settings;
    const r = await (verdict === "like" ? site.adapter.like(profile.id) : site.adapter.pass(profile.id));
    if (r?.limitReached) {
      const what = r.why === "profiles" ? "profiles" : "likes";
      appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: site.id, id: profile.id, name: profile.name, action: "not-done", verdict, why: `out of ${what}` });
      archive.noteOutcome(this.paths, entry, { action: "not-done", verdict, ...meta, why: `out of ${what}` });
      if (currentSite(this.state.run) === site.id) this.siteDone(site.id, `${site.name} says no more ${what} today`);
      return false;
    }
    const match = !!r?.match;
    appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: site.id, id: profile.id, name: profile.name, action: verdict, ...meta, match });
    this.collectionDirty = true;
    const dc = verdict === "like" && set.contact_notice ? await this.discordOf(site, profile, judged) : null;
    archive.noteOutcome(this.paths, entry, { action: verdict, ...meta, match, ...(dc ? { discordFound: dc.handle } : {}) });
    this.update((st) => { if (st.run) st.run[verdict === "like" ? "liked" : "passed"]++; if (match) st.lastInboxAt = 0; });
    if (dc) await this.tellDiscord(site, profile, dc);
    return true;
  }

  // ---- their Discord, after a like --------------------------------------------------------------
  // The like has happened by now, so nothing here may throw.
  async discordOf(site, profile, judged) {
    try {
      return await discord.find(profile, { judged, model: this.settings.model, askImpl: this.deps.ask, digestText: this.digestOf(site, profile) });
    } catch (e) { this.log(`discord lookup failed for ${clean(profile.name)}: ${e.message}`); return null; }
  }

  // Once per person, ever (the record outlives a restart and is kept for the retention). Sent until
  // a channel takes it, like an open question, for a day at most.
  async tellDiscord(site, profile, dc) {
    const k = keyOf(site.id, profile.id);
    if (this.state.discordTold?.[k]) return;
    const text = discord.notice(FROM, profile, dc, this.headlineFor(site, profile), site.name);
    const at = this.now().toISOString();
    this.update((st) => { st.discordTold = { ...(st.discordTold || {}), [k]: { day: this.today(), at, site: site.id, name: clean(profile.name), handle: dc.handle, wellFormed: dc.wellFormed, message: text, notifiedAt: null, triedAt: at } }; });
    this.log(`liked ${clean(profile.name)}, who gave a Discord name; telling the owner`);
    if (await this.tell(text)) this.update((st) => { st.discordTold[k].notifiedAt = this.now().toISOString(); });
  }

  async resendDiscord() {
    const now = this.now().getTime();
    for (const [k, d] of Object.entries(this.state.discordTold || {})) {
      if (d.notifiedAt || now - new Date(d.at).getTime() > 24 * 3600000 || now - new Date(d.triedAt || 0).getTime() < 5 * MIN) continue;
      this.update((st) => { st.discordTold[k].triedAt = this.now().toISOString(); });
      if (await this.tell(d.message)) this.update((st) => { st.discordTold[k].notifiedAt = this.now().toISOString(); });
    }
  }

  // ---- matches and messages ---------------------------------------------------------------------
  async checkInbox() {
    this.update((st) => { st.lastInboxAt = this.now().getTime(); });
    for (const id of this.settings.sites) await this.guard(() => this.checkInboxOf(id), id);
  }

  async checkInboxOf(siteId) {
    const site = await this.site(siteId);
    if (!site.can.has("inbox")) return;
    if (!siteState(this.state, siteId).me) {
      const sess = await site.adapter.session();
      if (!sess?.loggedIn) throw new SiteError(`${site.name} shows no login`, { site: siteId, loggedOut: true });
      this.updateSite(siteId, (x) => { x.me = sess.me?.id || sess.me?.name || "logged in"; });
    }
    const list = await site.adapter.conversations();
    if (siteState(this.state, siteId).loggedOutAt) this.updateSite(siteId, (x) => { x.loggedOutAt = null; });
    const todo = replies.needs(list, siteState(this.state, siteId).reported);
    for (const n of todo.slice(0, 5)) {
      try {
        await this.offerReplies(site, n);
      } catch (e) {
        if (isLoggedOut(e)) throw e;
        // One conversation that fails twice is set aside, so it cannot hold up the others.
        const key = `conv:${siteId}:${n.conversationId}:${n.mark}`;
        const c = this.update((st) => { st.failures = { ...(st.failures || {}), [key]: ((st.failures || {})[key] || 0) + 1 }; }).failures[key];
        this.log(`reply ideas for ${siteId} ${n.conversationId} failed (${c}): ${e.message}`);
        if (c >= 2) {
          this.update((st) => { delete st.failures[key]; });
          this.updateSite(siteId, (x) => { x.reported = { ...x.reported, [n.conversationId]: n.mark }; });
        }
      }
    }
    if (site.can.has("liked-you") && typeof site.adapter.likedYou === "function") await this.archiveLikedYou(site);
  }

  async offerReplies(site, n) {
    const opened = await this.open(site, n.userId, n.kind === "opener" ? "match" : "message");
    const options = await replies.writeOptions({ digest: this.digestOf(site, opened.profile), theirMessage: n.theirMessage, howYouWrite: replies.howYouWrite(this.preferences()), kind: n.kind, about: this.about(site) }, this.settings.model, this.deps.ask);
    const seq = (this.state.replySeq || 0) + 1;
    const set = { id: `R${seq}`, site: site.id, siteName: site.name, kind: n.kind, conversationId: n.conversationId, userId: n.userId, name: opened.profile.name, headline: this.headlineFor(site, opened.profile), url: opened.profile.url, theirMessage: n.theirMessage || "", options, created: this.now().toISOString(), sent: null };
    const all = readJson(this.paths.replies, {}) || {};
    all[set.id] = set;
    writeJson(this.paths.replies, all);
    this.update((st) => { st.replySeq = seq; });
    if (await this.tell(replies.messageFor(set, set.headline, set.url), archive.picturePath(this.paths, opened.entry))) {
      this.updateSite(site.id, (x) => { x.reported = { ...x.reported, [n.conversationId]: n.mark }; });
    } else {
      throw new Error("no channel took the reply ideas");
    }
  }

  // People who liked the owner: kept in the archive too, because they are the ones who write
  // elsewhere "you liked me". A site that does not show them gives none; that is fine.
  async archiveLikedYou(site) {
    let ids = [];
    try { ids = await site.adapter.likedYou(); } catch { return; }
    const seen = siteState(this.state, site.id).likedYouSeen || {};
    const fresh = (ids || []).filter((id) => id && !seen[id]).slice(0, 10);
    for (const id of fresh) {
      try { await this.open(site, id, "liked-you"); } catch (e) { if (isLoggedOut(e)) throw e; this.log(`could not keep a copy of someone who liked the owner: ${e.message}`); }
      this.updateSite(site.id, (x) => { x.likedYouSeen = { ...(x.likedYouSeen || {}), [id]: this.today() }; });
    }
  }

  // ---- what the assistant asks for --------------------------------------------------------------
  async handle(req) {
    const validSite = (x) => (typeof x === "string" && this.settings.sites.includes(x) ? x : null);
    switch (req.type) {
      case "answer": return this.answer(req);
      case "send": return this.send(req);
      case "train": {
        const n = Math.max(1, Math.min(50, Number(req.count) || this.settings.practice_round));
        const only = validSite(req.site);
        if (req.site && !only) return { ok: false, text: `The site ${clean(req.site)} is not switched on.` };
        this.update((st) => { st.practiceLeft = n; st.paused = false; });
        const w = this.state.waiting;
        if (!this.state.run) this.startRun("practice round", { sites: only ? [only] : undefined });
        return { ok: true, text: w ? `A practice round of ${n} starts once you answer the open question about ${clean(w.name)}.` : `Practice round of ${n} started. The first profile comes in a moment.` };
      }
      case "review": return this.startReview(Number(req.count) || 5);
      case "exception": {
        const e = training.markException(this.paths, req.about);
        if (!e) return { ok: false, text: "I have no answer of yours about that profile. Give its id from the block or from `who`." };
        return { ok: true, text: e.was ? `Your answer about ${clean(e.name)} was already a one-off exception.` : `Your answer about ${clean(e.name)} is now a one-off exception: I no longer learn from it. What you did on the site stays as it is.` };
      }
      case "run": {
        if (this.state.run) return { ok: true, text: "A session is already running." };
        const only = validSite(req.site);
        if (req.site && !only) return { ok: false, text: `The site ${clean(req.site)} is not switched on.` };
        this.update((st) => { st.paused = false; });
        this.startRun("asked for", { sites: only ? [only] : undefined });
        const w = this.state.waiting;
        return { ok: true, text: w ? `The open question about ${clean(w.name)} comes first.` : "Session started." };
      }
      case "pause": this.update((st) => { st.paused = true; }); if (this.state.run) this.endRun("paused"); return { ok: true, text: "Paused. Nothing is liked, passed or read until you say resume." };
      case "resume": this.update((st) => { st.paused = false; }); return { ok: true, text: "Resumed." };
      case "notebook": {
        const r = await this.syncCollection({ force: true });
        if (!r) return { ok: false, text: "The collection in the notebook is switched off in the settings." };
        if (r.removed) return { ok: false, text: `The collection "${collection.TITLE}" was deleted in the notebook, so the Wingman writes nothing to it.` };
        return { ok: true, text: `"${collection.TITLE}" in the notebook: ${r.total} profiles${r.inserted || r.updated ? ` (${r.inserted} added, ${r.updated} updated just now)` : ""}.` };
      }
      case "inbox": this.update((st) => { st.lastInboxAt = 0; }); return { ok: true, text: "Checking matches and messages now." };
      case "stop-practice": {
        this.update((st) => { st.practiceLeft = 0; st.practiceStopped = true; });
        const s = this.state;
        if (s.run && siteState(s, currentSite(s.run)).mode === "practice") this.endRun("you stopped practising for now");
        return { ok: true, text: "Stopped for now. The open question stays open." };
      }
      default: return { ok: false, text: `Unknown request ${req.type}` };
    }
  }

  async answer(req) {
    const s = this.state;
    const w = s.waiting;
    if (!w) return { ok: false, text: "There is no open question right now." };
    if (req.about && req.about !== w.id) return { ok: false, text: `That answer was about someone else. The open question is about ${clean(w.name)}.` };
    const decision = String(req.decision || "").toLowerCase();
    const reason = String(req.reason || "").trim().slice(0, 500);
    const exception = req.exception === true;
    const set = this.settings;
    const name = clean(w.name);
    const wasRunning = !!s.run;

    if (w.kind === "review") {
      const theirs = decision === "agree" ? w.verdict : decision === "disagree" ? training.opposite(w.verdict) : (decision === "like" || decision === "pass") ? decision : null;
      if (!theirs) return { ok: false, text: `Say "agree" or "disagree" (and why) about ${name}.` };
      training.record(this.paths, { site: w.site, profile: { id: w.id, name: w.name }, digest: w.digest, judge: w.verdict, owner: theirs, reason, kind: "review", exception, now: this.now() });
      this.collectionDirty = true;
      this.update((st) => { st.waiting = null; });
      const more = await this.nextReview();
      return { ok: true, text: `Noted for ${name}${exception ? ", as an exception I do not learn from" : ""}.${more ? "" : " That was the last one."}` };
    }

    const site = await this.site(w.site);
    const opened = await this.reopen(site, w);

    if (w.kind === "watch") {
      let verdict = decision === "like" || decision === "pass" ? decision : null;
      let by = "you", why = reason || `you said ${decision}`, found;
      if (!verdict && (decision === "judge" || decision === "agree")) {
        const v = await runJudge({ preferences: this.preferences(), examples: training.examples(this.paths), profileDigest: this.digestOf(site, opened.profile), model: set.model, askImpl: this.deps.ask, about: this.about(site) });
        verdict = v.verdict; by = "wingman"; why = v.reason; found = v.discord;
      }
      if (!verdict) return { ok: false, text: `For ${name} say "like", "pass" or "you decide".` };
      const done = await this.act(verdict, opened, { by, reason: why, watch: w.watchName }, found);
      this.update((st) => {
        st.waiting = null;
        if (!done) st.decided = { ...(st.decided || {}), [keyOf(w.site, w.id)]: { verdict, by, reason: why } };
        st.nextActionAt = this.now().getTime() + 5000;
        this.keepGoing(st);
      });
      if (!done) return { ok: true, text: `${site.name} has no ${verdict === "like" ? "likes" : "profiles"} left today, so ${name} gets your ${verdict} first thing next session.` };
      return { ok: true, text: `${verdict === "like" ? "Liked" : "Passed on"} ${name}${by === "wingman" ? `: ${clean(why, 200)}` : ""}. Carrying on.` };
    }

    // A practice question.
    const theirs = decision === "agree" ? w.verdict : decision === "disagree" ? training.opposite(w.verdict) : (decision === "like" || decision === "pass") ? decision : null;
    if (!theirs) return { ok: false, text: `Say "agree" or "disagree" (and why) about ${name}.` };
    // A question asked without the judge's find of a Discord name: act() looks for it itself.
    const done = await this.act(theirs, opened, { by: "you", reason, judge: w.verdict }, w.discordJudged ? (w.discord ?? null) : undefined);
    // Recorded after the like or pass, so a repeated answer after an error cannot count twice.
    // An exception is kept for the record but never taught (training.examples leaves it out).
    training.record(this.paths, { site: w.site, profile: opened.profile, digest: w.digest || this.digestOf(site, opened.profile), judge: w.verdict, owner: theirs, reason, kind: "practice", exception, now: this.now() });
    let switched = false;
    this.update((st) => {
      st.waiting = null;
      if (!done) st.decided = { ...(st.decided || {}), [keyOf(w.site, w.id)]: { verdict: theirs, by: "you", reason } };
      st.practiceLeft = Math.max(0, (st.practiceLeft || 0) - 1);
      const ss = siteState(st, w.site);
      if (ss.mode === "practice" && training.readyForAuto(this.paths, set.practice_until, w.site)) {
        st.sites = { ...(st.sites || {}), [w.site]: { ...ss, mode: "auto" } };
        switched = true;
      }
      st.nextActionAt = this.now().getTime() + randomBetween([3, 10], () => this.rand()) * 1000;
      this.keepGoing(st);
    });
    const a = training.agreement(this.paths, set.practice_until.of, w.site);
    let text = `Noted: you ${theirs === "like" ? "liked" : "passed on"} ${name}${reason ? ` because ${clean(reason, 200)}` : ""}.${exception ? " A one-off exception: I do not learn from it." : ""}`;
    if (!done) {
      text += ` ${site.name} has no ${theirs === "like" ? "likes" : "profiles"} left today, so that happens first thing next session.`;
      return { ok: true, text };
    }
    // The owner is here and answering: practice goes on, unless they stopped it or it was not running.
    const st = this.state;
    if (!st.run && !st.practiceStopped && (wasRunning || this.practicing(st, w.site))) this.startRun("practice continues");
    if (switched) text += ` You agreed with me ${a.agreed} of the last ${a.of} times${this.multiSite() ? ` on ${site.name}` : ""}, so from now on I like and pass there by myself, at a person's pace. Say "practice" any time to train me again.`;
    else if (st.practiceStopped) text += " Practice is stopped for now.";
    else if (st.practiceLeft > 0 || siteState(st, w.site).mode === "practice") text += " Next one in a moment.";
    else text += " Back on autopilot.";
    return { ok: true, text };
  }

  // An answer means the owner is here: the session lasts at least three more hours from now, so a
  // late answer still brings the next profile instead of ending at the time limit.
  keepGoing(st) {
    if (!st.run) return;
    const later = new Date(this.now().getTime() + 3 * 3600000).toISOString();
    if (st.run.endsAt < later) st.run.endsAt = later;
  }

  // The profile behind an open question, from the copy kept when it was asked.
  async reopen(site, w) {
    const dir = path.join(this.paths.archive, w.dir || "__none__");
    const profile = readJson(path.join(dir, "profile.json"));
    const raw = readJson(path.join(dir, "raw.json"));
    if (profile) return { profile, raw, entry: { dir: w.dir }, site };
    return this.open(site, w.id, "reopen");
  }

  async send(req) {
    const all = readJson(this.paths.replies, {}) || {};
    const open = Object.values(all).filter((x) => !x.sent).sort((a, b) => b.created.localeCompare(a.created));
    let set = null;
    const to = String(req.to || "").trim();
    if (to) set = all[to.toUpperCase()] || open.find((x) => x.name.toLowerCase().includes(to.toLowerCase())) || Object.values(all).find((x) => x.name.toLowerCase().includes(to.toLowerCase()));
    else set = open[0];
    if (!set) return { ok: false, text: to ? `I have no reply ideas for "${clean(to)}".` : "There are no reply ideas waiting." };
    if (!to && open.length > 1) return { ok: false, text: `Reply ideas are waiting for ${open.map((x) => clean(x.name)).join(" and ")}. Which one?` };
    if (set.sent && !req.text) return { ok: false, text: `Already sent to ${clean(set.name)}: "${clean(set.sent.text, 200)}"` };
    let text = String(req.text || "").trim();
    if (!text) {
      const n = Number(req.option);
      if (!(n >= 1 && n <= set.options.length)) return { ok: false, text: `Pick 1, 2 or 3 for ${clean(set.name)}.` };
      text = set.options[n - 1];
    }
    const site = await this.site(set.site);
    // Marked as sending before the send: if the answer is lost, a repeat is refused instead of
    // sending twice; the owner can look on the site.
    all[set.id] = { ...set, sent: { at: this.now().toISOString(), text, confirmed: false } };
    writeJson(this.paths.replies, all);
    await site.adapter.send(set.conversationId, text);
    all[set.id].sent.confirmed = true;
    writeJson(this.paths.replies, all);
    appendJsonl(this.paths.decisions, { at: this.now().toISOString(), site: set.site, id: set.userId, name: set.name, action: "sent", text });
    return { ok: true, text: `Sent to ${clean(set.name)}: "${clean(text, 300)}"` };
  }

  async startReview(count) {
    if (this.state.waiting) return { ok: false, text: `Answer the open question about ${clean(this.state.waiting.name)} first.` };
    const reviewed = new Set(training.answers(this.paths).filter((e) => e.kind === "review").map((e) => keyOf(e.site, e.id)));
    const auto = readJsonl(this.paths.decisions).filter((d) => d.by === "wingman" && (d.action === "like" || d.action === "pass") && !reviewed.has(keyOf(d.site, d.id))).reverse();
    const items = [];
    for (const d of auto) { if (!items.some((x) => x.site === d.site && x.id === d.id)) items.push({ site: d.site, id: d.id }); if (items.length >= count) break; }
    if (!items.length) return { ok: false, text: "There is nothing to review yet: no profile has been liked or passed on autopilot." };
    this.update((st) => { st.reviewQueue = items; });
    await this.nextReview();
    return { ok: true, text: `Review of ${items.length} started.` };
  }

  async nextReview() {
    for (;;) {
      const item = (this.state.reviewQueue || [])[0];
      if (!item) return false;
      this.update((st) => { st.reviewQueue = st.reviewQueue.slice(1); });
      const d = readJsonl(this.paths.decisions).reverse().find((x) => x.site === item.site && x.id === item.id && (x.action === "like" || x.action === "pass"));
      const entry = readJsonl(this.paths.archiveIndex).reverse().find((e) => e.site === item.site && e.id === item.id);
      const profile = entry ? readJson(path.join(this.paths.archive, entry.dir, "profile.json")) : null;
      if (!d || !profile) continue;
      const site = await this.site(item.site).catch(() => null);
      const name = site?.name || item.site;
      const hl = site ? this.headlineFor(site, profile) : headline(profile);
      const when = wallClock(new Date(d.at), this.settings.timezone).day;
      await this.ask(
        { kind: "review", site: item.site, siteName: name, id: item.id, name: profile.name, headline: hl, url: profile.url, dir: entry.dir, verdict: d.action, reason: d.reason, digest: site ? this.digestOf(site, profile) : plainDigest(profile), askedAt: this.now().toISOString() },
        `${FROM} review. On ${when} I ${d.action === "like" ? "liked" : "passed on"} ${hl}: ${d.reason || "no reason kept"}\nAgree? Say "agree", or "disagree" and why.\nTheir profile: ${profile.url}`,
        archive.picturePath(this.paths, entry));
      return true;
    }
  }
}
