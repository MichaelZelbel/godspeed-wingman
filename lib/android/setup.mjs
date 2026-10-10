// `godspeed-wingman android setup`: the Android emulator for app-only dating services
// (experimental). In order:
//
//   1. the plan: an Android SDK already on this machine (the environment, Android Studio's folder,
//      or one the Wingman installed before), else one in ~/.godspeed/android/sdk; Java 17; the newest
//      stable command-line tools and Google Play system image as Google lists them today; the room
//      on the disk; whether hardware acceleration is likely there. --dry-run stops here, after
//      checking that every download address answers, without downloading anything big.
//   2. before anything is downloaded: enough room, the Android SDK licence accepted by the person
//      (they answer yes, or they said so with --accept-licenses), and their yes to fetching Java
//      when it is missing (or --yes).
//   3. Java (Eclipse Temurin 17 from Adoptium, checked against its sha256), the command-line tools
//      (checked against Google's sha1), then sdkmanager for platform-tools, the emulator and the
//      system image, then the virtual phone "wingman".
//   4. the acceleration check, then the emulator starts, and the person is told what is left for
//      them: sign into the Play Store, install the app, log in.
//
// Everything goes into one folder (~/.godspeed/android), so `android remove` takes it out again; an
// SDK that was already there gets the missing packages and stays where it is.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import * as sdk from "./sdk.mjs";
import * as java from "./java.mjs";
import { download, unzip, untarGz, freeSpace } from "./files.mjs";
import { accelPrecheck, accelHelp, startEmulator } from "./emulator.mjs";

const GB = 1024 ** 3;
export const NEED_BYTES = 15 * GB;
export const TERMS_URL = "https://developer.android.com/studio/terms";

