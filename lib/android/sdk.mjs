// The Android SDK: where it is on this machine, and what to download when it is not there.
//
// Nothing here downloads anything. It reads Google's own package lists
// (https://dl.google.com/android/repository/repository2-3.xml for the command-line tools, and the
// Google Play system image list) so a version is never written into the Wingman: the newest stable
// command-line tools and the newest stable Google Play system image are whatever Google lists today.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = "https://dl.google.com/android/repository/";
export const REPO_XML = `${REPO}repository2-3.xml`;
export const SYSIMG_XML = `${REPO}sys-img/google_apis_playstore/sys-img2-3.xml`;
export const SYSIMG_BASE = `${REPO}sys-img/google_apis_playstore/`;
export const AVD_NAME = "wingman";
// An Android app's package name, as in its Play Store address (?id=com.example.app).
export const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Everything the Wingman puts on the machine for Android lives in one folder, so removing it is
// deleting that folder: ~/.godspeed/android (GODSPEED_WINGMAN_ANDROID_HOME overrides).
export function androidHome({ env = process.env, home = os.homedir() } = {}) {
  return env.GODSPEED_WINGMAN_ANDROID_HOME ? path.resolve(env.GODSPEED_WINGMAN_ANDROID_HOME) : path.join(home, ".godspeed", "android");
}

// The machine as Google's lists name it: host-os linux | macosx | windows, host-arch x64 | aarch64,
// and the system image's abi.
export function host({ platform = process.platform, arch = process.arch } = {}) {
  const os_ = platform === "win32" ? "windows" : platform === "darwin" ? "macosx" : "linux";
  const a = arch === "arm64" ? "aarch64" : "x64";
  return { os: os_, arch: a, abi: a === "aarch64" ? "arm64-v8a" : "x86_64", exe: platform === "win32" ? ".exe" : "", bat: platform === "win32" ? ".bat" : "" };
}

// The parts of one SDK folder: { root, sdkmanager, avdmanager, adb, emulator } (null when missing).
export function sdkParts(root, { platform = process.platform } = {}) {
  const h = host({ platform });
  const tool = (name) => {
    for (const v of ["latest", ...(() => { try { return fs.readdirSync(path.join(root, "cmdline-tools")).filter((d) => d !== "latest").sort().reverse(); } catch { return []; } })()]) {
      const f = path.join(root, "cmdline-tools", v, "bin", name + h.bat);
      if (isFile(f)) return f;
    }
    const old = path.join(root, "tools", "bin", name + h.bat);
    return isFile(old) ? old : null;
  };
  const adb = path.join(root, "platform-tools", `adb${h.exe}`);
  const emulator = path.join(root, "emulator", `emulator${h.exe}`);
  return { root, sdkmanager: tool("sdkmanager"), avdmanager: tool("avdmanager"), adb: isFile(adb) ? adb : null, emulator: isFile(emulator) ? emulator : null };
}

// Where an SDK may already be: the environment, the Wingman's own folder, Android Studio's
// default folder on each system.
export function sdkCandidates({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const studio = platform === "win32" ? [path.join(local, "Android", "Sdk")]
    : platform === "darwin" ? [path.join(home, "Library", "Android", "sdk")]
      : [path.join(home, "Android", "Sdk")];
  return [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, path.join(androidHome({ env, home }), "sdk"), ...studio].filter(Boolean).map((p) => path.resolve(p));
}

// The first SDK folder that holds anything useful, with its parts; null when there is none.
export function findSdk(opts = {}) {
  for (const root of [...new Set(sdkCandidates(opts))]) {
    if (!isDir(root)) continue;
    const parts = sdkParts(root, opts);
    if (parts.sdkmanager || parts.adb || parts.emulator) return parts;
  }
  return null;
}

// ---- Google's package lists ------------------------------------------------------------------
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : null; };

