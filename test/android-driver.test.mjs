// The Android driver against a pretend adb (test/fixtures/fake-adb.mjs): which device it picks, the
// screen as a list of nodes, taps, swipes, typing with the device shell's quoting, apps, and the
// read-only guard `site check` puts around it. No device and no SDK needed. Everyone on the
// pretend screens is invented.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createDriver, parseNodes, typingChunks, nodeAt, center } from "../lib/drivers/android.mjs";
import { readOnlyAndroid, ReadOnlyError } from "../lib/sites/guard.mjs";
import { fakeAdb, CARD, BLANK } from "./fixtures/adb.mjs";

const driverOn = (f, settings = {}) => createDriver({ settings, adb: f.adb, env: f.env });
const inputs = (f) => f.calls().filter((c) => c.includes("input"));

test("the driver picks the only emulator, or the device the settings name, and says plainly when it cannot", async () => {
  let f = fakeAdb();
  assert.equal(await driverOn(f).device(), "emulator-5554");
  f = fakeAdb({ devices: [["emulator-5554", "device"], ["R58M00TEST", "device"]] });
  assert.equal(await driverOn(f).device(), "emulator-5554", "a phone on USB is never chosen by itself");
  assert.equal(await driverOn(f, { android_device: "R58M00TEST" }).device(), "R58M00TEST");
  await assert.rejects(driverOn(f, { android_device: "emulator-5556" }).device(), /android_device: emulator-5556\) is not connected/);
  f = fakeAdb({ devices: [["emulator-5554", "device"], ["emulator-5556", "device"]] });
  await assert.rejects(driverOn(f).device(), /Several Android emulators are running; name the Wingman's in the settings as android_device/);
  f = fakeAdb({ devices: [] });
  await assert.rejects(driverOn(f).device(), /No Android emulator is running; start it with `godspeed-wingman android start`/);
  f = fakeAdb({ devices: [["R58M00TEST", "device"]] });
  await assert.rejects(driverOn(f).device(), /not an emulator/);
  f = fakeAdb({ devices: [["emulator-5554", "offline"]] });
  await assert.rejects(driverOn(f).device(), /is offline, not ready yet/);
});

test("health waits for the emulator to finish starting", async () => {
  assert.deepEqual(await driverOn(fakeAdb()).health(), { status: "ok", device: "emulator-5554" });
  await assert.rejects(driverOn(fakeAdb({ booted: "0" })).health(), /still starting/);
});

test("the screen picture is a PNG, also in the browser's capture shape", async () => {
  const f = fakeAdb();
  const d = driverOn(f);
  const png = await d.screencap();
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.deepEqual(await d.capture().then((c) => [c.capture, c.size]), ["viewport", "1x1"]);
  assert.deepEqual(f.calls().at(-1), ["-s", "emulator-5554", "exec-out", "screencap", "-p"]);
});

test("the screen is read into nodes: text, description, id, class, bounds, clickable, parents", async () => {
  const nodes = await driverOn(fakeAdb()).dump();
  assert.equal(nodes.length, 7);
  const bio = nodes.find((n) => n.id.endsWith(":id/card_bio"));
  assert.equal(bio.text, 'Loves hiking & board games \nand "bad" puns');
  assert.equal(bio.class, "android.widget.TextView");
  assert.deepEqual(bio.bounds, [40, 1600, 1040, 1800]);
  assert.equal(bio.parent, 0);
  const passIcon = nodes.find((n) => n.desc === "Pass");
  assert.equal(nodes[passIcon.parent].id, "com.example.dating:id/pass_button");
  assert.equal(nodes[passIcon.parent].clickable, true);
  assert.equal(passIcon.depth, 2);
  assert.equal(nodeAt(nodes, 250, 2200).desc, "Pass", "the deepest node at a point");
  assert.deepEqual(center(bio), [540, 1700]);
  assert.deepEqual(parseNodes("<hierarchy></hierarchy>"), []);
});

test("taps land on the middle of a node found by text, id or description", async () => {
  const f = fakeAdb();
  const d = driverOn(f);
  await d.tapText("Mara, 27");
  await d.tapId("card_bio");
  await d.tapDesc("Like");
  await d.tapText("mess", { contains: true });
  await d.tap(10, 20);
  assert.deepEqual(inputs(f).map((c) => c.slice(3).join(" ")), ["input tap 370 1540", "input tap 540 1700", "input tap 800 2200", "input tap 270 2350", "input tap 10 20"]);
  await assert.rejects(d.tapText("Juno"), /nothing on the screen says "Juno"/);
  await assert.rejects(d.tap("1; reboot", 2), /x must be a number on the screen/);
});

test("swipes and scrolls are numbers only; a scroll uses the screen's size", async () => {
  const f = fakeAdb({ size: "1000x2000" });
  const d = driverOn(f);
  await d.swipe(500, 1500, 500, 500, 250);
  await d.scroll("down");
  await d.scroll("up", { fraction: 0.2 });
  assert.deepEqual(inputs(f).map((c) => c.slice(3).join(" ")), ["input swipe 500 1500 500 500 250", "input swipe 500 1500 500 500 400", "input swipe 500 800 500 1200 400"]);
});

