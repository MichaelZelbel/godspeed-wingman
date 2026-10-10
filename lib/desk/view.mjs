// What the desk page shows, read from the same files the worker and the commands use: the
// settings, the worker's state, the practice answers, the reply ideas, the archive. Read only.
import fs from "node:fs";
import path from "node:path";
import { readJson, readJsonl } from "../core/store.mjs";
import { readState, siteState } from "../core/state.mjs";
import { wallClock } from "../core/settings.mjs";
import { agreement, examples } from "../core/training.mjs";
import * as archive from "../core/archive.mjs";
import { listSites } from "../sites/index.mjs";
import { loadOptions } from "../onboarding/index.mjs";
import { recent } from "../channels/desk.mjs";

export const ALIVE_MS = 120000;

export function heartbeat(paths) { return readJson(paths.heartbeat, null); }
export function workerAlive(paths, now = Date.now()) {
  const hb = heartbeat(paths);
  return !!hb && now - new Date(hb.at).getTime() < ALIVE_MS;
}

// When the next daily session starts, in the person's own words.
export function nextSession(s, set, now = new Date()) {
  const w = wallClock(now, set.timezone);
  const at = set.daily_start;
  if (set.onboarded === false) return { text: `after the setup, then every day at ${at}`, when: "setup", at };
  if (s.paused) return { text: "paused until you resume", when: "paused", at };
  if (s.run) return { text: "running now", when: "now", at };
  if (s.lastRunDay === w.day) return { text: `tomorrow at ${at}`, when: "tomorrow", at };
  if (w.time < at) return { text: `today at ${at}`, when: "today", at };
  return { text: s.waiting ? "as soon as the open question is answered" : "in a moment", when: "due", at };
}

// The practice answers on one site, oldest first: true for agreed, false for not.
export function history(paths, site, of = 10) {
  return examples(paths).filter((e) => e.kind === "practice" && e.agreed !== null && e.site === site).slice(-of).map((e) => !!e.agreed);
}

const inside = (root, p) => { const r = path.resolve(root), f = path.resolve(p); return f === r || f.startsWith(r + path.sep); };
export const DIR_REF = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// The picture of a kept profile: the picture of its page, else their own first picture.
function keptPicture(paths, dir) {
  const named = archive.picturePath(paths, { dir });
  if (named) return named;
  try {
    const own = fs.readdirSync(path.join(paths.archive, dir)).filter((f) => /^avatar-\d+\.(png|jpe?g|webp)$/i.test(f)).sort()[0];
    return own ? path.join(paths.archive, dir, own) : null;
  } catch { return null; }
}

// The picture behind a reference the page holds: "waiting", "reply:R3" or "dir:<day>/<folder>".
// Only files inside the private folder are ever served.
export function pictureFor(paths, ref) {
  let file = null;
  const r = String(ref || "");
  if (r === "waiting") {
    const w = readState(paths.state).waiting;
    if (w?.picture && fs.existsSync(w.picture)) file = w.picture;
    else if (w?.dir && DIR_REF.test(w.dir)) file = keptPicture(paths, w.dir);
  } else if (r.startsWith("reply:")) {
    const set = (readJson(paths.replies, {}) || {})[r.slice(6)];
    if (set) {
      const e = readJsonl(paths.archiveIndex).reverse().find((x) => x.site === set.site && x.id === set.userId);
      if (e && DIR_REF.test(e.dir)) file = keptPicture(paths, e.dir);
    }
  } else if (r.startsWith("dir:") && DIR_REF.test(r.slice(4))) {
    file = keptPicture(paths, r.slice(4));
  }
  if (!file || !inside(paths.root, file) || !/\.(png|jpe?g|webp)$/i.test(file)) return null;
  return fs.existsSync(file) ? file : null;
}

function logTail(file, n = 40) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    const len = Math.min(st.size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-n);
  } catch { return []; }
}

let tips = null;
function practiceTips() {
  if (!tips) { try { tips = loadOptions().practice_examples || null; } catch { tips = null; } }
  return tips;
}

