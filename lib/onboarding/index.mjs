// The setup questions, shared by the desk's wizard and the terminal's. The content (the starters
// and the choices) lives in starters/: four preferences pages with {placeholders}, and
// options.json with the questions and the plain line each choice becomes. This file only wires
// them up:
//
//   questions({ sites })        the questions, with every choice limited to sites that are not
//                               chosen left out
//   renderPreferences(id, a)    a starter with every placeholder filled from the answers a
//   settingsFrom(a)             the values for settings.json
//   apply({ mcDir, ... })       writes settings.json, preferences.md and watch.md through the
//                               setup's own steps. An existing preferences.md is never replaced
//                               unless the answers say so (mode "starter", or a text the person
//                               edited in the last look).
//   detect(...)                 what this machine offers: the sites, the model programs, Telegram,
//                               whether the assistant's chat is wired, whether the notebook answers
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaults, LANES, LANE_MODEL, TALK, SITE_ID, isDesktop, systemTimezone, loadSettings } from "../core/settings.mjs";
import { routinePaths, statePaths, loadWorkerEnv } from "../core/paths.mjs";
import { Notebook, DEFAULT_NOTEBOOK } from "../core/notebook.mjs";
import { ensureDir } from "../core/store.mjs";
import { addWatch } from "../core/watch.mjs";
import { listSites } from "../sites/index.mjs";

export const STARTERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "starters");
// The order the wizard shows them in.
export const STARTER_ORDER = ["looking-for-a-partner", "flirty-and-playful", "friends-first", "just-exploring"];
const PLACEHOLDER = /\{([a-z_]+)\}/g;

const str = (v, max = 300) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const oneLine = (v, max = 300) => str(v, max).replace(/\s*\n\s*/g, " ");

export function loadOptions(dir = STARTERS_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, "options.json"), "utf8"));
}

