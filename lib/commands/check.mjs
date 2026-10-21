// Is everything connected? One line per part, with what to do when it fails. Exit 1 when
// something essential fails. A disk warning or a terms reminder never counts as a failure.
import fs from "node:fs";
import os from "node:os";
import { workerAlive, stateOf, diskLines } from "./_common.mjs";
import { listSites, loadSite, choiceLine } from "../sites/index.mjs";
import { claudeProgram, codexProgram } from "../core/exe.mjs";
import { laneOf, describeGodspeed } from "../core/model.mjs";
import { godspeedModelProgram } from "../core/godspeed-model.mjs";
import { isRoot } from "../core/paths.mjs";
import { isLoggedOut } from "../sites/errors.mjs";

export const meta = { name: "check", summary: "is everything connected?", usage: "check", flags: {} };

// The oldest Chrome Agent Bridge the Wingman can rely on. Before 0.6.0 a gateway whose tab crashed
// kept handing out that dead tab: every page answered "Page crashed" while /health said ok, for as
// long as the gateway ran (2026-10-15: a whole day of five errors in a row, nothing liked or
// passed, nobody told). A gateway runs the code it started with, so an update needs a restart of
// every bridge instance on that computer.
export const BRIDGE_MIN = "0.6.0";
const RESTART = "restart every bridge instance on that computer, because each one runs the code it started with";

// The first line of an error, short enough for one line of the check (a bridge error carries the
// browser's whole call log after the first line).
export function firstLine(e) {
  const text = String(e?.message || e || "unknown error").split("\n")[0].trim();
  return `${text}${e?.cause?.code ? ` (${e.cause.code})` : ""}`.slice(0, 200);
}