async function askLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} `)).trim()); } finally { rl.close(); }
}

// This machine, or what a test hands in instead.
export function machine(sys = {}) {
  return {
    env: sys.env || process.env, platform: sys.platform || process.platform, arch: sys.arch || process.arch, home: sys.home || os.homedir(),
    fetch: sys.fetch || fetch, run: sys.run || spawnSync, spawn: sys.spawn || spawn,
    isTTY: sys.isTTY ?? !!(process.stdin.isTTY && process.stdout.isTTY),
    ask: sys.ask || askLine, print: sys.print || ((s) => console.log(s)),
    accel: sys.accel || ((m) => accelPrecheck({ platform: m.platform, run: m.run })),
    freeSpace: sys.freeSpace || freeSpace,
    versionOf: sys.versionOf,
  };
}

const mb = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

// What setup would do on this machine. Reads Google's two lists; downloads nothing else.
export async function plan(m) {
  const h = sdk.host(m);
  const home = sdk.androidHome(m);
  const found = sdk.currentSdk(m);
  const sdkRoot = found ? found.root : path.join(home, "sdk");
  const parts = found || sdk.sdkParts(sdkRoot, m);
  const [repoXml, imgXml] = await Promise.all([sdk.fetchText(sdk.REPO_XML, { fetchImpl: m.fetch }), sdk.fetchText(sdk.SYSIMG_XML, { fetchImpl: m.fetch })]);
  const cmdline = sdk.cmdlineTools(repoXml, h);
  const image = sdk.systemImage(imgXml, h);
  const stable = sdk.packages(repoXml).filter((p) => p.channel === "stable" && !p.obsolete);
  const licenceOf = (name) => stable.find((p) => p.path === name)?.license || "android-sdk-license";
  const have = {
    "platform-tools": !!parts.adb,
    emulator: !!parts.emulator,
    [image.path]: fs.existsSync(path.join(sdkRoot, ...image.path.split(";"), "system.img")),
  };
  const packages = Object.keys(have).filter((k) => !have[k]);
  const needCmdline = !parts.sdkmanager;
  const licences = [...new Set([
    ...(needCmdline || packages.length ? [cmdline.license] : []),
    ...packages.map((p) => (p === image.path ? image.license : licenceOf(p))),
  ].filter(Boolean))];
  const j = java.findJava({ env: m.env, platform: m.platform, home: m.home, androidHome: home, versionOf: m.versionOf });
  return {
    host: h, home, sdkRoot, found: !!found, parts, needCmdline, cmdline, image, packages, licences,
    licenceText: (id) => sdk.licenseText(repoXml, id) || sdk.licenseText(imgXml, id),
    java: j, avd: { name: sdk.AVD_NAME, exists: fs.existsSync(path.join(home, "avd", `${sdk.AVD_NAME}.ini`)) },
    free: m.freeSpace(found ? sdkRoot : home), accel: m.accel(m),
  };
}

export function describe(p) {
  const L = [];
  L.push("Android for the Wingman (experimental)");
  L.push(p.found ? `  Android SDK: found at ${p.sdkRoot}` : `  Android SDK: none found, so one goes into ${p.sdkRoot}`);
  L.push(p.java.exe ? `  Java: version ${p.java.version} at ${p.java.exe}` : `  Java: MISSING${p.java.older ? ` (only version ${p.java.older.version}, at ${p.java.older.exe})` : ""}. Java 17 or newer is needed; Eclipse Temurin JDK 17 would be fetched from adoptium.net into ${path.join(p.home, "jdk")}, after you say yes`);
  L.push(p.needCmdline ? `  command-line tools: version ${p.cmdline.version} from ${p.cmdline.url} (${mb(p.cmdline.size)})` : `  command-line tools: there (${p.parts.sdkmanager})`);
  L.push(p.packages.length ? `  to install: ${p.packages.join(", ")} (the system image alone is ${mb(p.image.size)} to download)` : "  to install: nothing, every package is there");
  L.push(p.avd.exists ? `  the virtual phone "${p.avd.name}": there` : `  the virtual phone "${p.avd.name}": made new, a Pixel phone with Google Play (Android ${p.image.api})`);
  if (p.licences.length) L.push(`  licence you accept before anything is installed: ${p.licences.join(", ")} (${TERMS_URL})`);
  L.push(p.free === null ? "  disk: free space unknown" : `  disk: ${mb(p.free)} free; about ${mb(NEED_BYTES)} needed${p.free < NEED_BYTES && p.packages.length ? " (NOT ENOUGH)" : ""}`);
  L.push(`  hardware acceleration: ${p.accel.state === "on" ? "available" : p.accel.state === "off" ? "NOT AVAILABLE" : "not known yet"} (${p.accel.why})`);
  return L.join("\n");
}

// Does each download answer? A HEAD for the big files, never their bodies.
export async function checkDownloads(p, m) {
  const results = [
    { what: "Google's list of Android tools", url: sdk.REPO_XML, ok: true },
    { what: "Google's list of Google Play system images", url: sdk.SYSIMG_XML, ok: true },
  ];
  const head = async (what, url) => {
    try {
      const r = await m.fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30000) });
      results.push({ what, url, ok: r.ok, status: r.status });
    } catch (e) { results.push({ what, url, ok: false, status: e.message }); }
  };
  if (p.needCmdline) await head("the command-line tools", p.cmdline.url);
  if (p.packages.includes(p.image.path) && p.image.url) await head("the system image", p.image.url);
  if (!p.java.exe) {
    const q = java.temurinQuery(m);
    try {
      const r = await m.fetch(q, { signal: AbortSignal.timeout(30000) });
      results.push({ what: "Adoptium's list of Java 17", url: q, ok: r.ok, status: r.status });
      if (r.ok) { const t = java.pickTemurin(await r.json()); await head(`Java (${t.name}, ${mb(t.size)})`, t.url); }
    } catch (e) { results.push({ what: "Adoptium's list of Java 17", url: q, ok: false, status: e.message }); }
  }
  return results;
}

// A command of the SDK: a .bat on Windows runs through cmd.exe with every part quoted.
export function toolCommand(file, args, platform = process.platform, env = process.env) {
  if (platform === "win32" && /\.(bat|cmd)$/i.test(file)) {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    return { exe: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[file, ...args].map(q).join(" ")}"`], verbatim: true };
  }
  return { exe: file, args, verbatim: false };
}