// "---\nid: x\ntitle: y\n---\n<body>" -> { id, title, pitch, body }
export function parseStarter(text, fallbackId = "") {
  const t = String(text).replace(/\r\n?/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) { const kv = line.match(/^([a-z_]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim(); }
  return { id: meta.id || fallbackId, title: meta.title || fallbackId, pitch: meta.pitch || "", body: m ? t.slice(m[0].length) : t };
}

export function listStarters(dir = STARTERS_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")); } catch { return []; }
  const all = names.map((n) => parseStarter(fs.readFileSync(path.join(dir, n), "utf8"), n.replace(/\.md$/, "")));
  const rank = (id) => { const i = STARTER_ORDER.indexOf(id); return i < 0 ? STARTER_ORDER.length : i; };
  return all.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

// A choice with "sites" belongs only to those sites.
export const fitsSites = (choice, sites = []) => !Array.isArray(choice?.sites) || choice.sites.some((s) => sites.includes(s));

// The questions for these sites: every choice list without the choices of sites not chosen, and
// without the "_about" notes meant for whoever edits the file.
export function questions({ sites = ["flirtual"], options = loadOptions() } = {}) {
  const out = {};
  for (const [k, q] of Object.entries(options)) {
    if (k.startsWith("_") || !q || typeof q !== "object") continue;
    const copy = structuredClone(q);
    delete copy._about;
    if (Array.isArray(copy.choices)) copy.choices = copy.choices.filter((c) => fitsSites(c, sites));
    out[k] = copy;
  }
  return out;
}

// The answers a fresh wizard starts with, from the settings the install already has.
export function startingAnswers(settings = defaults(), { options = loadOptions(), starters = listStarters() } = {}) {
  return {
    sites: [...(settings.sites || ["flirtual"])],
    me: "",
    looking_for: [], looking_for_text: "",
    age_range: [...(options.age_range?.default || [21, 45])],
    where: "", where_text: "",
    starter: starters[0]?.id || "",
    green_flags: [], green_text: [], interests: "",
    deal_breakers: [], deal_text: [],
    tone: "", sample: "",
    language: options.language?.default_line || "",
    daily_start: settings.daily_start || "18:30",
    timezone: settings.timezone || systemTimezone(),
    retention_days: settings.retention_days || 42,
    talk: [...(settings.talk || [])],
    browser: settings.browser || "local",
    bridge: settings.bridge || "",
    model: { ...(settings.model || { lane: "claude", name: LANE_MODEL.claude }) },
    // The list of likes and passes in the notebook: ticked only when the settings already say so.
    notebook_collection: settings.notebook_collection === true,
    watch: [],
  };
}

const lines = (v, max = 20) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => oneLine(x, 300)).filter(Boolean).slice(0, max);

// Answers from a page or a terminal, checked: known ids only, short texts, sensible numbers.
export function cleanAnswers(raw = {}, { options = loadOptions(), knownSites = null } = {}) {
  const base = startingAnswers(defaults(), { options });
  const a = { ...base };
  const sites = Array.isArray(raw.sites) ? raw.sites.filter((s) => typeof s === "string" && SITE_ID.test(s) && (!knownSites || knownSites.includes(s))) : base.sites;
  a.sites = [...new Set(sites)];
  const q = questions({ sites: a.sites, options });
  const ids = (key, v) => { const known = new Set((q[key]?.choices || []).map((c) => c.id)); return [...new Set((Array.isArray(v) ? v : [v]).filter((x) => known.has(x)))]; };
  a.me = oneLine(raw.me, 120);
  a.looking_for = ids("looking_for", raw.looking_for || []);
  a.looking_for_text = oneLine(raw.looking_for_text, 200);
  const ages = Array.isArray(raw.age_range) ? raw.age_range.map((n) => Math.round(Number(n))) : [];
  if (ages.length === 2 && ages.every((n) => Number.isFinite(n) && n >= 18 && n <= 120)) a.age_range = [Math.min(...ages), Math.max(...ages)];
  a.where = ids("where", raw.where || [])[0] || "";
  a.where_text = oneLine(raw.where_text, 200);
  a.starter = typeof raw.starter === "string" && /^[a-z0-9-]{1,60}$/.test(raw.starter) ? raw.starter : base.starter;
  a.green_flags = ids("green_flags", raw.green_flags || []);
  a.green_text = lines(raw.green_text);
  a.interests = oneLine(raw.interests, 200);
  a.deal_breakers = ids("deal_breakers", raw.deal_breakers || []);
  a.deal_text = lines(raw.deal_text);
  a.tone = ids("tone", raw.tone || [])[0] || "";
  a.sample = str(raw.sample, 600);
  a.language = oneLine(raw.language, 200) || base.language;
  const m = String(raw.daily_start || "").match(/^(\d{1,2}):(\d{2})$/);
  a.daily_start = m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : base.daily_start;
  try { if (typeof raw.timezone !== "string" || !raw.timezone) throw new Error(); new Intl.DateTimeFormat("en-GB", { timeZone: raw.timezone }); a.timezone = raw.timezone; } catch { a.timezone = base.timezone; }
  const keep = Math.round(Number(raw.retention_days));
  a.retention_days = Number.isFinite(keep) && keep >= 1 && keep <= 3650 ? keep : base.retention_days;
  const talk = Array.isArray(raw.talk) ? [...new Set(raw.talk.filter((t) => TALK.includes(t)))] : [];
  a.talk = talk.length ? talk : base.talk;
  a.browser = raw.browser === "bridge" ? "bridge" : "local";
  a.bridge = typeof raw.bridge === "string" && /^https?:\/\/[^\s"'<>`]+$/.test(raw.bridge.trim()) ? raw.bridge.trim().replace(/\/+$/, "") : "";
  const lane = LANES.includes(raw.model?.lane) ? raw.model.lane : base.model.lane;
  const name = typeof raw.model?.name === "string" && (raw.model.name === "" || /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(raw.model.name)) ? raw.model.name : LANE_MODEL[lane];
  a.model = { lane, name };
  a.watch = lines(raw.watch, 50).map((n) => n.replace(/^[-*]\s*/, "")).filter(Boolean);
  // Only a yes or a no is an answer; anything else leaves the setting as it is.
  if (typeof raw.notebook_collection === "boolean") a.notebook_collection = raw.notebook_collection;
  else delete a.notebook_collection;
  return a;
}

const sentence = (s) => {
  const t = s.trim();
  return /[.!?"')]$/.test(t) ? t : `${t}.`;
};
const upFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const asListItem = (s) => `- ${upFirst(sentence(s.replace(/^[-*]\s*/, "")))}`;
const joinAnd = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// The value of every placeholder a starter may hold, from the answers.
export function fills(answers, { options = loadOptions() } = {}) {
  const a = answers;
  const q = questions({ sites: a.sites, options });
  const byId = (key) => new Map((q[key]?.choices || []).map((c) => [c.id, c]));
  const lf = byId("looking_for");
  let looking = a.looking_for_text;
  if (!looking) {
    const chosen = a.looking_for.filter((id) => lf.has(id));
    looking = chosen.includes("anyone") || !chosen.length ? (lf.get("anyone")?.line || "anyone who fits") : joinAnd(chosen.map((id) => lf.get(id).line));
  }
  const where = a.where_text || byId("where").get(a.where)?.line || byId("where").get("anywhere")?.line || "anywhere";
  const flagLines = (key, own) => {
    const map = byId(key);
    const out = a[key].filter((id) => map.has(id)).map((id) => {
      const line = map.get(id).line;
      return a.interests ? line.replace("{free}", a.interests) : line.replace(/:\s*\{free\}/, "").replace("{free}", "");
    });
    return [...out, ...own.map(asListItem)].join("\n");
  };
  const tone = byId("tone").get(a.tone)?.line || "";
  return {
    me: a.me || "someone",
    looking_for: looking,
    age_range: `${a.age_range[0]} to ${a.age_range[1]}`,
    where,
    green_flags: flagLines("green_flags", a.green_text),
    deal_breakers: flagLines("deal_breakers", a.deal_text),
    tone,
    language: a.language || options.language?.default_line || "",
    sample: a.sample,
  };
}

// The starter with every placeholder filled. A list placeholder with nothing chosen leaves no
// empty line; a section left empty says so; "live in anywhere" reads "live anywhere".
export function renderPreferences(starterId, answers, { options = loadOptions(), starters = listStarters() } = {}) {
  const starter = starters.find((s) => s.id === starterId) || starters[0];
  if (!starter) throw new Error("no starters found");
  const f = fills(answers, { options });
  let body = starter.body;
  // A placeholder alone on its line, with nothing to put there, takes the line with it.
  body = body.replace(/^[ \t]*\{([a-z_]+)\}[ \t]*\n/gm, (all, k) => (f[k] ? `${f[k]}\n` : ""));
  // "{tone} {language}" with no tone chosen: no space in front.
  body = body.replace(/\{([a-z_]+)\} \{([a-z_]+)\}/g, (all, x, y) => [f[x], f[y]].filter(Boolean).join(" "));
  body = body.replace(PLACEHOLDER, (all, k) => (k in f ? f[k] : ""));
  body = body.replace(/\blive in anywhere\b/g, "live anywhere").replace(/[ \t]+$/gm, "");
  if (f.sample) {
    const quote = f.sample.replace(/\s*\n\s*/g, " ");
    body = body.replace(/^## How I write\n\n([^\n]*)\n/m, (all, first) => `## How I write\n\n${first}\nA message I sent and liked, so you know how I sound: "${quote}"\n`);
  }
  // A section with nothing under it says so, so it never looks like a mistake.
  body = body.replace(/^(## [^\n]+)\n+(?=## |$(?![\s\S]))/gm, "$1\n\n(Nothing here yet.)\n\n");
  return `${body.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function settingsFrom(a, { telegramEnv = null, now = new Date() } = {}) {
  const s = {
    sites: a.sites,
    daily_start: a.daily_start,
    timezone: a.timezone,
    talk: a.talk,
    browser: a.browser,
    model: a.model,
    retention_days: a.retention_days,
    onboarded: now.toISOString().slice(0, 10),
  };
  if (a.browser === "bridge" && a.bridge) s.bridge = a.bridge;
  if (a.talk.includes("telegram") && telegramEnv) s.telegram_env = telegramEnv;
  if (typeof a.notebook_collection === "boolean") s.notebook_collection = a.notebook_collection;
  return s;
}

// The Hermes homes on this machine (without running Hermes): HERMES_HOME, Godspeed's Windows
// Hermes, Hermes' own Windows home, ~/.hermes and its profiles.
export function hermesHomes({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const out = [];
  if (env.HERMES_HOME) out.push(env.HERMES_HOME);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    out.push(path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-profile"), path.join(local, "hermes"));
  }
  const dot = path.join(home, ".hermes");
  out.push(dot);
  try { for (const p of fs.readdirSync(path.join(dot, "profiles")).sort()) out.push(path.join(dot, "profiles", p)); } catch { /* none */ }
  return [...new Set(out)].filter((d) => fs.existsSync(d));
}

// Does the Godspeed notebook answer on this machine? At the address the worker uses: the
// environment's GODSPEED_WINGMAN_NOTEBOOK, else the one in the worker's private worker.env, else the
// notebook's own door. One small read with a short wait; a test hands in its own notebook.
export async function notebookAnswers({ env = process.env, stateDir = null, notebook = null, timeoutMs = 2000 } = {}) {
  let nb = notebook;
  if (!nb) {
    const own = {};
    if (env.GODSPEED_WINGMAN_NOTEBOOK) own.GODSPEED_WINGMAN_NOTEBOOK = env.GODSPEED_WINGMAN_NOTEBOOK;
    else if (stateDir) loadWorkerEnv(statePaths(stateDir).workerEnv, own);
    nb = new Notebook({ base: own.GODSPEED_WINGMAN_NOTEBOOK || DEFAULT_NOTEBOOK });
  }
  try { return !!(await nb.answers({ timeoutMs })); } catch { return false; }
}

// What this machine offers the wizard. Nothing here runs a model or sends a message.
export async function detect({ mcDir, stateDir = null, settings, env = process.env, platform = process.platform, home = os.homedir(), notebook = null } = {}) {
  const set = settings || (mcDir ? loadSettings(routinePaths(mcDir).settings, { platform, env }) : defaults({ platform, env }));
  const { claudeProgram, codexProgram } = await import("../core/exe.mjs");
  const { resolveEnvFile } = await import("../channels/telegram.mjs");
  const { available: desktopAvailable } = await import("../channels/desktop.mjs");
  const claude = claudeProgram({ env, platform, home });
  const codex = codexProgram({ env, platform });
  const keyEnv = /^[A-Z_][A-Z0-9_]*$/.test(env.GODSPEED_WINGMAN_OPENAI_KEY_ENV || "") ? env.GODSPEED_WINGMAN_OPENAI_KEY_ENV : "OPENAI_API_KEY";
  const lanes = [
    { lane: "claude", label: "Claude Code", found: !!claude, where: claude ? (claude.args[0] || claude.exe) : "", name: LANE_MODEL.claude },
    { lane: "codex", label: "Codex", found: !!codex, where: codex ? (codex.args[0] || codex.exe) : "", name: LANE_MODEL.codex },
    { lane: "openai", label: "An OpenAI-compatible service", found: !!env[keyEnv], where: env[keyEnv] ? `key in ${keyEnv}${env.GODSPEED_WINGMAN_OPENAI_BASE ? `, ${env.GODSPEED_WINGMAN_OPENAI_BASE}` : ""}` : `no key in ${keyEnv}`, name: "" },
  ];
  const telegramFile = resolveEnvFile(set.telegram_env, { env, platform, home });
  const homes = hermesHomes({ env, platform, home });
  const hermesWired = homes.some((h) => fs.existsSync(path.join(h, "plugins", "godspeed-wingman")));
  let claudeWired = false;
  try { claudeWired = !!mcDir && fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8").includes("godspeed-wingman"); } catch { /* none */ }
  const sites = listSites({ mcDir }).filter((s) => !s.shadowed).map((s) => ({
    id: s.id, name: s.name, builtin: s.builtin, kind: s.kind, ok: s.ok,
    why: s.refused || (s.problems.length ? s.problems.join("; ") : ""),
    login_url: s.meta?.login_url || s.meta?.home || "", about: s.meta?.about || "",
  }));
  return {
    desktop: isDesktop({ platform, env }),
    platform,
    sites,
    lanes,
    telegram: { found: !!telegramFile, file: telegramFile || "" },
    assistant: { hermes: hermesWired, claude: claudeWired },
    notifications: desktopAvailable({ platform, env }),
    timezone: systemTimezone(),
    notebook: { found: await notebookAnswers({ env, stateDir, notebook }) },
  };
}

// Writes what the answers say. `mode` matters only when preferences.md exists: "keep" (the
// default) leaves it as it is unless `text` differs from it (the person edited it in the last
// look); "starter" replaces it with `text` or the starter. The old text is kept in the private
// folder first. Returns what happened, in plain words.
export async function apply({ mcDir, stateDir, answers, mode = "keep", text = null, sys = {}, quiet = true, now = new Date(), telegramEnv } = {}) {
  const { plan, stepRoutine } = await import("../setup/index.mjs");
  const p = plan({ godspeed: mcDir, state: stateDir }, sys);
  const a = cleanAnswers(answers, { knownSites: listSites({ mcDir }).map((s) => s.id) });
  const rp = routinePaths(mcDir);
  const exists = fs.existsSync(rp.preferences);
  const before = exists ? fs.readFileSync(rp.preferences, "utf8") : null;
  const wanted = typeof text === "string" && text.trim() ? `${text.replace(/\r\n?/g, "\n").trim()}\n` : null;
  const fresh = wanted || renderPreferences(a.starter, a);
  let tg = telegramEnv;
  if (tg === undefined && a.talk.includes("telegram")) {
    const { resolveEnvFile } = await import("../channels/telegram.mjs");
    tg = resolveEnvFile("", { env: sys.env || process.env, platform: sys.platform || process.platform, home: sys.home || os.homedir() });
  }
  const log = console.log;
  if (quiet) console.log = () => {};
  let written;
  try { written = stepRoutine(p, settingsFrom(a, { telegramEnv: tg, now }), { preferences: fresh }); }
  finally { console.log = log; }
  const result = { settings: rp.settings, preferences: rp.preferences, watch: rp.watch, written, backup: null, prefs: exists ? "kept" : "written", watchAdded: [] };
  if (exists) {
    const replace = mode === "starter" || (wanted !== null && wanted.trim() !== before.trim());
    if (replace && fresh.trim() !== before.trim()) {
      const desk = statePaths(p.stateDir).desk;
      ensureDir(desk);
      const backup = path.join(desk, `preferences-before-${now.toISOString().replace(/[:.]/g, "-")}.md`);
      fs.writeFileSync(backup, before);
      fs.writeFileSync(rp.preferences, fresh);
      result.backup = backup;
      result.prefs = "replaced";
      written.push(rp.preferences);
    }
  }
  for (const name of a.watch) if (addWatch(rp.watch, name)) result.watchAdded.push(name);
  if (result.watchAdded.length && !written.includes(rp.watch)) written.push(rp.watch);
  return result;
}

// The welcome the worker sends once, on Telegram (or wherever the person chose), after the
// terminal wizard.
export const WELCOME = `From your Wingman: hello, I am set up. Before I pick on my own, we practise: I show you a profile, say what I would do and why, and you answer. Say "practice" to start your first round of 10.
Two answers that teach me well:
"agree"
"disagree, they only want friends"`;
