// Settings: defaults here, the person's choices in routines/wingman/settings.json. Only keys that
// exist below are read, and each is checked, so a typo cannot switch something on.
//
// The worker may run with more rights than whoever can edit this file (the assistant's account, or
// anyone who can push to mission control). So the file may choose WHICH model and lane, never a
// program to run, an address to send profiles to (the openai lane's address and key come from the
// environment), or a message destination other than a Hermes home's own .env file.
import { readJson } from "./store.mjs";

export function systemTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

// A machine with a screen (Windows, macOS, a Linux desktop session) or a server without one.
export function isDesktop({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" || platform === "darwin") return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY || /^(x11|wayland)$/i.test(env.XDG_SESSION_TYPE || ""));
}

export const LANES = ["claude", "codex", "openai"];
export const LANE_MODEL = { claude: "sonnet", codex: "", openai: "" };
export const TALK = ["desk", "desktop", "telegram"];
export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;

export function defaults({ platform = process.platform, env = process.env } = {}) {
  const desktop = isDesktop({ platform, env });
  return {
    // The browser: the Wingman's own Chrome or Edge on this machine ("local"), or a browser on
    // another machine reached through a Chrome Agent Bridge ("bridge", with its address).
    browser: desktop ? "local" : "bridge",
    bridge: "",
    // The local browser without a window. Only for machines where nobody logs in by hand again.
    browser_headless: false,
    // The dating sites the Wingman works on, one after another in the daily session.
    sites: ["flirtual"],
    // Per site, the few choices its adapter offers (see the site's site.json "options").
    site_options: {},
    // The queue to read on a site that has more than one (Flirtual: "love" for dating, "friend").
    kind: "love",
    // When the daily session starts, in the person's time zone, and how long it may take at most.
    daily_start: "18:30",
    timezone: systemTimezone(),
    max_run_hours: 6,
    // A random pause between two profiles, in seconds.
    wait_seconds: [10, 180],
    // How long a profile stays open before the like or pass, in seconds, so it reads like a person.
    read_seconds: [4, 12],
    // A site goes on autopilot once the person agreed with this many of its last practice answers.
    practice_until: { agree: 9, of: 10 },
    // A practice round the person asks for ("train") has this many profiles unless they name a number.
    practice_round: 10,
    // Every profile seen, and its picture, is kept this many days, then deleted.
    retention_days: 42,
    // The disk guard: below this many gigabytes free, the oldest kept pictures are deleted before a
    // new one is kept. 0 switches it off.
    min_free_gb: 8,
    // The collection "Wingman: likes and passes" in the Godspeed notebook, when the notebook answers.
    notebook_collection: true,
    // How often matches and messages are checked, in minutes, around the clock.
    inbox_every_minutes: 30,
    // The model that judges profiles and writes reply ideas: which lane, and the model's name there.
    model: { lane: "claude", name: LANE_MODEL.claude },
    // Where the Wingman talks to the person: the desk page, desktop notifications, Telegram.
    talk: desktop ? ["desk", "desktop"] : ["telegram"],
    // The .env file of the Hermes home whose Telegram bot the Wingman sends through. Empty: found by itself.
    telegram_env: "",
    // The desk page's port on this machine (it answers only to this machine).
    desk_port: 47860,
    // After a like, tell the person the Discord name the other person wrote in their profile.
    contact_notice: true,
    // How the person's edits of routines/wingman reach their other machines: auto (commit and
    // push), commit, or off.
    sync: "auto",
  };
}

export const DEFAULTS = defaults();

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => num(x, 0, 86400));

// A Hermes home's own .env: ~/.hermes/.env, ~/.hermes/profiles/<p>/.env, the native Windows home
// (%LOCALAPPDATA%\hermes\.env and its profiles), or Godspeed's Windows hermes-profile\.env.
export function validTelegramEnv(p) {
  if (typeof p !== "string" || !p) return false;
  const n = p.replace(/\\/g, "/");
  if (!/^(\/|[A-Za-z]:\/)/.test(n)) return false;
  const seg = n.split("/").filter(Boolean);
  if (seg.includes("..") || seg.includes(".") || seg[seg.length - 1] !== ".env") return false;
  const home = (s) => [".hermes", "hermes", "hermes-profile"].includes(String(s).toLowerCase());
  return home(seg[seg.length - 2]) || (seg[seg.length - 3] === "profiles" && home(seg[seg.length - 4]));
}