export function runTool(m, file, args, { env, input = "", show = false, timeoutMs = 3 * 3600000 } = {}) {
  const c = toolCommand(file, args, m.platform, env);
  return new Promise((resolve) => {
    const child = m.spawn(c.exe, c.args, { env, windowsVerbatimArguments: c.verbatim, windowsHide: true, stdio: ["pipe", show ? "inherit" : "pipe", show ? "inherit" : "pipe"] });
    let out = "";
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

const progress = (m, what) => {
  let shown = -1;
  return (done, total) => {
    if (!total) return;
    const tenth = Math.floor((done / total) * 10);
    if (tenth !== shown) { shown = tenth; m.print(`  ${what}: ${tenth * 10}%`); }
  };
};

async function fetchJava(p, m) {
  const t = await java.temurin({ fetchImpl: m.fetch, platform: m.platform, arch: m.arch });
  const file = path.join(p.home, "downloads", t.name);
  m.print(`Fetching ${t.name} (${mb(t.size)}) from Adoptium`);
  await download(t.url, file, { hash: t.sha256 ? { algo: "sha256", hex: t.sha256 } : null, size: t.size, fetchImpl: m.fetch, progress: progress(m, "Java") });
  const dest = path.join(p.home, "jdk");
  if (t.kind === "zip") unzip(file, dest); else untarGz(file, dest, { run: m.run });
  fs.rmSync(file, { force: true });
  const j = java.findJava({ env: { ...m.env, JAVA_HOME: "", PATH: "" }, platform: m.platform, home: m.home, androidHome: p.home, versionOf: m.versionOf });
  if (!j.exe) throw new Error("Java was unpacked, but its java program was not found");
  m.print(`  ok   Java ${j.version} at ${j.exe}`);
  return j.home;
}

async function fetchCmdline(p, m) {
  const file = path.join(p.home, "downloads", path.basename(new URL(p.cmdline.url).pathname));
  m.print(`Fetching the Android command-line tools ${p.cmdline.version} (${mb(p.cmdline.size)})`);
  await download(p.cmdline.url, file, { hash: p.cmdline.sha1 ? { algo: "sha1", hex: p.cmdline.sha1 } : null, size: p.cmdline.size, fetchImpl: m.fetch, progress: progress(m, "command-line tools") });
  const tmp = path.join(p.sdkRoot, "cmdline-tools", `_unpack-${Date.now()}`);
  unzip(file, tmp);
  const inner = path.join(tmp, "cmdline-tools");
  const latest = path.join(p.sdkRoot, "cmdline-tools", "latest");
  fs.rmSync(latest, { recursive: true, force: true });
  fs.renameSync(fs.existsSync(inner) ? inner : tmp, latest);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(file, { force: true });
  m.print(`  ok   command-line tools in ${latest}`);
}

// The virtual phone: a Pixel with Google Play, the keyboard on, so typed text arrives as typed.
async function createAvd(p, m, parts, env) {
  const base = ["create", "avd", "-n", p.avd.name, "-k", p.image.path];
  let r = await runTool(m, parts.avdmanager, [...base, "-d", "pixel_7"], { env, input: "no\n" });
  if (r.code !== 0) r = await runTool(m, parts.avdmanager, base, { env, input: "no\n" });
  if (r.code !== 0) throw new Error(`avdmanager could not make the virtual phone: ${r.out.trim().split("\n").slice(-3).join(" ")}`);
  const ini = path.join(p.home, "avd", `${p.avd.name}.avd`, "config.ini");
  try {
    let text = fs.readFileSync(ini, "utf8");
    for (const [k, v] of [["hw.keyboard", "yes"], ["PlayStore.enabled", "true"]]) {
      text = new RegExp(`^${k.replace(".", "\\.")}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k.replace(".", "\\.")}=.*$`, "m"), `${k}=${v}`) : `${text.replace(/\s*$/, "\n")}${k}=${v}\n`;
    }
    fs.writeFileSync(ini, text);
  } catch { /* the phone works without these */ }
}

export const NEXT_STEPS = (apps) => [
  "The emulator is running. What is left needs your own accounts, so it is yours:",
  "  1. In the emulator's window, open the Play Store and sign in with a Google account.",
  `  2. Install ${apps.length ? apps.join(" or ") : "the dating app"} there, open it and log in.`,
  "  3. Tell your mission control that the app is installed and you are logged in (or run: godspeed-wingman android status).",
].join("\n");

// The whole setup. `apps` names the apps of the person's Android sites for the last message.
export async function setup(flags = {}, sys = {}, { apps = [] } = {}) {
  const m = machine(sys);
  const say = m.print;
  let p;
  try { p = await plan(m); } catch (e) { say(`Could not read Google's lists of Android tools: ${e.message}. Check the internet connection and try again.`); return 1; }
  say(describe(p));
  if (p.accel.state === "off") say(`\n${accelHelp(m.platform)}`);

  if (flags["dry-run"]) {
    say("\nDo the downloads answer?");
    const res = await checkDownloads(p, m);
    for (const r of res) say(`  ${r.ok ? "ok  " : "FAIL"} ${r.what}: ${r.url}${r.ok ? "" : ` (${r.status})`}`);
    say("\nThis was a dry run: nothing was downloaded, installed or changed.");
    return res.every((r) => r.ok) ? 0 : 1;
  }

  // Before anything is downloaded.
  if (p.free !== null && p.free < NEED_BYTES && (p.packages.length || p.needCmdline)) {
    say(`\nThere is not enough room: ${mb(p.free)} free, about ${mb(NEED_BYTES)} needed. Nothing was downloaded.`);
    return 1;
  }
  if (p.licences.length) {
    if (flags["accept-licenses"]) say(`\nYou accepted the Android SDK licence (${p.licences.join(", ")}, ${TERMS_URL}) with --accept-licenses.`);
    else if (m.isTTY) {
      for (const id of p.licences) say(`\n----- ${id} -----\n${p.licenceText(id) || `(read it at ${TERMS_URL})`}\n`);
      if (!(await m.ask("Do you accept the Android SDK licence above? [y/N]"))) { say("Then nothing is installed. The Android part of the Wingman needs it."); return 1; }
    } else {
      say(`\nThe Android SDK licence has to be accepted by you before anything is installed. Read it at ${TERMS_URL}. If you accept it, run: godspeed-wingman android setup --accept-licenses`);
      return 1;
    }
  }
  let javaHome = p.java.exe ? p.java.home : null;
  if (!p.java.exe) {
    const yes = flags.yes || (m.isTTY && (await m.ask(`Java 17 is needed and is not on this computer. Fetch Eclipse Temurin JDK 17 from adoptium.net into ${path.join(p.home, "jdk")}? [y/N]`)));
    if (!yes) { say("Then nothing is installed. Install Java 17 or newer yourself, or run again with --yes to let the Wingman fetch it."); return 1; }
  }

  try {
    if (!p.java.exe) javaHome = await fetchJava(p, m);
    if (p.needCmdline) await fetchCmdline(p, m);
    const parts = sdk.sdkParts(p.sdkRoot, m);
    if (!parts.sdkmanager) throw new Error("sdkmanager is missing from the command-line tools");
    const env = sdk.toolEnv({ sdk: p.sdkRoot, home: p.home, java: javaHome, env: m.env });
    fs.mkdirSync(path.join(p.home, "avd"), { recursive: true });
    if (p.packages.length) {
      // The person accepted the licence above; sdkmanager asks again for each package.
      await runTool(m, parts.sdkmanager, [`--sdk_root=${p.sdkRoot}`, "--licenses"], { env, input: "y\n".repeat(40) });
      say(`Installing ${p.packages.join(", ")} (this is the long part)`);
      const r = await runTool(m, parts.sdkmanager, [`--sdk_root=${p.sdkRoot}`, "--install", ...p.packages], { env, input: "y\n".repeat(10), show: true });
      if (r.code !== 0) throw new Error(`sdkmanager stopped (exit ${r.code})`);
    }
    const after = sdk.sdkParts(p.sdkRoot, m);
    if (!p.avd.exists) {
      if (!after.avdmanager) throw new Error("avdmanager is missing from the command-line tools");
      await createAvd(p, m, after, env);
      say(`  ok   the virtual phone "${p.avd.name}"`);
    }
    sdk.writeConfig(p.home, { sdk: p.sdkRoot, java: javaHome, image: p.image.path, avd: p.avd.name, at: new Date().toISOString() });
    if (!after.emulator || !after.adb) throw new Error("the emulator or adb is missing after the install");
    const acc = await runTool(m, after.emulator, ["-accel-check"], { env, timeoutMs: 60000 });
    if (acc.code !== 0) {
      say(`\nEverything is installed, but the emulator cannot use hardware acceleration on this computer:\n${acc.out.trim()}\n\n${accelHelp(m.platform)}\n\nThen start it with: godspeed-wingman android start`);
      return 1;
    }
    if (flags["no-start"]) { say("\nInstalled. Start the emulator with: godspeed-wingman android start"); return 0; }
    const s = await startEmulator({ parts: after, home: p.home, env, headless: !!flags.headless, print: say, spawnImpl: m.spawn });
    say(`  ok   the emulator runs as ${s.serial}\n\n${NEXT_STEPS(apps)}`);
    return 0;
  } catch (e) {
    say(`\nThe Android setup stopped: ${e.message}. What was already installed stays; running setup again continues from there.`);
    return 1;
  }
}
