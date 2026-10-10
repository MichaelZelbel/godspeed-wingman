// Adds the Wingman to a Godspeed Mission Control install, and takes it out again. Every step is a
// function of its own, safe to run again, says one line, and never overwrites what the person made
// (their settings and preferences, or a recipe they wrote under the same name). The onboarding
// wizard calls the same steps with the person's answers.
//
//   plan(flags)            where everything goes, and how the worker will run
//   stepProgram(p)         the program copy and the godspeed-wingman command (sh, and .cmd on Windows)
//   stepState(p)           the private folder for everything about other people
//   stepRoutine(p, s)      the person's files in mission control: settings.json, preferences.md, watch.md
//   stepRecipe(p)          the recipe skills/wingman the assistant follows
//   stepHermes(p)          the Hermes plugin (the open question before every turn)
//   stepClaude(p)          the Claude Code hook (the same, when mission control uses Claude Code)
//   stepWorkerEnv(p)       private worker settings (notebook address, screenshots address)
//   stepService(p)         the worker, at login on a desktop, as a service on a server
//   stepCommit(p, files)   the person's new files saved in mission control's history
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findMissionControl, defaultStateDir, appDir, binDir, routinePaths, statePaths, isRoot, NAME } from "../core/paths.mjs";
import { defaults, isDesktop, normalizeSettings, TALK, SITE_ID, validTelegramEnv } from "../core/settings.mjs";
import { readJson } from "../core/store.mjs";
import { WATCH_TEMPLATE } from "../core/watch.mjs";
import { listSites } from "../sites/index.mjs";
import * as svc from "./service.mjs";
import * as hermesSetup from "./hermes.mjs";
import * as claude from "./claude.mjs";

export const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
export const MARKER = `.installed-by-${NAME}`;
export const RECIPES = ["wingman", "wingman-add-site"];

const out = { say: (s) => console.log(`\n${s}`), ok: (s) => console.log(`  ok   ${s}`), note: (s) => console.log(`  NOTE ${s}`) };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"], ...opts });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
};

export const PREFERENCES_TEMPLATE = `# Who I am looking for

Write in your own words who you want to meet. The Wingman reads this before every like or pass,
together with your answers from the practice rounds. Plain sentences work best.

## Who fits

## Who does not fit

## How to judge

## How I write

(How your messages sound. Used only for reply ideas, never for picking.)
`;

// The account that owns a folder, on Linux: { user, group, uid, gid, home }, or null.
export function ownerOf(dir) {
  let st;
  try { st = fs.statSync(dir); } catch { return null; }
  if (typeof st.uid !== "number") return null;
  const pw = run("getent", ["passwd", String(st.uid)]).stdout.trim().split(":");
  const gr = run("getent", ["group", String(st.gid)]).stdout.trim().split(":");
  if (!pw[0]) return null;
  return { user: pw[0], group: gr[0] || pw[0], uid: st.uid, gid: st.gid, home: pw[5] || `/home/${pw[0]}` };
}

const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

