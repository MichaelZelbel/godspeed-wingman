// Finding a program (claude, codex, hermes) without a shell. A shell is never used to start a
// model: the system prompt and the profile would pass through its quoting, and on Windows cmd.exe
// cannot even carry a line break in an argument. So an npm launcher (claude.cmd, codex.cmd) is read
// and turned into the program it starts: the .exe it names, or Node with the .js it names.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// What an npm .cmd launcher starts: { exe, args } or null. The launcher names its target relative
// to its own folder as "%dp0%\..." (or "%~dp0\...").
export function resolveShim(file, { nodeExe = process.execPath } = {}) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const dir = path.dirname(file);
  const targets = [...text.matchAll(/"%~?dp0%?\\?([^"%]+?\.(exe|js|mjs|cjs))"/gi)].map((m) => ({ rel: m[1], ext: m[2].toLowerCase() }));
  for (const t of targets) {
    // The launcher writes Windows separators; read them the same way on every system.
    const abs = path.join(dir, ...t.rel.split(/[\\/]+/).filter(Boolean));
    if (/[\\/]node\.exe$/i.test(abs) || /^node\.exe$/i.test(t.rel)) continue;
    if (!isFile(abs)) continue;
    if (t.ext === "exe") return { exe: abs, args: [] };
    const localNode = path.join(dir, "node.exe");
    return { exe: isFile(localNode) ? localNode : nodeExe, args: [abs] };
  }
  return null;
}

// The program `name`: one of `candidates` that exists, else the first on PATH. On Windows .exe is
// preferred, then a .cmd launcher read as above. Returns { exe, args } or null.
export function findProgram(name, { candidates = [], env = process.env, platform = process.platform } = {}) {
  const win = platform === "win32";
  const tryFile = (f) => {
    if (!f || !isFile(f)) return null;
    if (win && /\.(cmd|bat)$/i.test(f)) return resolveShim(f);
    return { exe: f, args: [] };
  };
  for (const c of candidates) {
    const r = tryFile(c);
    if (r) return r;
  }
  const dirs = String(env.PATH || env.Path || "").split(win ? ";" : ":").filter(Boolean);
  const exts = win ? [".exe", ".cmd", ".bat"] : [""];
  for (const ext of exts) {
    for (const d of dirs) {
      const r = tryFile(path.join(d.replace(/^"|"$/g, ""), name + ext));
      if (r) return r;
    }
  }
  return null;
}

export function claudeProgram({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const win = platform === "win32";
  const candidates = [
    env.GODSPEED_WINGMAN_CLAUDE,
    path.join(home, ".local", "bin", win ? "claude.exe" : "claude"),
    ...(win ? [] : ["/usr/local/bin/claude"]),
  ].filter(Boolean);
  return findProgram("claude", { candidates, env, platform });
}

export function codexProgram({ env = process.env, platform = process.platform } = {}) {
  return findProgram("codex", { candidates: [env.GODSPEED_WINGMAN_CODEX].filter(Boolean), env, platform });
}

// Hermes: on PATH, Hermes' own Windows install, or the copy Godspeed Mission Control runs on Windows.
export function hermesProgram({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const win = platform === "win32";
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const none = { PATH: "" };
  if (env.GODSPEED_WINGMAN_HERMES) {
    const chosen = findProgram("hermes", { candidates: [env.GODSPEED_WINGMAN_HERMES], env: none, platform });
    if (chosen) return chosen;
  }
  const known = win
    ? [path.join(local, "hermes", "bin", "hermes.exe"), path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-runtime", "bin", "hermes.exe")]
    : [path.join(home, ".local", "bin", "hermes"), "/usr/local/bin/hermes"];
  return findProgram("hermes", { env, platform }) || findProgram("hermes", { candidates: known, env: none, platform });
}