test("typing quotes every text for the device's shell, turns spaces into %s and keeps a real %s", () => {
  assert.deepEqual(typingChunks("hi there"), ["'hi%sthere'"]);
  assert.deepEqual(typingChunks("it's fine"), ["'it'\\''s%sfine'"]);
  assert.deepEqual(typingChunks("a & b; rm -rf / $(x) `y` | z > w"), ["'a%s&%sb;%srm%s-rf%s/%s$(x)%s`y`%s|%sz%s>%sw'"]);
  assert.deepEqual(typingChunks("50%s off"), ["'50%'", "'s%soff'"], "a real %s is typed in two parts");
  assert.deepEqual(typingChunks("100% sure"), ["'100%%ssure'"], "a % before a space stays a %");
  assert.deepEqual(typingChunks(""), []);
  assert.throws(() => typingChunks("hi 👋"), /plain letters, digits and punctuation, and this text holds "👋"/);
  assert.throws(() => typingChunks("line\nbreak"), /a line break/);
  assert.throws(() => typingChunks("Grüße"), /"ü"/);
});

test("type sends each chunk as one input text; keys are checked; back is key 4", async () => {
  const f = fakeAdb();
  const d = driverOn(f);
  await d.type("see you at 8%s");
  await d.back();
  await d.key("KEYCODE_ENTER");
  await assert.rejects(d.key("4; reboot"), /not a key/);
  assert.deepEqual(inputs(f).map((c) => c.slice(3)), [["input", "text", "'see%syou%sat%s8%'"], ["input", "text", "'s'"], ["input", "keyevent", "4"], ["input", "keyevent", "KEYCODE_ENTER"]]);
});

test("apps: start one, ask whether one is installed, and which one is in front", async () => {
  const f = fakeAdb({ focus: "com.example.dating/.ui.MainActivity" });
  const d = driverOn(f);
  await d.launch("com.example.dating");
  assert.deepEqual(f.calls().at(-1).slice(2), ["shell", "monkey", "-p", "com.example.dating", "-c", "android.intent.category.LAUNCHER", "1"]);
  await assert.rejects(d.launch("com.example.other"), /could not be started; is it installed in the emulator/);
  await assert.rejects(d.launch("com.example.dating; reboot"), /not an app package name/);
  assert.equal(await d.installed("com.example.dating"), true);
  assert.equal(await d.installed("com.example.other"), false);
  assert.deepEqual(await d.current(), { package: "com.example.dating", activity: "com.example.dating.ui.MainActivity" });
});

test("waitFor reads the screen again until the node is there, and says what it waited for", async () => {
  const f = fakeAdb({ screens: [BLANK, BLANK, CARD] });
  // Every read of the screen starts the pretend adb, a Node program, more than once. On a fresh
  // GitHub Windows machine whose disk is still busy, three reads took 8.4 s, so 5 s was too short.
  const n = await driverOn(f).waitFor({ id: "card_name" }, { timeoutMs: 60000, everyMs: 10 });
  assert.equal(n.text, "Mara, 27");
  const g = fakeAdb({ screens: [BLANK] });
  await assert.rejects(driverOn(g).waitFor({ text: "Juno" }, { timeoutMs: 50, everyMs: 10 }), /waited 0 s for text "Juno" on the screen/);
});

test("a missing adb is a plain sentence", async () => {
  // A home without Android Studio's SDK, whatever the machine running the tests has installed.
  const d = createDriver({ adb: null, home: path.join(os.tmpdir(), "no-home-here"), env: { PATH: "", GODSPEED_WINGMAN_ANDROID_HOME: path.join(os.tmpdir(), "no-android-here"), LOCALAPPDATA: path.join(os.tmpdir(), "no-local") } });
  await assert.rejects(d.devices(), /adb \(Android's platform-tools\) was not found; run `godspeed-wingman android setup` first/);
});

test("the read-only guard: no like, pass, send or typing, no sideways swipe; reading, scrolling and Back still work", async () => {
  const f = fakeAdb();
  const d = readOnlyAndroid(driverOn(f));
  await assert.rejects(d.tapDesc("Like"), (e) => e instanceof ReadOnlyError && /marked "like"/.test(e.message));
  await assert.rejects(d.tapDesc("Pass"), /marked "pass"/);
  await assert.rejects(d.tap(250, 2200), /a tap at 250,2200 on a button marked "pass"/, "the icon inside the pass button");
  await assert.rejects(d.tapId("like_button"), /marked "like"/);
  await assert.rejects(d.swipe(900, 1200, 100, 1200), /sideways swipe/);
  await assert.rejects(d.scroll("left"), /sideways scroll/);
  await assert.rejects(d.type("hello"), /refused typing/);
  await assert.rejects(d.key("KEYCODE_ENTER"), /the key KEYCODE_ENTER/);
  assert.deepEqual(inputs(f), [], "nothing reached the device");
  await d.tapText("Mara, 27");
  await d.tapText("Messages");
  await d.scroll("down");
  await d.back();
  assert.deepEqual(inputs(f).map((c) => c.slice(3, 5).join(" ")), ["input tap", "input tap", "input swipe", "input keyevent"]);
  assert.equal((await d.dump()).length, 7, "reading is free");
});
