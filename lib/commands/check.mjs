// Is everything connected? One line per part, with what to do when it fails. Exit 1 when
// something essential fails. A disk warning or a terms reminder never counts as a failure.
import fs from "node:fs";
import os from "node:os";
import { workerAlive, stateOf, diskLines } from "./_common.mjs";
import { listSites, loadSite } from "../sites/index.mjs";
import { claudeProgram, codexProgram } from "../core/exe.mjs";
import { laneOf } from "../core/model.mjs";
import { isRoot } from "../core/paths.mjs";

export const meta = { name: "check", summary: "is everything connected?", usage: "check", flags: {} };

export function workerFix(platform = process.platform, root = isRoot()) {
  if (platform === "win32") return 'start it: schtasks /Run /TN "Godspeed Wingman" (or sign out and in again)';
  if (platform === "darwin") return "start it: launchctl kickstart -k gui/$(id -u)/com.godspeed.wingman";
  return root ? "systemctl status godspeed-wingman" : "systemctl --user status godspeed-wingman";
}

// `home` is where the model programs' own installers put them (a test hands in an empty one).
export function modelLine(model, env = process.env, { home = os.homedir() } = {}) {
  const lane = laneOf(model, env);
  if (lane === "command") return { ok: true, what: "model: a test program (GODSPEED_WINGMAN_MODEL_CMD)" };
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
  const m = modelLine(set.model);
  line(m.ok, m.what, m.fix);

  const known = listSites({ mcDir: ctx.mcDir });
  const sites = [];
  for (const id of set.sites) {
    const k = known.find((x) => x.id === id && !x.shadowed);
    if (!k) { line(false, `site ${id}`, "the Wingman knows no such site"); continue; }
    if (k.refused) { line(false, `site ${k.name}`, k.refused); continue; }
    if (k.problems.length) { line(false, `site ${k.name}`, k.problems.join("; ")); continue; }
    if (k.untrusted) { line(false, `site ${k.name}`, k.untrusted); continue; }
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
    line(up, set.browser === "bridge" ? `browser through the bridge at ${set.bridge || "(no address)"}` : "the Wingman's own browser", set.browser === "bridge" ? (set.bridge ? `the bridge does not answer: ${why}` : "set bridge in the settings to the bridge's address") : why);
    if (up) {
      for (const s of browserSites) {
        let sess = null;
        try { sess = await s.create({ driver, settings: { kind: set.kind, ...(set.site_options[s.id] || {}) }, log: () => {} }).session(); } catch (e) { why = e.message; }
        line(!!sess?.loggedIn, `logged into ${s.meta.name}`, `log in once in the Wingman's browser at ${s.meta.login_url || s.meta.home}`);
        if (sess?.loggedIn && sess.me?.name) ctx.print(`       ${s.meta.name} account ${sess.me.name}${sess.premium === undefined ? "" : `, paid plan: ${sess.premium ? "yes" : "no"}`}`);
      }
    }
    await driver.close?.();
  }
  for (const s of sites.filter((x) => x.meta.kind === "android")) note(`${s.meta.name} is an Android app; \`godspeed-wingman android status\` checks the emulator.`);
  return bad ? 1 : 0;
}
