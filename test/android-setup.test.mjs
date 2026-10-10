// The Android setup without the internet and without installing anything: the download addresses
// come from saved copies of Google's lists (test/fixtures/android, excerpts of the real lists of
// 2026-10-10), the network and the SDK's programs are pretend ones. What it must get right: never
// a hard-coded version, nothing downloaded before the person accepted the licence (and said yes to
// Java), every download checked against its checksum, a dry run that only looks.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as sdk from "../lib/android/sdk.mjs";
import * as java from "../lib/android/java.mjs";
import { unzip, download } from "../lib/android/files.mjs";
import { setup, toolCommand, NEED_BYTES } from "../lib/android/setup.mjs";
import { accelHelp, accelPrecheck } from "../lib/android/emulator.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "android");
const REPO = fs.readFileSync(path.join(FIX, "repository2-3.xml"), "utf8");
const IMAGES = fs.readFileSync(path.join(FIX, "sys-img2-3-playstore.xml"), "utf8");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// A zip, written here byte by byte (stored or deflated entries, Unix rights).
export function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const dir = e.name.endsWith("/");
    const method = dir || e.store ? 0 : 8;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((e.mode ?? (dir ? 0o40755 : 0o100644)) * 0x10000 >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// A pretend internet: url -> body (or a function); "prefix*" matches the start of an address.
function fakeFetch(routes, calls = []) {
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET" });
    let r = routes[u];
    if (r === undefined) r = Object.entries(routes).find(([k]) => k.endsWith("*") && u.startsWith(k.slice(0, -1)))?.[1];
    if (r === undefined) return new Response("not here", { status: 404 });
    if (typeof r === "function") return r(u, init);
    return new Response(init.method === "HEAD" ? null : r, { status: 200 });
  };
  f.calls = calls;
  return f;
}

const TEMURIN = (link) => [{ binary: { package: { name: path.basename(link), link, checksum: "ab".repeat(32), size: 190_000_000 } } }];

test("the command-line tools come from Google's list, for each kind of computer, never a fixed version", () => {
  const win = sdk.cmdlineTools(REPO, sdk.host({ platform: "win32", arch: "x64" }));
  assert.deepEqual(win, { path: "cmdline-tools;latest", version: "23.0", url: "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip", size: 154957218, sha1: "57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d", license: "android-sdk-license" });
  assert.equal(sdk.cmdlineTools(REPO, sdk.host({ platform: "linux", arch: "x64" })).url, "https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip");
  assert.equal(sdk.cmdlineTools(REPO, sdk.host({ platform: "darwin", arch: "arm64" })).url, "https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip");
  assert.equal(sdk.cmdlineTools(REPO, sdk.host({ platform: "darwin", arch: "x64" })).url, "https://dl.google.com/android/repository/commandlinetools-mac_x86_64-16111833_latest.zip");
  // Without a "latest" entry: the newest stable numbered one, never an alpha or an obsolete one.
  const noLatest = REPO.replace(/<remotePackage path="cmdline-tools;latest">[\s\S]*?<\/remotePackage>/, "");
  const r = sdk.cmdlineTools(noLatest, sdk.host({ platform: "linux", arch: "x64" }));
  assert.equal(r.path, "cmdline-tools;23.0");
  assert.throws(() => sdk.cmdlineTools("<x/>", sdk.host({ platform: "linux" })), /no command-line tools for linux/);
});

test("the system image is the newest stable plain Google Play one for the computer's processor", () => {
  const x = sdk.systemImage(IMAGES, sdk.host({ platform: "win32", arch: "x64" }));
  assert.equal(x.path, "system-images;android-37.0;google_apis_playstore;x86_64", "not 37.2 with 16k pages, not a beta, not CANARY, not an extension level");
  assert.equal(x.license, "android-sdk-license");
  assert.equal(x.url, "https://dl.google.com/android/repository/sys-img/google_apis_playstore/x86_64-37.0_r06.zip");
  const arm = sdk.systemImage(IMAGES, sdk.host({ platform: "darwin", arch: "arm64" }));
  assert.equal(arm.path, "system-images;android-37.0;google_apis_playstore;arm64-v8a");
  assert.equal(arm.license, "android-sdk-arm-dbt-license");
  assert.match(sdk.licenseText(REPO, "android-sdk-license"), /^Terms and Conditions/);
});