// Where everything goes. Throws with plain words when there is no mission control.
export function plan(flags = {}, { env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  const mcDir = findMissionControl({ arg: flags.godspeed, env, userHome: home });
  if (!mcDir) throw new Error("No Godspeed Mission Control folder found. Run this inside it, or add --godspeed <folder>.");
  const stateDir = path.resolve(flags.state || defaultStateDir({ env, platform, root, home }));
  const app = path.resolve(flags.app || appDir({ env, platform, root, home }));
  const bin = binDir({ platform, root, home });
  const desktop = isDesktop({ platform, env });
  const service = flags["no-service"] ? "none" : platform === "win32" ? "windows-task" : platform === "darwin" ? "launch-agent" : root ? "systemd-system" : "systemd-user";
  const runAs = platform === "linux" && root ? (() => { const o = ownerOf(mcDir); return o && o.uid !== 0 ? o : null; })() : null;
  const script = path.join(app, "bin", `${NAME}.mjs`);
  return {
    flags, env, platform, root, home, desktop, service, runAs,
    mcDir, stateDir, appDir: app, binDir: bin, script, node: process.execPath, version: VERSION,
    path: env.PATH || env.Path || "/usr/local/bin:/usr/bin:/bin",
    routine: routinePaths(mcDir), paths: statePaths(stateDir),
  };
}

function copyDir(src, dst, skip = () => false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}

function chownTree(p, o) {
  if (!o || typeof process.getuid !== "function" || process.getuid() !== 0) return;
  try { fs.chownSync(p, o.uid, o.gid); } catch { return; }
  try { if (fs.statSync(p).isDirectory()) for (const n of fs.readdirSync(p)) chownTree(path.join(p, n), o); } catch { /* gone */ }
}

// The launchers: the command line every launcher runs, without the verb.
export function launcherArgv(p) { return [p.node, p.script, "--godspeed", p.mcDir, "--state", p.stateDir]; }
export function launchers(p) {
  const sh = `#!/bin/sh\n# Written by godspeed-wingman setup.\nexec "${p.node.replace(/\\/g, "/")}" "${p.script.replace(/\\/g, "/")}" --godspeed "${p.mcDir.replace(/\\/g, "/")}" --state "${p.stateDir.replace(/\\/g, "/")}" "$@"\n`;
  const files = [{ file: path.join(p.binDir, NAME), body: sh, mode: 0o755 }];
  if (p.platform === "win32") files.push({ file: path.join(p.binDir, `${NAME}.cmd`), body: `@echo off\r\n"${p.node}" "${p.script}" --godspeed "${p.mcDir}" --state "${p.stateDir}" %*\r\n`, mode: 0o644 });
  return files;
}

export function stepProgram(p) {
  out.say("The program and the godspeed-wingman command");
  if (path.resolve(PKG) !== path.resolve(p.appDir)) {
    fs.rmSync(p.appDir, { recursive: true, force: true });
    copyDir(PKG, p.appDir, (n) => [".git", "node_modules", "test", ".github"].includes(n) || /^internal-notes/.test(n));
  }
  fs.mkdirSync(p.binDir, { recursive: true });
  for (const l of launchers(p)) { fs.rmSync(l.file, { force: true }); fs.writeFileSync(l.file, l.body, { mode: l.mode }); }
  out.ok(`${path.join(p.binDir, NAME)}${p.platform === "win32" ? " (and .cmd)" : ""}, version ${VERSION}`);
  const onPath = String(p.path).split(p.platform === "win32" ? ";" : ":").some((d) => d && path.resolve(d).toLowerCase() === path.resolve(p.binDir).toLowerCase());
  if (!onPath) out.note(`${p.binDir} is not on this terminal's PATH. Open a new terminal; if godspeed-wingman is still unknown, add that folder to PATH.`);
  return launchers(p).map((l) => l.file);
}

export function stepState(p) {
  out.say("The private folder for everything about other people");
  fs.mkdirSync(p.stateDir, { recursive: true });
  if (p.runAs) { chownTree(p.stateDir, p.runAs); try { fs.chmodSync(p.stateDir, 0o2770); } catch { /* best effort */ } out.ok(`${p.stateDir} (belongs to ${p.runAs.user}, never in git)`); }
  else { try { fs.chmodSync(p.stateDir, 0o700); } catch { /* Windows */ } out.ok(`${p.stateDir} (never in git)`); }
}

// The settings this install starts with, from the flags and what was found. `found.telegramEnv`
// is the Hermes .env that has a Telegram bot.
export function initialSettings(p, found = {}) {
  const f = p.flags;
  const base = defaults({ platform: p.platform, env: p.env });
  const s = {};
  s.sites = f.site ? list(f.site).filter((x) => SITE_ID.test(x)) : base.sites;
  s.browser = f.browser === "bridge" || f.browser === "local" ? f.browser : (f.bridge ? "bridge" : base.browser);
  if (f.bridge) s.bridge = f.bridge;
  const talk = list(f.talk).filter((t) => TALK.includes(t));
  s.talk = talk.length ? talk : p.desktop ? ["desk", "desktop"] : found.telegramEnv ? ["telegram"] : ["desk"];
  const tg = f["telegram-env"] || found.telegramEnv;
  if (tg && validTelegramEnv(tg) && s.talk.includes("telegram")) s.telegram_env = tg;
  s.timezone = f.timezone || base.timezone;
  s.daily_start = f["daily-start"] || base.daily_start;
  s.retention_days = base.retention_days;
  s.desk_port = base.desk_port;
  return s;
}

// What the person passed explicitly on a later run: only those keys change in an existing file.
export function explicitSettings(p, found = {}) {
  const f = p.flags;
  const s = {};
  if (f.site) s.sites = list(f.site).filter((x) => SITE_ID.test(x));
  if (f.browser === "bridge" || f.browser === "local") s.browser = f.browser;
  if (f.bridge) { s.bridge = f.bridge; if (!f.browser) s.browser = "bridge"; }
  if (f.talk) s.talk = list(f.talk).filter((t) => TALK.includes(t));
  if (f["telegram-env"]) s.telegram_env = f["telegram-env"];
  else if (s.talk?.includes("telegram") && found.telegramEnv) s.telegram_env = found.telegramEnv;
  if (f.timezone) s.timezone = f.timezone;
  if (f["daily-start"]) s.daily_start = f["daily-start"];
  return s;
}

// The sites asked for, each checked: refused ones (their terms) are named and left out.
export function checkSites(p, ids) {
  const known = listSites({ mcDir: p.mcDir });
  const good = [], bad = [];
  for (const id of ids) {
    const k = known.find((x) => x.id === id && !x.shadowed);
    if (!k) bad.push(`${id}: the Wingman knows no such site`);
    else if (k.refused) bad.push(k.refused);
    else if (k.problems.length) bad.push(`${k.name}: ${k.problems.join("; ")}`);
    else good.push(id);
  }
  return { good, bad };
}

export function stepRoutine(p, wanted = {}, { preferences = PREFERENCES_TEMPLATE } = {}) {
  out.say("Your files in mission control");
  const rp = p.routine;
  fs.mkdirSync(rp.dir, { recursive: true });
  const written = [];
  const before = readJson(rp.settings, null);
  if (wanted.sites) {
    const { good, bad } = checkSites(p, wanted.sites);
    for (const b of bad) out.note(b);
    wanted = { ...wanted, sites: good };
  }
  // Each value given is checked the way the worker reads it, and written as the worker will read it.
  const norm = normalizeSettings({ ...(before || {}), ...wanted }, defaults({ platform: p.platform, env: p.env }));
  const changed = Object.keys(wanted).filter((k) => JSON.stringify(norm[k]) !== JSON.stringify(wanted[k]));
  if (changed.length) out.note(`taken as the Wingman reads them: ${changed.map((k) => `${k} = ${JSON.stringify(norm[k])}`).join(", ")}`);
  if (!before || Object.keys(wanted).length) {
    const keep = { ...(before || {}), ...Object.fromEntries(Object.keys(wanted).map((k) => [k, norm[k]])) };
    fs.writeFileSync(rp.settings, JSON.stringify(keep, null, 2) + "\n");
    out.ok(`${before ? "updated" : "written"}: ${rp.settings}`);
    written.push(rp.settings);
  } else out.ok(`kept: ${rp.settings}`);
  if (!fs.existsSync(rp.preferences)) { fs.writeFileSync(rp.preferences, preferences); out.ok(`written: ${rp.preferences}`); written.push(rp.preferences); } else out.ok(`kept: ${rp.preferences}`);
  if (!fs.existsSync(rp.watch)) { fs.writeFileSync(rp.watch, WATCH_TEMPLATE); out.ok(`written: ${rp.watch}`); written.push(rp.watch); } else out.ok(`kept: ${rp.watch}`);
  if (p.runAs) chownTree(rp.dir, p.runAs);
  return written;
}

// May this folder be replaced? Only when it is not there or the Wingman put it there.
export const mayReplace = (dir) => !fs.existsSync(dir) || fs.existsSync(path.join(dir, MARKER));

export function stepRecipe(p) {
  out.say("The recipes your assistant follows");
  const written = [];
  for (const name of RECIPES) {
    const src = path.join(PKG, "skill", name);
    if (!fs.existsSync(path.join(src, "SKILL.md"))) continue;
    const dst = path.join(p.mcDir, "skills", name);
    if (!mayReplace(dst)) { out.note(`left alone: ${dst} holds a recipe you wrote with the same name`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    copyDir(src, dst);
    fs.writeFileSync(path.join(dst, MARKER), `${NAME} ${VERSION}\n`);
    if (p.runAs) chownTree(dst, p.runAs);
    out.ok(dst);
    written.push(dst);
  }
  return written;
}

export function stepHermes(p, h = hermesSetup.locate(p.flags, { env: p.env, platform: p.platform, home: p.home, runAs: p.runAs })) {
  if (p.flags["no-hermes"]) return { skipped: true, h };
  out.say("Hermes: the open question before every turn");
  if (!h.home) { out.note("Hermes was not found on this machine; the assistant gets no plugin here (add --hermes-home <folder> if it lives elsewhere)"); return { skipped: true, h }; }
  const r = hermesSetup.installPlugin(h, { pkgDir: p.appDir, argv: launcherArgv(p), launcher: path.join(p.binDir, p.platform === "win32" ? `${NAME}.cmd` : NAME) });
  if (p.runAs && r.dir) chownTree(r.dir, p.runAs);
  (r.enabled ? out.ok : out.note)(r.text);
  if (!r.wasThere && r.enabled) {
    if (p.flags.yes) {
      if (hermesSetup.restartGateway(h)) out.ok("Hermes gateway restarted, the plugin is loaded");
      else out.note("could not restart the Hermes gateway from here; restart it once (or the machine) so the plugin loads");
    } else out.note("restart the Hermes gateway once (hermes gateway restart) so the plugin loads");
  }
  return { h, ...r };
}

export function stepClaude(p) {
  if (p.flags["no-claude"]) return [];
  const r = claude.installHook(p.mcDir, path.join(p.binDir, NAME));
  if (r.skipped) return [];
  out.say("Claude Code: the open question before every prompt");
  (r.ok ? out.ok : out.note)(r.text);
  return r.file ? [r.file] : [];
}

// Private worker settings in <state>/worker.env: the notebook's address and the address of the
// screenshots, from --notebook and --screenshots-url. Lines already there stay.
export function stepWorkerEnv(p) {
  const f = p.flags;
  const want = {};
  if (f.notebook && /^https?:\/\/[^\s"'`]+$/.test(f.notebook)) want.GODSPEED_WINGMAN_NOTEBOOK = f.notebook;
  if (f["screenshots-url"] && /^https:\/\/[^\s"'`]+$/.test(f["screenshots-url"])) want.GODSPEED_WINGMAN_SCREENSHOTS_URL = f["screenshots-url"];
  if (!Object.keys(want).length) return;
  let text = "";
  try { text = fs.readFileSync(p.paths.workerEnv, "utf8"); } catch { text = "# Private settings for the Wingman's worker only (KEY=value). Never in git.\n"; }
  for (const [k, v] of Object.entries(want)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\s*$/, "\n")}${k}=${v}\n`;
  }
  fs.writeFileSync(p.paths.workerEnv, text, { mode: 0o600 });
  if (p.runAs) chownTree(p.paths.workerEnv, p.runAs);
  out.ok(`worker settings: ${Object.keys(want).join(", ")}`);
}

export function stepService(p) {
  out.say("The worker");
  if (p.runAs && /^\/root(\/|$)/.test(p.node)) out.note(`the worker runs as ${p.runAs.user}, but this Node lives in /root, where ${p.runAs.user} cannot reach it; run setup with a Node installed for everyone (or the one in ${p.runAs.user}'s home)`);
  const r = svc.installService(p);
  (r.ok ? out.ok : out.note)(r.text);
  return r;
}

export function stepCommit(p, files) {
  if (!files.length || !fs.existsSync(path.join(p.mcDir, ".git"))) return;
  const rel = files.map((f) => path.relative(p.mcDir, f)).filter((f) => f && !f.startsWith(".."));
  if (!rel.length) return;
  const git = (args) => run("git", ["-C", p.mcDir, ...args]);
  git(["add", "--", ...rel]);
  if (git(["diff", "--cached", "--quiet", "--", ...rel]).status !== 1) return;
  const c = git(["commit", "-m", `Add the Wingman (${NAME} ${VERSION})`, "--", ...rel]);
  if (c.status === 0) out.ok("saved in mission control's history");
  else out.note(`not saved in mission control's history: ${(c.stderr || c.stdout).trim().split("\n")[0] || "git refused the commit"}. Everything is installed; your assistant commits it with its next change.`);
}

// The whole setup, without questions. Returns an exit code. `sys` ({ env, platform, root, home })
// stands in for this machine in the tests.
export async function setup(flags = {}, sys = {}) {
  let p;
  try { p = plan(flags, sys); } catch (e) { console.error(e.message); return 1; }
  console.log(`${NAME} ${VERSION} into ${p.mcDir}`);
  stepProgram(p);
  stepState(p);
  const h = flags["no-hermes"] ? null : hermesSetup.locate(flags, { env: p.env, platform: p.platform, home: p.home, runAs: p.runAs });
  const found = { telegramEnv: h?.envFile && hermesSetup.hasTelegram(h.envFile) ? h.envFile : null };
  const existed = fs.existsSync(p.routine.settings);
  const routine = stepRoutine(p, existed ? explicitSettings(p, found) : initialSettings(p, found));
  const recipes = stepRecipe(p);
  if (h) stepHermes(p, h);
  const hooks = stepClaude(p);
  stepWorkerEnv(p);
  if (p.service !== "none") stepService(p);
  else out.note("no service (--no-service): start the worker with `godspeed-wingman worker`");
  stepCommit(p, [...routine, ...recipes, ...hooks]);
  const s = readJson(p.routine.settings, {}) || {};
  out.say(s.browser === "bridge"
    ? `Done. Next: log into your dating site once in the browser behind the bridge, then run \`${NAME} check\`.`
    : `Done. Next: run \`${NAME} check\`; it opens the Wingman's own browser, where you log into your dating site once.`);
  return 0;
}

async function confirm(question, { yes = false } = {}) {
  if (yes || !process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} `)).trim();
  rl.close();
  return /^y(es)?$/i.test(a);
}

// Takes the Wingman out: the task or service, the command, the plugin, the hook, the recipes (only
// the ones it put there) and the program copy. The person's files in mission control stay. The
// private folder goes only with --delete-state or a "yes" to the question.
export async function uninstall(flags = {}, sys = {}) {
  let p;
  try { p = plan(flags, sys); } catch (e) { console.error(e.message); return 1; }
  console.log(`Taking ${NAME} out of ${p.mcDir}`);
  out.say("The worker");
  out.ok(svc.removeService(p).text);
  out.say("The command and the program");
  for (const l of launchers(p)) if (fs.existsSync(l.file) && fs.readFileSync(l.file, "utf8").includes(NAME)) { fs.rmSync(l.file, { force: true }); out.ok(`removed ${l.file}`); }
  if (path.resolve(PKG) !== path.resolve(p.appDir) && fs.existsSync(p.appDir)) { fs.rmSync(p.appDir, { recursive: true, force: true }); out.ok(`removed ${p.appDir}`); }
  if (!flags["no-hermes"]) {
    out.say("Hermes");
    out.ok(hermesSetup.removePlugin(hermesSetup.locate(flags, { env: p.env, platform: p.platform, home: p.home, runAs: p.runAs })).text);
  }
  out.say("Claude Code and the recipes");
  const changed = [];
  const hook = claude.removeHook(p.mcDir);
  out.ok(hook.text);
  if (hook.file) changed.push(hook.file);
  for (const name of RECIPES) {
    const dst = path.join(p.mcDir, "skills", name);
    if (!fs.existsSync(dst)) continue;
    if (!fs.existsSync(path.join(dst, MARKER))) { out.note(`left alone: ${dst} was not put there by the Wingman`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    out.ok(`removed ${dst}`);
    changed.push(dst);
  }
  out.ok(`kept: your files in ${p.routine.dir}`);
  out.say("The private folder");
  if (fs.existsSync(p.stateDir)) {
    const del = flags["delete-state"] || await confirm(`Delete ${p.stateDir} with every profile, picture and answer the Wingman kept? This cannot be undone. [y/N]`, { yes: flags.yes });
    if (del) { fs.rmSync(p.stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); out.ok(`deleted ${p.stateDir}`); }
    else out.ok(`kept: ${p.stateDir} (delete it yourself, or run uninstall again with --delete-state)`);
  }
  if (changed.length && fs.existsSync(path.join(p.mcDir, ".git"))) {
    const rel = changed.map((f) => path.relative(p.mcDir, f));
    run("git", ["-C", p.mcDir, "add", "-A", "--", ...rel]);
    run("git", ["-C", p.mcDir, "commit", "-m", `Take the Wingman out (${NAME} ${VERSION})`, "--", ...rel]);
  }
  out.say("Done.");
  return 0;
}