export function view({ mcDir, paths, settings: set, now = new Date() }) {
  const s = readState(paths.state);
  const known = listSites({ mcDir });
  const nameOf = (id) => known.find((k) => k.id === id)?.name || id;
  const rule = set.practice_until;
  const sites = set.sites.map((id) => {
    const k = known.find((x) => x.id === id && !x.shadowed);
    const ss = siteState(s, id);
    const a = agreement(paths, rule.of, id);
    return {
      id, name: nameOf(id), kind: k?.kind || null, mode: ss.mode === "auto" ? "auto" : "practice",
      agreed: a.agreed, of: a.of, history: history(paths, id, rule.of),
      loggedOutAt: ss.loggedOutAt || null, everLoggedIn: !!ss.me,
      loginUrl: k?.meta?.login_url || k?.meta?.home || "", problem: k ? (k.refused || (k.problems.length ? k.problems.join("; ") : "")) : "the Wingman knows no such site",
    };
  });
  const w = s.waiting;
  const waiting = w ? {
    kind: w.kind, id: w.id, site: w.site, siteName: w.siteName || nameOf(w.site), name: w.name, headline: w.headline || w.name,
    verdict: w.verdict || null, sure: w.sure || null, reason: w.reason || "", url: w.url || "", askedAt: w.askedAt || null,
    watchName: w.watchName || null, field: w.field || null, picture: !!pictureFor(paths, "waiting"),
  } : null;
  const day = 86400000;
  const replies = Object.values(readJson(paths.replies, {}) || {})
    .filter((x) => !x.sent && now.getTime() - new Date(x.created).getTime() < set.retention_days * day)
    .sort((a, b) => b.created.localeCompare(a.created))
    .map((x) => ({ id: x.id, site: x.site, siteName: x.siteName || nameOf(x.site), name: x.name, headline: x.headline || x.name, kind: x.kind, theirMessage: x.theirMessage || "", options: x.options || [], created: x.created, url: x.url || "", picture: !!pictureFor(paths, `reply:${x.id}`) }));
  const hb = heartbeat(paths);
  return {
    now: now.toISOString(),
    onboarded: set.onboarded !== false,
    worker: { alive: workerAlive(paths, now.getTime()), seenAt: hb?.at || null },
    paused: !!s.paused,
    run: s.run ? { startedAt: s.run.startedAt, why: s.run.why, liked: s.run.liked, passed: s.run.passed, asked: s.run.asked, site: s.run.sites?.[s.run.at || 0] || null } : null,
    lastRun: s.lastRun ? { startedAt: s.lastRun.startedAt, endedAt: s.lastRun.endedAt, liked: s.lastRun.liked, passed: s.lastRun.passed, asked: s.lastRun.asked, why: s.lastRun.why } : null,
    next: nextSession(s, set, now),
    practiceLeft: s.practiceLeft || 0,
    practiceStopped: !!s.practiceStopped,
    rule,
    sites,
    waiting,
    replies,
    lastError: s.lastError || null,
    settings: { talk: set.talk, daily_start: set.daily_start, timezone: set.timezone, retention_days: set.retention_days, browser: set.browser, model: set.model, practice_round: set.practice_round, desk_port: set.desk_port },
    tips: practiceTips(),
  };
}

export function messages(paths, n = 30) {
  return recent(paths, n).map((m) => ({ id: m.id, at: m.at, text: String(m.text || "") }));
}

export function log(paths, n = 40) { return logTail(paths.log, n); }

export function who(paths, mcDir, q) {
  const names = Object.fromEntries(listSites({ mcDir }).map((s) => [s.id, s.name]));
  return archive.search(paths, q, { limit: 12 }).map((h) => ({
    name: h.name, site: h.site, siteName: names[h.site] || h.site, day: h.day, source: h.source || "queue",
    outcome: h.outcome ? { action: h.outcome.action, by: h.outcome.by || null, reason: h.outcome.reason || "" } : null,
    url: h.url || "", ref: DIR_REF.test(h.dir || "") ? `dir:${h.dir}` : null, picture: !!(DIR_REF.test(h.dir || "") && pictureFor(paths, `dir:${h.dir}`)),
    other: Object.entries(h.handles || {}).filter(([, v]) => String(v).toLowerCase() !== String(h.name || "").toLowerCase()).slice(0, 2).map(([k, v]) => `${k} ${v}`),
    discord: h.discord || h.outcome?.discordFound || null,
  }));
}