test("an SDK already on the machine is found: the environment, the Wingman's own, Android Studio's folder", () => {
  const root = tmp("wingman-sdk-");
  const exe = process.platform === "win32" ? ".exe" : "";
  fs.mkdirSync(path.join(root, "platform-tools"), { recursive: true });
  fs.writeFileSync(path.join(root, "platform-tools", `adb${exe}`), "");
  const none = { GODSPEED_WINGMAN_ANDROID_HOME: tmp("wingman-ah-"), LOCALAPPDATA: tmp("wingman-la-") };
  const home = tmp("wingman-home-");
  assert.equal(sdk.findSdk({ env: none, home }), null);
  assert.equal(sdk.findSdk({ env: { ...none, ANDROID_HOME: root }, home }).adb, path.join(root, "platform-tools", `adb${exe}`));
  const studio = process.platform === "win32" ? path.join(none.LOCALAPPDATA, "Android", "Sdk") : process.platform === "darwin" ? path.join(home, "Library", "Android", "sdk") : path.join(home, "Android", "Sdk");
  fs.mkdirSync(path.join(studio, "emulator"), { recursive: true });
  fs.writeFileSync(path.join(studio, "emulator", `emulator${exe}`), "");
  assert.equal(sdk.findSdk({ env: none, home }).root, path.resolve(studio));
  assert.deepEqual(sdk.sdkCandidates({ env: { ANDROID_HOME: "/a", ANDROID_SDK_ROOT: "/b", GODSPEED_WINGMAN_ANDROID_HOME: "/c" }, platform: "linux", home: "/h" }).map((p) => p.replace(/\\/g, "/").replace(/^[A-Z]:/, "")), ["/a", "/b", "/c/sdk", "/h/Android/Sdk"]);
});

test("Java: 17 or newer, from JAVA_HOME, the Wingman's own folder or PATH; an older one is named", () => {
  assert.equal(java.majorOf('openjdk version "17.0.12" 2024-07-16'), 17);
  assert.equal(java.majorOf('java version "1.8.0_401"'), 8);
  assert.equal(java.majorOf('openjdk version "21" 2023-09-19'), 21);
  assert.equal(java.majorOf("nothing"), null);
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const old = tmp("wingman-jdk8-"), ah = tmp("wingman-ah-");
  fs.mkdirSync(path.join(old, "bin"));
  fs.writeFileSync(path.join(old, "bin", exe), "");
  const own = path.join(ah, "jdk", "jdk-17.0.20+1");
  fs.mkdirSync(path.join(own, "bin"), { recursive: true });
  fs.writeFileSync(path.join(own, "bin", exe), "");
  const versionOf = (p) => (p.startsWith(old) ? 8 : 17);
  const j = java.findJava({ env: { JAVA_HOME: old, PATH: "" }, androidHome: ah, versionOf, home: tmp("h-") });
  assert.equal(j.exe, path.join(own, "bin", exe));
  assert.equal(j.version, 17);
  const none = java.findJava({ env: { JAVA_HOME: old, PATH: "" }, androidHome: tmp("ah-"), versionOf, home: tmp("h-") });
  assert.deepEqual([none.exe, none.older.version], [null, 8]);
  assert.match(java.temurinQuery({ platform: "darwin", arch: "arm64" }), /os=mac&architecture=aarch64&image_type=jdk&vendor=eclipse$/);
  assert.equal(java.pickTemurin(TEMURIN("https://github.com/adoptium/x/OpenJDK17U-jdk_x64_linux_hotspot_17.tar.gz")).kind, "tar.gz");
  assert.throws(() => java.pickTemurin([{ binary: { package: { name: "a.zip", link: "http://plain.example/a.zip" } } }]), /not https/);
});