// "0.6.0" -> [0, 6, 0]; null when it is not a version.
function parts(v) {
  const m = String(v || "").trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
export function olderThan(v, min) {
  const a = parts(v), b = parts(min);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// Is the bridge new enough? Its version comes from GET /capabilities. No answer there means a
// bridge older than 0.6.0 (404) or one that could not say; both FAIL, because an old bridge can
// leave the Wingman stuck on a crashed tab.
export async function bridgeVersionLine(driver) {
  const fix = `bridges before ${BRIDGE_MIN} keep a crashed tab forever, and then the Wingman cannot like or pass anyone. Update the Chrome Agent Bridge to ${BRIDGE_MIN} or newer, then ${RESTART}`;
  let caps = null, err = null;
  try { caps = await driver.capabilities(); } catch (e) { err = e; }
  const version = typeof caps?.version === "string" ? caps.version.trim().slice(0, 40) : "";
  if (version && !olderThan(version, BRIDGE_MIN)) return { ok: true, what: `bridge version ${version}` };
  if (version) return { ok: false, what: `bridge version ${version}`, fix };
  if (err && err.status !== 404) return { ok: false, what: "bridge version unknown", fix: `the bridge did not say its version (${firstLine(err)}); ${fix}` };
  return { ok: false, what: `bridge version: older than ${BRIDGE_MIN} (it does not say its version)`, fix };
}

// The login line of one site. Only the site's own "logged out" (a session that says so, or a
// loggedOut error) is a lost login, the one thing that needs the person. Any other error (a crashed
// tab, the bridge answering 500, a timeout, the site's own server error) is named as it is, because
// "log in once" would send whoever reads it the wrong way (2026-10-15: a crashed tab read as a lost
// login).
export function sessionLine(name, { sess = null, error = null } = {}, { bridge = false, loginAt = "" } = {}) {
  if (error && !isLoggedOut(error)) {
    const why = firstLine(error);
    const where = bridge ? "the bridge" : "the Wingman's browser";
    // The version label alone does not prove the repair (bridge 0.6.0 was named before the repair
    // came), so a crashed tab behind a bridge always gets the restart.
    const crashed = bridge && /crash/i.test(why) ? `. The bridge's tab crashed: restart every bridge instance on that computer (a bridge before ${BRIDGE_MIN} never replaces a crashed tab, so update it first)` : "";
    return { ok: false, what: `${name} reachable through ${where}`, fix: `could not ask ${name} whether you are logged in (not a login problem): ${why}${crashed}` };
  }
  return { ok: !!sess?.loggedIn, what: `logged into ${name}`, fix: bridge ? `log in once in the browser behind the bridge, at ${loginAt}` : `log in once in the Wingman's browser at ${loginAt}` };
}

export function workerFix(platform = process.platform, root = isRoot()) {
  if (platform === "win32") return 'start it: schtasks /Run /TN "Godspeed Wingman" (or sign out and in again)';
  if (platform === "darwin") return "start it: launchctl kickstart -k gui/$(id -u)/com.godspeed.wingman";
  return root ? "systemctl status godspeed-wingman" : "systemctl --user status godspeed-wingman";
}

// `home` is where the model programs' own installers put them (a test hands in an empty one).
export function modelLine(model, env = process.env, { home = os.homedir(), mcDir } = {}) {
  const lane = laneOf(model, env);
  if (lane === "command") return { ok: true, what: "model: a test program (GODSPEED_WINGMAN_MODEL_CMD)" };
  if (lane === "godspeed") return godspeedModelProgram({ env, home, mcDir })
    ? { ok: true, what: "model: Godspeed's shared command is installed (connection checked when used)" }
    : { ok: false, what: "model: Godspeed's configured connection", fix: "Godspeed's shared model command was not found; update Godspeed or set GODSPEED_MODEL_COMMAND to its command" };
  if (lane === "openai") {
    const keyEnv = env.GODSPEED_WINGMAN_OPENAI_KEY_ENV || "OPENAI_API_KEY";
    if (!model.name) return { ok: false, what: "model (openai lane)", fix: "name the model in the settings: model.name" };
    return env[keyEnv] ? { ok: true, what: `model: ${model.name} at ${env.GODSPEED_WINGMAN_OPENAI_BASE || "https://api.openai.com/v1"}` } : { ok: false, what: "model (openai lane)", fix: `no key in ${keyEnv}; put it in the Wingman's worker.env` };
  }
  const prog = lane === "codex" ? codexProgram({ env, home }) : claudeProgram({ env, home });
  const label = lane === "codex" ? "Codex" : "Claude Code";
  return prog ? { ok: true, what: `model: ${label}${model.name ? ` (${model.name})` : ""} at ${prog.args[0] || prog.exe}` } : { ok: false, what: `model: ${label}`, fix: `the ${label} program was not found; install it or set ${lane === "codex" ? "GODSPEED_WINGMAN_CODEX" : "GODSPEED_WINGMAN_CLAUDE"}` };
}

export async function run(ctx) {
  const set = ctx.settings;
  let bad = 0;
  const line = (good, what, fix) => { ctx.print(`  ${good ? "ok  " : "FAIL"} ${what}${good || !fix ? "" : `: ${fix}`}`); if (!good) bad++; };
  const note = (what) => ctx.print(`  NOTE ${what}`);
  const alive = workerAlive(ctx.paths);
  line(alive, "worker running", workerFix());
  line(fs.existsSync(ctx.routine.preferences), "preferences written", `write ${ctx.routine.preferences}`);
  // A warning, never a failure: the guard makes room by itself and the session goes on.
  for (const l of await diskLines(ctx, stateOf(ctx.paths), { always: true })) ctx.print(`  ${l.warn ? "WARN" : "ok  "} ${l.warn ? l.text.replace(/^Disk WARNING: /, "disk: ") : l.text}`);
  const { readiness } = await import("../channels/index.mjs");
  for (const r of await readiness(set, ctx.paths)) line(r.ok, `talks through ${r.name}${r.ok && r.why ? ` (${r.why})` : ""}`, r.why);
  const m = modelLine(set.model, process.env, { mcDir: ctx.mcDir });
  line(m.ok, m.what, m.fix);
  if (m.ok && laneOf(set.model) === "godspeed") {
    try {
      const actual = await describeGodspeed({ mcDir: ctx.mcDir });
      line(true, `Godspeed connection: ${actual.provider}, ${actual.model} (configuration only)`);
    } catch (e) { line(false, "Godspeed model connection", firstLine(e)); }
  }
  const incident = stateOf(ctx.paths).modelIncident;
  line(!incident || !!incident.resolvedAt, "no unresolved AI failure", "the AI connection failed; repair and test it before resuming");

  const known = listSites({ mcDir: ctx.mcDir });
  const sites = [];
  for (const id of set.sites) {
    const k = known.find((x) => x.id === id && !x.shadowed);
    if (!k) { line(false, `site ${id}`, "the Wingman knows no such site"); continue; }
    if (k.refused) { line(false, `site ${k.name}`, k.refused); continue; }
    if (k.problems.length) { line(false, `site ${k.name}`, k.problems.join("; ")); continue; }
    if (k.untrusted) { line(false, `site ${k.name}`, k.untrusted); continue; }
    if (k.chosenOn) note(`site ${k.name}: ${choiceLine(k.chosenOn)}`);
    if (k.reminder) note(k.reminder);
    sites.push(await loadSite(id, { mcDir: ctx.mcDir }));
  }
  if (!set.sites.length) line(false, "a site switched on", 'add one to "sites" in the settings');

  const browserSites = sites.filter((s) => s.meta.kind === "browser");
  if (browserSites.length) {
    const { createDriver } = await import("../drivers/index.mjs");
    // While the worker runs, the check uses a tab of its own and closes it again.
    const driver = createDriver(set, { paths: ctx.paths, tab: alive ? "new" : "shared", keepOpen: true });
    let up = false, why = "";
    try { up = (await driver.health()).status === "ok"; } catch (e) { why = e.message; }
    const bridge = set.browser === "bridge";
    line(up, bridge ? `browser through the bridge at ${set.bridge || "(no address)"}` : "the Wingman's own browser", bridge ? (set.bridge ? `the bridge does not answer: ${why}` : "set bridge in the settings to the bridge's address") : why);
    if (up && bridge) {
      const v = await bridgeVersionLine(driver);
      line(v.ok, v.what, v.fix);
    }
    if (up) {
      for (const s of browserSites) {
        let sess = null, error = null;
        try { sess = await s.create({ driver, settings: { kind: set.kind, ...(set.site_options[s.id] || {}) }, log: () => {} }).session(); } catch (e) { error = e; }
        const l = sessionLine(s.meta.name, { sess, error }, { bridge, loginAt: s.meta.login_url || s.meta.home });
        line(l.ok, l.what, l.fix);
        if (sess?.loggedIn && sess.me?.name) ctx.print(`       ${s.meta.name} account ${sess.me.name}${sess.premium === undefined ? "" : `, paid plan: ${sess.premium ? "yes" : "no"}`}`);
      }
    }
    await driver.close?.();
  }
  for (const s of sites.filter((x) => x.meta.kind === "android")) note(`${s.meta.name} is an Android app; \`godspeed-wingman android status\` checks the emulator.`);
  return bad ? 1 : 0;
}
