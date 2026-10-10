// Hermes: where its home is, and the plugin that shows the assistant the open question before
// every turn (pre_llm_call). Works on Linux, macOS and Windows: Hermes' own install, a named
// Hermes profile (hermes -p <name>), any home given with --hermes-home, and the Hermes that
// Godspeed Mission Control runs on Windows (its home is the hermes-profile folder).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hermesProgram } from "../core/exe.mjs";

export const PLUGIN = "godspeed-wingman";

export function godspeedWindowsHome({ env = process.env, home = os.homedir() } = {}) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const dir = path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-profile");
  return fs.existsSync(dir) ? dir : null;
}

// How to run Hermes for this install: { prog, args (before the subcommand), env, home }.
// `home` is known up front for --hermes-home and Godspeed's Windows Hermes, else asked from Hermes.
export function locate(flags = {}, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const prog = hermesProgram({ env, platform, home });
  const args = flags["hermes-profile"] ? ["-p", flags["hermes-profile"]] : [];
  let hermesHome = flags["hermes-home"] ? path.resolve(flags["hermes-home"]) : null;
  if (!hermesHome && !flags["hermes-profile"] && platform === "win32") hermesHome = godspeedWindowsHome({ env, home });
  const runEnv = hermesHome ? { ...env, HERMES_HOME: hermesHome } : env;
  const hermes = (sub, opts = {}) => {
    if (!prog) return { status: null, stdout: "", stderr: "hermes not found" };
    const r = spawnSync(prog.exe, [...prog.args, ...args, ...sub], { encoding: "utf8", windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"], env: runEnv, ...opts });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
  if (!hermesHome && prog) {
    const cfg = hermes(["config", "path"]).stdout.trim().split(/\r?\n/).pop();
    if (cfg) hermesHome = path.dirname(cfg);
  }
  let envFile = null;
  if (hermesHome) {
    const asked = prog ? hermes(["config", "env-path"]).stdout.trim().split(/\r?\n/).pop() : "";
    envFile = asked && fs.existsSync(asked) ? asked : path.join(hermesHome, ".env");
  }
  return { prog, args, env: runEnv, home: hermesHome, envFile, hermes };
}

// Whether the Hermes .env holds a Telegram bot (the gateway owns it; the Wingman only sends).
export function hasTelegram(envFile) {
  try { return /^\s*TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(envFile, "utf8")); } catch { return false; }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Copies the plugin into <home>/plugins/godspeed-wingman with the command line it runs, and
// switches it on. `argv` is the worker's command without the verb: [node, script, --godspeed, ...].
export function installPlugin(h, { pkgDir, argv, launcher }) {
  if (!h.home) return { ok: false, text: "Hermes was not found here, so the assistant gets no plugin (add --hermes-home <folder> if it lives elsewhere)" };
  const dst = path.join(h.home, "plugins", PLUGIN);
  const wasThere = fs.existsSync(dst);
  fs.rmSync(dst, { recursive: true, force: true });
  copyDir(path.join(pkgDir, "hermes", "plugin", PLUGIN), dst);
  fs.writeFileSync(path.join(dst, "launcher.json"), JSON.stringify({ argv }, null, 2) + "\n");
  if (launcher) fs.writeFileSync(path.join(dst, "launcher.txt"), launcher + "\n");
  const en = h.hermes(["plugins", "enable", PLUGIN]);
  const enabled = en.status === 0;
  return { ok: true, wasThere, dir: dst, enabled, text: enabled ? `plugin ${PLUGIN} in ${dst}, switched on` : `plugin copied to ${dst}; switch it on with: hermes plugins enable ${PLUGIN}${en.stderr ? ` (${en.stderr.trim().slice(0, 200)})` : ""}` };
}

export function removePlugin(h) {
  if (!h.home) return { ok: true, text: "no Hermes plugin to remove" };
  const dst = path.join(h.home, "plugins", PLUGIN);
  if (!fs.existsSync(dst)) return { ok: true, text: "no Hermes plugin to remove" };
  h.hermes(["plugins", "disable", PLUGIN]);
  fs.rmSync(dst, { recursive: true, force: true });
  return { ok: true, text: `Hermes plugin removed from ${dst}` };
}

// Restarting the gateway loads a new plugin. One minute at most, never waiting for input.
export function restartGateway(h) {
  const r = h.hermes(["gateway", "restart"], { timeout: 60000 });
  return r.status === 0 && !/failed to connect to bus|not running|error/i.test(r.stdout + r.stderr);
}