// A machine with no SDK and (unless given) no Java, where nothing is real.
function sandbox({ javaThere = false, free = 100 * 1024 ** 3, routes = {}, isTTY = false, answers = [] } = {}) {
  const base = tmp("wingman-android-");
  const env = { PATH: "", LOCALAPPDATA: path.join(base, "local"), GODSPEED_WINGMAN_ANDROID_HOME: path.join(base, "android"), ComSpec: process.env.ComSpec || "cmd.exe", SystemRoot: process.env.SystemRoot };
  if (javaThere) {
    const jh = path.join(base, "java");
    fs.mkdirSync(path.join(jh, "bin"), { recursive: true });
    fs.writeFileSync(path.join(jh, "bin", process.platform === "win32" ? "java.exe" : "java"), "");
    env.JAVA_HOME = jh;
  }
  const printed = [];
  const asked = [];
  const f = fakeFetch({ [sdk.REPO_XML]: REPO, [sdk.SYSIMG_XML]: IMAGES, ...routes });
  const sys = {
    env, home: path.join(base, "home"), fetch: f, isTTY, print: (s) => printed.push(s),
    ask: async (q) => { asked.push(q); return answers.shift() ?? false; },
    accel: () => ({ state: "on", why: "a test" }), freeSpace: () => free, versionOf: () => 17,
  };
  return { base, env, sys, printed, asked, fetch: f, home: env.GODSPEED_WINGMAN_ANDROID_HOME, text: () => printed.join("\n") };
}

test("a dry run shows the plan and asks every download address without downloading anything", async () => {
  const s = sandbox({ routes: { "https://api.adoptium.net/*": () => Response.json(TEMURIN("https://github.com/adoptium/temurin17-binaries/releases/download/x/OpenJDK17U.zip")), "https://dl.google.com/android/repository/*": "big", "https://github.com/*": "big" } });
  const code = await setup({ "dry-run": true }, s.sys);
  assert.equal(code, 0, s.text());
  const out = s.text();
  assert.match(out, /Android SDK: none found, so one goes into/);
  assert.match(out, /Java: MISSING\. Java 17 or newer is needed; Eclipse Temurin JDK 17 would be fetched from adoptium\.net/);
  assert.match(out, /command-line tools: version 23\.0 from https:\/\/dl\.google\.com\/android\/repository\/commandlinetools-/);
  assert.match(out, /to install: platform-tools, emulator, system-images;android-37\.0;google_apis_playstore;/);
  assert.match(out, /licence you accept before anything is installed: android-sdk-license/);
  assert.match(out, /nothing was downloaded, installed or changed/);
  const big = s.fetch.calls.filter((c) => /\.zip$/.test(c.url));
  assert.ok(big.length >= 3, "the command-line tools, the system image and Java were asked");
  assert.ok(big.every((c) => c.method === "HEAD"), "only asked, never fetched");
  assert.equal(fs.existsSync(s.home), false, "nothing was written");
});

test("a dry run says FAIL for an address that does not answer", async () => {
  const s = sandbox({ javaThere: true, routes: { "https://dl.google.com/android/repository/sys-img/*": "big" } });
  assert.equal(await setup({ "dry-run": true }, s.sys), 1);
  assert.match(s.text(), /FAIL the command-line tools: https:\/\/dl\.google\.com\/android\/repository\/commandlinetools-.*\(404\)/);
});

