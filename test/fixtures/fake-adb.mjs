// A pretend adb for the tests: no device, no SDK. It reads what the "device" shows from a JSON file
// (FAKE_ADB) and writes every call it gets, one JSON line each, next to it (FAKE_ADB + ".log").
//
// The JSON: { devices: [[serial, state]...], booted: "1", screens: [xml...] (each `cat` of the
// screen file gives the next one, the last one stays), png: base64, packages: [..], focus: "pkg/Act",
// size: "1080x2400", avd: "wingman" }
import fs from "node:fs";

const file = process.env.FAKE_ADB;
const st = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(`${file}.log`, JSON.stringify(args) + "\n");
const out = (s) => process.stdout.write(s);
const save = () => fs.writeFileSync(file, JSON.stringify(st));

let a = args;
if (a[0] === "devices") {
  out(`List of devices attached\n${(st.devices || []).map(([s, state]) => `${s}\t${state}`).join("\n")}\n\n`);
  process.exit(0);
}
if (a[0] === "-s") a = a.slice(2);
const [where, ...rest] = a;
const cmd = rest.join(" ");
if (where === "emu") {
  if (cmd === "avd name") out(`${st.avd || "wingman"}\r\nOK\r\n`);
  else out("OK\r\n");
  process.exit(0);
}
if (where === "exec-out" && cmd === "screencap -p") { process.stdout.write(Buffer.from(st.png, "base64")); process.exit(0); }
if (where === "exec-out" && rest[0] === "cat") {
  const screens = st.screens || [];
  const i = Math.min(st.screenAt || 0, screens.length - 1);
  out(screens[i] || "");
  st.screenAt = Math.min((st.screenAt || 0) + 1, screens.length - 1);
  save();
  process.exit(0);
}
if (where === "shell") {
  if (cmd === "getprop sys.boot_completed") { out(`${st.booted ?? "1"}\n`); process.exit(0); }
  if (rest[0] === "uiautomator") { out(`UI hierchary dumped to: ${rest[2]}\n`); process.exit(0); }
  if (rest[0] === "input") process.exit(0);
  if (rest[0] === "wm") { out(`Physical size: ${st.size || "1080x2400"}\n`); process.exit(0); }
  if (rest[0] === "monkey") {
    if ((st.packages || []).includes(rest[2])) { out("Events injected: 1\n"); process.exit(0); }
    out("** No activities found to run, monkey aborted.\n");
    process.exit(252);
  }
  if (rest[0] === "dumpsys") { out(`  mCurrentFocus=Window{1a2b3c u0 ${st.focus || "com.android.launcher3/.Launcher"}}\n`); process.exit(0); }
  if (rest[0] === "pm" && rest[1] === "path") {
    if ((st.packages || []).includes(rest[2])) { out(`package:/data/app/${rest[2]}/base.apk\n`); process.exit(0); }
    process.exit(1);
  }
}
process.stderr.write(`fake adb does not know: ${args.join(" ")}\n`);
process.exit(1);
