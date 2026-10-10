// The Wingman's own Android emulator (the virtual phone called "wingman"): finding it among the
// running devices, starting it, stopping it, and the hardware acceleration it needs.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AndroidDriver } from "../drivers/android.mjs";
import { AVD_NAME } from "./sdk.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const adbDriver = (adb, env) => new AndroidDriver({ adb: typeof adb === "string" ? { exe: adb, args: [] } : adb, env });

// The running emulator whose virtual phone is "wingman": { serial, state } or null.
export async function findWingman(d) {
  let list = [];
  try { list = await d.devices(); } catch { return null; }
  for (const x of list.filter((y) => y.serial.startsWith("emulator-"))) {
    const r = await d.run(["-s", x.serial, "emu", "avd", "name"], { timeoutMs: 10000 }).catch(() => null);
    if (r && String(r.out).split(/\r?\n/)[0].trim() === AVD_NAME) return x;
  }
  return null;
}

export async function booted(d, serial) {
  const r = await d.run(["-s", serial, "shell", "getprop", "sys.boot_completed"], { timeoutMs: 10000 }).catch(() => null);
  return !!r && String(r.out).trim() === "1";
}

// Starts the emulator (a window, or none with headless) and waits until Android has finished
// starting. Returns { serial, started } or throws with plain words.
export async function startEmulator({ parts, home, env, headless = false, print = console.log, spawnImpl = spawn, waitMs = 300000, everyMs = 3000, d = adbDriver(parts.adb, env) }) {
  if (!parts.emulator || !parts.adb) throw new Error("The emulator is not installed yet; run `godspeed-wingman android setup` first.");
  if (!fs.existsSync(path.join(home, "avd", `${AVD_NAME}.ini`))) throw new Error(`The virtual phone "${AVD_NAME}" does not exist yet; run \`godspeed-wingman android setup\` first.`);
  const running = await findWingman(d);
  if (running?.state === "device" && (await booted(d, running.serial))) return { serial: running.serial, started: false };
  if (!running) {
    fs.mkdirSync(home, { recursive: true });
    const log = fs.openSync(path.join(home, "emulator.log"), "a");
    const args = ["-avd", AVD_NAME, "-no-boot-anim", ...(headless ? ["-no-window", "-no-audio"] : [])];
    const c = spawnImpl(parts.emulator, args, { env, detached: true, stdio: ["ignore", log, log], windowsHide: headless });
    c.unref?.();
    print(`Starting the emulator${headless ? " without a window" : ""}. The first start takes a few minutes.`);
  }
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const w = await findWingman(d);
    if (w?.state === "device" && (await booted(d, w.serial))) return { serial: w.serial, started: true };
    await sleep(everyMs);
  }
  throw new Error(`The emulator did not finish starting within ${Math.round(waitMs / 60000)} minutes. Its log is ${path.join(home, "emulator.log")}.`);
}

export async function stopEmulator({ parts, env, d = adbDriver(parts.adb, env) }) {
  const w = await findWingman(d);
  if (!w) return { stopped: false };
  await d.run(["-s", w.serial, "emu", "kill"], { timeoutMs: 15000 });
  return { stopped: true, serial: w.serial };
}

// Before the emulator is installed: is hardware acceleration likely there? { state: on|off|unknown, why }.
export function accelPrecheck({ platform = process.platform, run = spawnSync, access = fs.accessSync } = {}) {
  if (platform === "win32") {
    const r = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -ClassName Win32_OptionalFeature -Filter \"Name='HypervisorPlatform'\").InstallState"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    const v = String(r.stdout || "").trim();
    if (v === "1") return { state: "on", why: "the Windows Hypervisor Platform is switched on" };
    if (v === "2" || v === "0" || v === "3") return { state: "off", why: "the Windows Hypervisor Platform is switched off" };
    return { state: "unknown", why: "Windows did not say whether the Windows Hypervisor Platform is on" };
  }
  if (platform === "darwin") {
    const r = run("sysctl", ["-n", "kern.hv_support"], { encoding: "utf8" });
    return String(r.stdout || "").trim() === "1" ? { state: "on", why: "this Mac offers its hypervisor" } : { state: "unknown", why: "this Mac did not say whether its hypervisor is there" };
  }
  try { access("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK); return { state: "on", why: "/dev/kvm is there and usable" }; }
  catch (e) { return { state: "off", why: e.code === "ENOENT" ? "/dev/kvm is missing (KVM is not installed or not switched on)" : "/dev/kvm is there, but this account may not use it" }; }
}

// What to do when acceleration is missing, in plain words.
export function accelHelp(platform = process.platform) {
  if (platform === "win32") {
    return [
      "The Android emulator needs the Windows Hypervisor Platform, a part of Windows that is switched off on many computers.",
      "To switch it on: open \"Turn Windows features on or off\" from the Start menu, tick \"Windows Hypervisor Platform\", press OK, and restart the computer.",
      "Or, in a PowerShell opened as administrator: Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform (then restart).",
      "It also needs hardware virtualisation (Intel VT-x or AMD-V, sometimes called SVM) switched on in the computer's firmware settings; most computers have it on.",
    ].join("\n");
  }
  if (platform === "darwin") return "The Android emulator needs the Mac's own hypervisor. Macs from 2010 on have it; on a Mac that runs inside another virtual machine it is missing.";
  return [
    "The Android emulator needs KVM, the Linux kernel's hardware virtualisation.",
    "Install it (on Ubuntu or Debian: sudo apt install qemu-kvm), add yourself to the kvm group (sudo adduser $USER kvm), then log out and in again.",
    "On a rented server KVM is often not offered at all; then the emulator cannot run there.",
  ].join("\n");
}