test("nothing is downloaded before the person accepted the licence", async () => {
  const s = sandbox({ javaThere: true });
  assert.equal(await setup({}, s.sys), 1);
  assert.match(s.text(), /The Android SDK licence has to be accepted by you before anything is installed\. Read it at https:\/\/developer\.android\.com\/studio\/terms\. If you accept it, run: godspeed-wingman android setup --accept-licenses/);
  const t = sandbox({ javaThere: true, isTTY: true, answers: [false] });
  assert.equal(await setup({}, t.sys), 1);
  assert.match(t.text(), /----- android-sdk-license -----\nTerms and Conditions/, "the licence text is shown");
  assert.deepEqual(t.asked, ["Do you accept the Android SDK licence above? [y/N]"]);
  assert.match(t.text(), /Then nothing is installed/);
  for (const x of [s, t]) {
    assert.deepEqual(x.fetch.calls.map((c) => c.url).sort(), [sdk.REPO_XML, sdk.SYSIMG_XML].sort());
    assert.equal(fs.existsSync(x.home), false);
  }
});

test("Java is fetched only after a yes", async () => {
  const s = sandbox({ javaThere: false });
  assert.equal(await setup({ "accept-licenses": true }, s.sys), 1);
  assert.match(s.text(), /Install Java 17 or newer yourself, or run again with --yes to let the Wingman fetch it/);
  assert.equal(s.fetch.calls.length, 2);
  const t = sandbox({ javaThere: false, isTTY: true, answers: [true, false] });
  assert.equal(await setup({}, t.sys), 1);
  assert.match(t.asked[1], /^Java 17 is needed and is not on this computer\. Fetch Eclipse Temurin JDK 17 from adoptium\.net into .*jdk\? \[y\/N\]$/);
  assert.equal(t.fetch.calls.length, 2);
});

test("not enough room on the disk: nothing is downloaded", async () => {
  const s = sandbox({ javaThere: true, free: NEED_BYTES - 1 });
  assert.equal(await setup({ "accept-licenses": true }, s.sys), 1);
  assert.match(s.text(), /There is not enough room: .* free, about 15\.0 GB needed\. Nothing was downloaded\./);
  assert.equal(s.fetch.calls.length, 2);
});

// The SDK's programs, pretended: each leaves behind what the real one would.
function fakeTools(s, { accelOk = true } = {}) {
  const calls = [];
  const h = sdk.host();
  const sdkRoot = path.join(s.home, "sdk");
  s.sys.spawn = (exe, args, opts) => {
    const line = [exe, ...args].join(" ");
    const call = { line, input: "" };
    calls.push(call);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on() {}, end(x) { call.input = x || ""; } };
    child.kill = () => {};
    setImmediate(() => {
      let code = 0, out = "";
      if (/sdkmanager/.test(line) && /--install/.test(line)) {
        for (const [d, f] of [["platform-tools", `adb${h.exe}`], ["emulator", `emulator${h.exe}`], [path.join("system-images", "android-37.0", "google_apis_playstore", h.abi), "system.img"]]) {
          fs.mkdirSync(path.join(sdkRoot, d), { recursive: true });
          fs.writeFileSync(path.join(sdkRoot, d, f), "");
        }
      } else if (/avdmanager/.test(line)) {
        fs.mkdirSync(path.join(s.home, "avd", "wingman.avd"), { recursive: true });
        fs.writeFileSync(path.join(s.home, "avd", "wingman.ini"), "path=x\n");
        fs.writeFileSync(path.join(s.home, "avd", "wingman.avd", "config.ini"), "hw.keyboard=no\nhw.lcd.density=420\n");
      } else if (/-accel-check/.test(line)) {
        code = accelOk ? 0 : 1;
        out = accelOk ? "accel:\n0\nWHPX is installed and usable.\naccel" : "accel:\n9\nWHPX is not installed on this computer\naccel";
      }
      child.stdout.emit("data", out);
      child.emit("close", code);
    });
    return child;
  };
  return { calls, sdkRoot };
}

