// The Wingman's own emulator, with the pretend adb: found among other devices by its name
// "wingman", started (with or without a window) and waited for, stopped. No real emulator runs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeAdb } from "./fixtures/adb.mjs";
import { adbDriver, findWingman, startEmulator, stopEmulator } from "../lib/android/emulator.mjs";

function installed() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-emu-"));
  fs.mkdirSync(path.join(home, "avd"), { recursive: true });
  fs.writeFileSync(path.join(home, "avd", "wingman.ini"), "path=x\n");
  return { home, parts: { adb: "adb", emulator: path.join(home, "emulator.exe") } };
}

test("the Wingman's emulator is found by its name among the devices", async () => {
  const f = fakeAdb({ devices: [["R58M00TEST", "device"], ["emulator-5556", "device"]], avd: "wingman" });
  assert.deepEqual(await findWingman(adbDriver(f.adb, f.env)), { serial: "emulator-5556", state: "device" });
  const g = fakeAdb({ devices: [["emulator-5554", "device"]], avd: "pixel_of_someone_else" });
  assert.equal(await findWingman(adbDriver(g.adb, g.env)), null, "another emulator is not the Wingman's");
});

test("start: starts the emulator, waits until Android has started, and says so; a running one is left alone", async () => {
  const { home, parts } = installed();
  const f = fakeAdb({ devices: [] });
  const started = [];
  const spawnImpl = (exe, args, opts) => {
    started.push({ exe, args, detached: opts.detached });
    const st = JSON.parse(fs.readFileSync(f.file, "utf8"));
    st.devices = [["emulator-5554", "device"]];
    fs.writeFileSync(f.file, JSON.stringify(st));
    return { unref() {} };
  };
  const printed = [];
  const r = await startEmulator({ parts, home, env: f.env, headless: true, print: (s) => printed.push(s), spawnImpl, everyMs: 10, d: adbDriver(f.adb, f.env) });
  assert.deepEqual(r, { serial: "emulator-5554", started: true });
  assert.deepEqual(started, [{ exe: parts.emulator, args: ["-avd", "wingman", "-no-boot-anim", "-no-window", "-no-audio"], detached: true }]);
  assert.match(printed[0], /^Starting the emulator without a window\./);
  const again = await startEmulator({ parts, home, env: f.env, spawnImpl: () => { throw new Error("must not start twice"); }, d: adbDriver(f.adb, f.env) });
  assert.deepEqual(again, { serial: "emulator-5554", started: false });
});

test("start says plainly what is missing, and gives up after the time it may take", async () => {
  const { home, parts } = installed();
  const f = fakeAdb({ devices: [] });
  await assert.rejects(startEmulator({ parts: { ...parts, emulator: null }, home, env: f.env }), /The emulator is not installed yet; run `godspeed-wingman android setup` first\./);
  await assert.rejects(startEmulator({ parts, home: path.join(home, "elsewhere"), env: f.env, d: adbDriver(f.adb, f.env) }), /The virtual phone "wingman" does not exist yet/);
  await assert.rejects(startEmulator({ parts, home, env: f.env, spawnImpl: () => ({ unref() {} }), waitMs: 50, everyMs: 10, print: () => {}, d: adbDriver(f.adb, f.env) }), /did not finish starting within 0 minutes\. Its log is .*emulator\.log/);
});

test("stop asks only the Wingman's emulator to close", async () => {
  const f = fakeAdb({ devices: [["emulator-5554", "device"]] });
  assert.deepEqual(await stopEmulator({ parts: { adb: "adb" }, env: f.env, d: adbDriver(f.adb, f.env) }), { stopped: true, serial: "emulator-5554" });
  assert.deepEqual(f.calls().at(-1), ["-s", "emulator-5554", "emu", "kill"]);
  const g = fakeAdb({ devices: [] });
  assert.deepEqual(await stopEmulator({ parts: { adb: "adb" }, env: g.env, d: adbDriver(g.adb, g.env) }), { stopped: false });
});