function siteOptions(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [id, opts] of Object.entries(v)) {
    if (!SITE_ID.test(id) || !isObj(opts)) continue;
    const o = {};
    for (const [k, x] of Object.entries(opts)) {
      if (!/^[a-z_][a-z0-9_]{0,31}$/.test(k)) continue;
      if (typeof x === "boolean" || num(x, -1e9, 1e9)) o[k] = x;
      else if (typeof x === "string" && x.length <= 200) o[k] = x;
    }
    out[id] = o;
  }
  return out;
}

export function loadSettings(file, { platform = process.platform, env = process.env } = {}) {
  const base = defaults({ platform, env });
  const mine = readJson(file, {}) || {};
  return normalizeSettings(isObj(mine) ? mine : {}, base);
}

export function normalizeSettings(mine, base = defaults()) {
  const out = structuredClone(base);
  for (const k of Object.keys(base)) {
    if (mine[k] === undefined || mine[k] === null) continue;
    if (isObj(base[k])) out[k] = isObj(mine[k]) ? { ...base[k], ...mine[k] } : base[k];
    else out[k] = mine[k];
  }
  out.browser = out.browser === "bridge" || out.browser === "local" ? out.browser : base.browser;
  out.bridge = typeof out.bridge === "string" && /^https?:\/\/[^\s"'<>`]+$/.test(out.bridge) ? out.bridge.replace(/\/+$/, "") : "";
  out.browser_headless = out.browser_headless === true;
  out.sites = Array.isArray(out.sites) ? [...new Set(out.sites.filter((s) => typeof s === "string" && SITE_ID.test(s)))] : base.sites;
  if (!Array.isArray(mine.sites) && mine.sites !== undefined) out.sites = base.sites;
  out.site_options = siteOptions(out.site_options);
  out.kind = out.kind === "friend" ? "friend" : "love";
  if (!pair(out.wait_seconds)) out.wait_seconds = base.wait_seconds;
  if (!pair(out.read_seconds)) out.read_seconds = base.read_seconds;
  const pu = out.practice_until;
  out.practice_until = Number.isInteger(pu.of) && Number.isInteger(pu.agree) && pu.of >= 1 && pu.of <= 50 && pu.agree >= 1 && pu.agree <= pu.of
    ? { agree: pu.agree, of: pu.of } : base.practice_until;
  out.practice_round = Number.isInteger(out.practice_round) && out.practice_round >= 1 && out.practice_round <= 50 ? out.practice_round : base.practice_round;
  out.max_run_hours = num(out.max_run_hours, 0.25, 24) ? out.max_run_hours : base.max_run_hours;
  out.inbox_every_minutes = num(out.inbox_every_minutes, 1, 1440) ? out.inbox_every_minutes : base.inbox_every_minutes;
  // The model: a lane from the list (never "command", which only the environment can choose), and a
  // name that cannot pass as a program option.
  const lane = LANES.includes(mine.model?.lane) ? mine.model.lane : LANES.includes(out.model.lane) ? out.model.lane : "claude";
  const named = typeof mine.model?.name === "string" ? mine.model.name : lane === base.model.lane ? out.model.name : LANE_MODEL[lane];
  out.model = { lane, name: typeof named === "string" && (named === "" || MODEL_NAME.test(named)) ? named : LANE_MODEL[lane] };
  out.notebook_collection = out.notebook_collection !== false;
  out.contact_notice = out.contact_notice !== false;
  if (!(Number.isFinite(Number(out.retention_days)) && Number(out.retention_days) >= 1)) out.retention_days = base.retention_days;
  else out.retention_days = Math.round(Number(out.retention_days));
  out.min_free_gb = num(out.min_free_gb, 0, Infinity) ? Math.min(1000, out.min_free_gb) : base.min_free_gb;
  const talk = Array.isArray(out.talk) ? [...new Set(out.talk.filter((t) => TALK.includes(t)))] : [];
  out.talk = talk.length ? talk : base.talk;
  if (!validTelegramEnv(out.telegram_env)) out.telegram_env = "";
  out.desk_port = Number.isInteger(out.desk_port) && out.desk_port >= 1024 && out.desk_port <= 65535 ? out.desk_port : base.desk_port;
  const m = String(out.daily_start || "").match(/^(\d{1,2}):(\d{2})$/);
  out.daily_start = m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : base.daily_start;
  try { if (typeof out.timezone !== "string") throw new Error(); new Intl.DateTimeFormat("en-GB", { timeZone: out.timezone }); } catch { out.timezone = systemTimezone(); }
  out.sync = ["auto", "commit", "off"].includes(out.sync) ? out.sync : "auto";
  return out;
}

// "HH:MM" and the day on the wall clock of a time zone, for a given instant.
export function wallClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function randomBetween([lo, hi], rand = Math.random) {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return a + rand() * (b - a);
}