function cmdlineZip() {
  const bin = (n) => `cmdline-tools/bin/${n}${sdk.host().bat}`;
  const zip = makeZip([
    { name: "cmdline-tools/" }, { name: "cmdline-tools/bin/" },
    { name: bin("sdkmanager"), data: "@echo pretend\n", mode: 0o100755 },
    { name: bin("avdmanager"), data: "@echo pretend\n", mode: 0o100755 },
    { name: "cmdline-tools/lib/sdkmanager-classpath.jar", data: "x".repeat(5000) },
  ]);
  const sha1 = crypto.createHash("sha1").update(zip).digest("hex");
  const repo = REPO.replace(/<remotePackage path="cmdline-tools;latest">[\s\S]*?<\/remotePackage>/, (b) => b.replace(/<checksum type="sha1">[0-9a-f]+<\/checksum>/g, `<checksum type="sha1">${sha1}</checksum>`));
  return { zip, repo };
}

test("the install, after the person's yes: checked download, sdkmanager, the virtual phone, the acceleration check", async () => {
  const { zip, repo } = cmdlineZip();
  const s = sandbox({ javaThere: true, routes: { [sdk.REPO_XML]: repo, "https://dl.google.com/android/repository/commandlinetools-*": zip } });
  const t = fakeTools(s);
  const code = await setup({ "accept-licenses": true, "no-start": true }, s.sys);
  assert.equal(code, 0, s.text());
  assert.ok(fs.existsSync(path.join(t.sdkRoot, "cmdline-tools", "latest", "bin", `sdkmanager${sdk.host().bat}`)), "unpacked into cmdline-tools/latest");
  assert.deepEqual(fs.readdirSync(path.join(s.home, "downloads")), [], "the download was removed after unpacking");
  const lines = t.calls.map((c) => c.line);
  assert.match(lines[0], /sdkmanager.*--licenses/);
  assert.match(t.calls[0].input, /^(y\n){40}$/);
  assert.match(lines[1], /sdkmanager.*--install.*platform-tools.*emulator.*system-images;android-37\.0;google_apis_playstore;/);
  assert.match(lines[2], /avdmanager.*create.*avd.*-n.*wingman.*-k.*system-images;android-37\.0;google_apis_playstore;.*-d.*pixel_7/);
  assert.equal(t.calls[2].input, "no\n", "no custom hardware profile");
  assert.match(lines[3], /emulator.*-accel-check/);
  if (process.platform === "win32") assert.match(lines[0], /^\S*cmd\.exe \/d \/s \/c "".*sdkmanager\.bat" "--sdk_root=/i, "a .bat runs through cmd with every part quoted");
  const ini = fs.readFileSync(path.join(s.home, "avd", "wingman.avd", "config.ini"), "utf8");
  assert.match(ini, /^hw\.keyboard=yes$/m);
  assert.match(ini, /^PlayStore\.enabled=true$/m);
  assert.match(ini, /^hw\.lcd\.density=420$/m, "the rest stays");
  const config = sdk.readConfig(s.home);
  assert.equal(config.sdk, t.sdkRoot);
  assert.equal(config.avd, "wingman");
  assert.match(s.text(), /You accepted the Android SDK licence \(android-sdk-license, https:\/\/developer\.android\.com\/studio\/terms\) with --accept-licenses\./);
  assert.match(s.text(), /Installed\. Start the emulator with: godspeed-wingman android start/);
});

test("no hardware acceleration: everything is installed, and the person is told plainly what to switch on", async () => {
  const { zip, repo } = cmdlineZip();
  const s = sandbox({ javaThere: true, routes: { [sdk.REPO_XML]: repo, "https://dl.google.com/android/repository/commandlinetools-*": zip } });
  fakeTools(s, { accelOk: false });
  assert.equal(await setup({ "accept-licenses": true }, s.sys), 1);
  assert.match(s.text(), /Everything is installed, but the emulator cannot use hardware acceleration on this computer/);
  assert.ok(s.text().includes(accelHelp(process.platform)));
  assert.ok(sdk.readConfig(s.home), "what was installed is recorded");
});

