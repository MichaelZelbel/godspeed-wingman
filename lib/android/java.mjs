// Java for the Android command-line tools: they need Java 17 or newer. Found in JAVA_HOME, in the
// Wingman's own Android folder (a JDK it fetched earlier, only after the person said yes), in
// Android Studio's bundled runtime, or on PATH. When none is found, the Eclipse Temurin JDK 17 for
// this machine is looked up in the Adoptium API (https://api.adoptium.net), never hard-coded.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../core/exe.mjs";

export const MIN_JAVA = 17;
export const ADOPTIUM = "https://api.adoptium.net/v3/assets/latest/17/hotspot";

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// "17.0.12", "1.8.0_401", "21" -> the major version (8, 17, 21), or null.
export function majorOf(text) {
  const m = String(text || "").match(/version "?(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return Number(m[1]) === 1 && m[2] ? Number(m[2]) : Number(m[1]);
}

// The java program under a JDK folder (macOS keeps it under Contents/Home).
export function javaIn(jdk, { platform = process.platform } = {}) {
  const exe = platform === "win32" ? "java.exe" : "java";
  for (const p of [path.join(jdk, "bin", exe), path.join(jdk, "Contents", "Home", "bin", exe)]) if (isFile(p)) return p;
  return null;
}

// The JDK folders the Wingman unpacked: <android home>/jdk/<name>.
function ownJdks(androidHome) {
  const root = path.join(androidHome, "jdk");
  try { return fs.readdirSync(root).map((n) => path.join(root, n)).sort().reverse(); } catch { return []; }
}

export function javaCandidates({ env = process.env, platform = process.platform, home = os.homedir(), androidHome } = {}) {
  const out = [];
  if (env.JAVA_HOME) out.push(javaIn(env.JAVA_HOME, { platform }));
  for (const d of ownJdks(androidHome)) out.push(javaIn(d, { platform }));
  const pf = env.ProgramFiles || "C:\\Program Files";
  const studio = platform === "win32" ? [path.join(pf, "Android", "Android Studio", "jbr")]
    : platform === "darwin" ? ["/Applications/Android Studio.app/Contents/jbr", path.join(home, "Applications", "Android Studio.app", "Contents", "jbr")]
      : ["/opt/android-studio/jbr", path.join(home, "android-studio", "jbr"), "/snap/android-studio/current/jbr"];
  for (const d of studio) out.push(javaIn(d, { platform }));
  out.push(findProgram("java", { env, platform })?.exe || null);
  return [...new Set(out.filter(Boolean))];
}

export function javaVersion(exe, { run = spawnSync } = {}) {
  const r = run(exe, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  return majorOf(`${r.stderr || ""}\n${r.stdout || ""}`);
}

// The first Java of version 17 or newer: { exe, home, version }, plus `older` (a Java that is too
// old, to name it) when there is no good one.
export function findJava(opts = {}) {
  let older = null;
  for (const exe of javaCandidates(opts)) {
    const v = (opts.versionOf || javaVersion)(exe);
    if (v && v >= MIN_JAVA) return { exe, home: path.dirname(path.dirname(exe)), version: v };
    if (v && !older) older = { exe, version: v };
  }
  return { exe: null, older };
}

// What Adoptium serves for this machine: { name, url, sha256, size, kind: "zip" | "tar.gz" }.
export function temurinQuery({ platform = process.platform, arch = process.arch } = {}) {
  const os_ = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
  const a = arch === "arm64" ? "aarch64" : "x64";
  return `${ADOPTIUM}?os=${os_}&architecture=${a}&image_type=jdk&vendor=eclipse`;
}

export function pickTemurin(list) {
  const pkg = (Array.isArray(list) ? list : []).map((x) => x?.binary?.package).find((p) => p?.link && /\.(zip|tar\.gz)$/.test(p.name || p.link));
  if (!pkg) throw new Error("Adoptium lists no JDK 17 package for this machine");
  if (!/^https:\/\//.test(pkg.link)) throw new Error("Adoptium answered with an address that is not https");
  return { name: pkg.name, url: pkg.link, sha256: pkg.checksum || null, size: pkg.size || 0, kind: /\.zip$/.test(pkg.name || pkg.link) ? "zip" : "tar.gz" };
}

export async function temurin({ fetchImpl = fetch, platform, arch } = {}) {
  const r = await fetchImpl(temurinQuery({ platform, arch }), { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Adoptium answered ${r.status}`);
  return pickTemurin(await r.json());
}