// Every <remotePackage> in a list: { path, obsolete, channel, revision, license, archives:[{ url, size, sha1, os, arch }], details }.
export function packages(xml) {
  const channels = Object.fromEntries([...xml.matchAll(/<channel id="([^"]+)">([^<]+)<\/channel>/g)].map((m) => [m[1], m[2].trim()]));
  return [...xml.matchAll(/<remotePackage([^>]*)>([\s\S]*?)<\/remotePackage>/g)].map((m) => {
    const attrs = m[1], body = m[2];
    const rev = tag(body, "revision") || "";
    const revision = ["major", "minor", "micro"].map((k) => Number(tag(rev, k) || 0));
    return {
      path: (attrs.match(/path="([^"]+)"/) || [])[1] || "",
      obsolete: /obsolete="true"/.test(attrs),
      channel: channels[(body.match(/<channelRef ref="([^"]+)"/) || [])[1]] || "stable",
      revision,
      license: (body.match(/<uses-license ref="([^"]+)"/) || [])[1] || null,
      apiLevel: tag(body, "api-level"),
      abi: tag(body, "abi"),
      archives: [...body.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((a) => ({
        url: tag(a[1], "url"), size: Number(tag(a[1], "size") || 0),
        sha1: (a[1].match(/<checksum type="sha1">([0-9a-f]+)<\/checksum>/) || [])[1] || null,
        os: tag(a[1], "host-os"), arch: tag(a[1], "host-arch"),
      })),
    };
  });
}

// The text of a licence in a list, by its id.
export function licenseText(xml, id) {
  const m = xml.match(new RegExp(`<license id="${id.replace(/[^a-z0-9-]/gi, "")}"[^>]*>([\\s\\S]*?)</license>`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim() : null;
}

const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a.revision[i] !== b.revision[i]) return a.revision[i] > b.revision[i]; return false; };
const archiveFor = (pkg, h) => pkg.archives.find((a) => (!a.os || a.os === h.os) && (!a.arch || a.arch === h.arch)) || null;

// The command-line tools to download for this machine: "cmdline-tools;latest" when Google lists it
// on the stable channel, else the newest stable numbered one. { path, version, url, size, sha1, license }.
export function cmdlineTools(xml, h = host()) {
  const all = packages(xml).filter((p) => p.path.startsWith("cmdline-tools;") && !p.obsolete && p.channel === "stable" && archiveFor(p, h));
  const pick = all.find((p) => p.path === "cmdline-tools;latest")
    || all.filter((p) => /^cmdline-tools;\d+(\.\d+)*$/.test(p.path)).reduce((best, p) => (!best || newer(p, best) ? p : best), null);
  if (!pick) throw new Error(`Google's list has no command-line tools for ${h.os} (${h.arch})`);
  const a = archiveFor(pick, h);
  return { path: pick.path, version: pick.revision.filter((x, i) => i < 2 || x).join("."), url: new URL(a.url, REPO).href, size: a.size, sha1: a.sha1, license: pick.license };
}

// The Google Play system image to install: the newest stable plain API level (no preview, no
// extension level, no 16k page size variant) for this machine's abi. { path, api, size, license }.
export function systemImage(xml, h = host()) {
  const plain = /^system-images;android-(\d+(?:\.\d+)?);google_apis_playstore;([\w-]+)$/;
  const all = packages(xml).filter((p) => !p.obsolete && p.channel === "stable" && plain.test(p.path) && p.path.match(plain)[2] === h.abi);
  if (!all.length) throw new Error(`Google's list has no stable Google Play system image for ${h.abi}`);
  const api = (p) => Number(p.path.match(plain)[1]);
  const best = all.reduce((b, p) => (!b || api(p) > api(b) || (api(p) === api(b) && newer(p, b)) ? p : b), null);
  const a = best.archives[0] || {};
  return { path: best.path, api: best.path.match(plain)[1], size: a.size || 0, url: a.url ? new URL(a.url, SYSIMG_BASE).href : null, license: best.license };
}

// Reads a list from Google (the tests hand in their own fetch and a saved copy).
export async function fetchText(url, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}

// What setup remembers about the Android install: <android home>/android.json.
export function readConfig(home) { try { return JSON.parse(fs.readFileSync(path.join(home, "android.json"), "utf8")); } catch { return null; } }
export function writeConfig(home, value) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "android.json"), JSON.stringify(value, null, 2) + "\n");
}

// The SDK to use: the one setup recorded, else any found.
export function currentSdk(opts = {}) {
  const home = androidHome(opts);
  const c = readConfig(home);
  if (c?.sdk && isDir(c.sdk)) return sdkParts(c.sdk, opts);
  return findSdk(opts);
}

// The environment the Android tools need: where the SDK is, where the Wingman's emulator lives,
// and which Java to use.
export function toolEnv({ sdk, home, java, env = process.env }) {
  const e = { ...env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: path.join(home, "avd") };
  if (java) e.JAVA_HOME = java;
  return e;
}