test("a damaged download is refused and removed", async () => {
  const dir = tmp("wingman-dl-");
  const file = path.join(dir, "tools.zip");
  const f = fakeFetch({ "https://dl.google.com/x.zip": Buffer.from("the real bytes") });
  await assert.rejects(download("https://dl.google.com/x.zip", file, { hash: { algo: "sha1", hex: "0".repeat(40) }, fetchImpl: f }), /is damaged \(its sha1 does not match the list\), so it was deleted/);
  assert.deepEqual(fs.readdirSync(dir), []);
  const good = crypto.createHash("sha256").update("the real bytes").digest("hex");
  await download("https://dl.google.com/x.zip", file, { hash: { algo: "sha256", hex: good }, fetchImpl: f });
  assert.equal(fs.readFileSync(file, "utf8"), "the real bytes");
  await assert.rejects(download("http://dl.google.com/x.zip", file, { fetchImpl: f }), /not https/);
});

test("the zip reader: stored and packed files, Unix rights kept, nothing outside its folder", () => {
  const dir = tmp("wingman-zip-");
  const z = path.join(dir, "a.zip");
  fs.writeFileSync(z, makeZip([{ name: "top/" }, { name: "top/run", data: "#!/bin/sh\necho hi\n", mode: 0o100755 }, { name: "top/notes.txt", data: "plain ".repeat(100), store: true }]));
  unzip(z, path.join(dir, "out"));
  assert.equal(fs.readFileSync(path.join(dir, "out", "top", "notes.txt"), "utf8"), "plain ".repeat(100));
  assert.equal(fs.readFileSync(path.join(dir, "out", "top", "run"), "utf8"), "#!/bin/sh\necho hi\n");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "out", "top", "run")).mode & 0o777, 0o755);
  fs.writeFileSync(z, makeZip([{ name: "../escape.txt", data: "x" }]));
  assert.throws(() => unzip(z, path.join(dir, "out2")), /a path outside its folder/);
  assert.equal(fs.existsSync(path.join(dir, "escape.txt")), false);
  fs.writeFileSync(z, "not a zip at all");
  assert.throws(() => unzip(z, path.join(dir, "out3")), /is not a zip file/);
});

test("a .bat runs through cmd.exe with every part quoted; other programs run directly", () => {
  const c = toolCommand("C:\\Users\\Kiri Test\\sdk\\sdkmanager.bat", ["--install", "system-images;android-37.0;google_apis_playstore;x86_64"], "win32", { ComSpec: "C:\\Windows\\system32\\cmd.exe" });
  assert.deepEqual(c, { exe: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c", '""C:\\Users\\Kiri Test\\sdk\\sdkmanager.bat" "--install" "system-images;android-37.0;google_apis_playstore;x86_64""'], verbatim: true });
  assert.deepEqual(toolCommand("/opt/sdk/bin/sdkmanager", ["--list"], "linux"), { exe: "/opt/sdk/bin/sdkmanager", args: ["--list"], verbatim: false });
});

test("hardware acceleration: read without installing anything, and explained in plain words", () => {
  const ps = (out) => () => ({ stdout: out });
  assert.equal(accelPrecheck({ platform: "win32", run: ps("2\r\n") }).state, "off");
  assert.equal(accelPrecheck({ platform: "win32", run: ps("1\r\n") }).state, "on");
  assert.equal(accelPrecheck({ platform: "win32", run: ps("") }).state, "unknown");
  assert.equal(accelPrecheck({ platform: "linux", access: () => {} }).state, "on");
  assert.match(accelPrecheck({ platform: "linux", access: () => { const e = new Error("x"); e.code = "ENOENT"; throw e; } }).why, /\/dev\/kvm is missing/);
  assert.match(accelHelp("win32"), /Windows Hypervisor Platform/);
  assert.match(accelHelp("win32"), /Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform/);
  assert.match(accelHelp("linux"), /sudo adduser \$USER kvm/);
  for (const p of ["win32", "linux", "darwin"]) assert.ok(!accelHelp(p).includes("\u2014"), "no em dash");
});
