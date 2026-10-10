// The settings file: every key checked, nothing private hard-coded, the defaults right for a
// desktop and for a server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaults, loadSettings, normalizeSettings, validTelegramEnv, isDesktop, systemTimezone, DEFAULTS } from "../lib/core/settings.mjs";
import { loadWorkerEnv, defaultStateDir, appDir, binDir, findMissionControl } from "../lib/core/paths.mjs";

const norm = (v, opts) => normalizeSettings(v, defaults(opts));
const desktop = { platform: "win32", env: {} };
const server = { platform: "linux", env: {} };

test("the defaults: the local browser and the desk on a desktop, the bridge and Telegram on a server; nothing of one person's machine", () => {
  const d = defaults(desktop);
  assert.equal(d.browser, "local");
  assert.equal(d.bridge, "");
  assert.deepEqual(d.talk, ["desk", "desktop"]);
  assert.deepEqual(d.sites, ["flirtual"]);
  assert.equal(d.retention_days, 42);
  assert.equal(d.desk_port, 47860);
  assert.equal(d.timezone, systemTimezone(), "this machine's time zone, not a fixed one");
  assert.equal(d.telegram_env, "");
  assert.deepEqual(d.model, { lane: "claude", name: "sonnet" });
  const s = defaults(server);
  assert.equal(s.browser, "bridge");
  assert.deepEqual(s.talk, ["telegram"]);
  assert.equal(isDesktop({ platform: "linux", env: { DISPLAY: ":0" } }), true);
  assert.equal(isDesktop({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland" } }), true);
  assert.equal(isDesktop({ platform: "darwin", env: {} }), true);
  assert.equal(DEFAULTS.retention_days, 42);
});

test("a Telegram .env is taken only inside a Hermes home, on Linux, macOS and Windows", () => {
  for (const p of [
    "/root/.hermes/.env", "/home/someone/.hermes/profiles/work/.env", "/Users/someone/.hermes/.env",
    "C:\\Users\\someone\\AppData\\Local\\hermes\\.env", "C:\\Users\\someone\\AppData\\Local\\Godspeed Mission Control Full Alpha State\\hermes-profile\\.env",
    "C:/Users/someone/AppData/Local/hermes/profiles/work/.env",
  ]) assert.equal(validTelegramEnv(p), true, p);
  for (const p of ["/tmp/mine.env", ".hermes/.env", "/root/.hermes/../etc/.env", "/root/.hermes/env", "/root/.hermes/profiles/.env", "", null, 7, "/home/x/hermes-stuff/.env"]) {
    assert.equal(validTelegramEnv(p), false, String(p));
  }
  assert.equal(norm({ telegram_env: "/tmp/mine.env" }, server).telegram_env, "");
  assert.equal(norm({ telegram_env: "/root/.hermes/.env" }, server).telegram_env, "/root/.hermes/.env");
});

test("the model: a lane from the list and a plain name; the file never chooses a program", () => {
  assert.deepEqual(norm({ model: { lane: "codex" } }, desktop).model, { lane: "codex", name: "" }, "codex's own default model");
  assert.deepEqual(norm({ model: { lane: "codex", name: "gpt-5.5" } }, desktop).model, { lane: "codex", name: "gpt-5.5" });
  assert.deepEqual(norm({ model: { lane: "openai", name: "openai/gpt-5.5-mini" } }, desktop).model, { lane: "openai", name: "openai/gpt-5.5-mini" });
  assert.deepEqual(norm({ model: { name: "opus" } }, desktop).model, { lane: "claude", name: "opus" });
  assert.deepEqual(norm({ model: { lane: "hermes" } }, desktop).model, { lane: "claude", name: "sonnet" }, "no hermes lane: it cannot be made tool-free");
  assert.deepEqual(norm({ model: { lane: "command", name: "x" } }, desktop).model.lane, "claude", "only the environment chooses a test program");
  assert.equal(norm({ model: { name: "-p" } }, desktop).model.name, "sonnet", "a name that looks like an option is not taken");
  assert.equal(norm({ model: { name: "a b" } }, desktop).model.name, "sonnet");
  assert.equal(norm({ model: "codex" }, desktop).model.lane, "claude", "not an object: the default");
});

test("browser, bridge, talk, sites and the desk port are checked", () => {
  assert.equal(norm({ browser: "bridge", bridge: "http://192.168.1.20:3012/" }, desktop).bridge, "http://192.168.1.20:3012");
  assert.equal(norm({ bridge: "javascript:alert(1)" }, desktop).bridge, "");
  assert.equal(norm({ browser: "firefox" }, desktop).browser, "local");
  assert.deepEqual(norm({ talk: ["telegram", "carrier pigeon", "telegram"] }, desktop).talk, ["telegram"]);
  assert.deepEqual(norm({ talk: [] }, desktop).talk, ["desk", "desktop"], "nowhere to talk is not a choice");
  assert.deepEqual(norm({ sites: ["flirtual", "Bad Id", "../x", "kind-meet"] }, desktop).sites, ["flirtual", "kind-meet"]);
  assert.deepEqual(norm({ sites: [] }, desktop).sites, [], "every site may be switched off");
  assert.deepEqual(norm({ sites: "flirtual" }, desktop).sites, ["flirtual"]);
  assert.equal(norm({ desk_port: 80 }, desktop).desk_port, 47860);
  assert.equal(norm({ desk_port: 48000 }, desktop).desk_port, 48000);
  assert.deepEqual(norm({ site_options: { flirtual: { queue: "friend", bad: { x: 1 }, "Bad-Key": 1 }, "../x": { a: 1 } } }, desktop).site_options, { flirtual: { queue: "friend" } });
  assert.equal(norm({ kind: "friend" }, desktop).kind, "friend");
  assert.equal(norm({ kind: "anything" }, desktop).kind, "love");
});

test("pacing, practice and the rest keep their checks", () => {
  const s = norm({ wait_seconds: [5], read_seconds: [1, 2], practice_until: { agree: 11, of: 10 }, practice_round: 0, inbox_every_minutes: -3, max_run_hours: 100, sync: "sometimes", daily_start: "25:00", notebook_collection: false, contact_notice: false }, desktop);
  assert.deepEqual(s.wait_seconds, [10, 180]);
  assert.deepEqual(s.read_seconds, [1, 2]);
  assert.deepEqual(s.practice_until, { agree: 9, of: 10 });
  assert.equal(s.practice_round, 10);
  assert.equal(s.inbox_every_minutes, 30);
  assert.equal(s.max_run_hours, 6);
  assert.equal(s.sync, "auto");
  assert.equal(s.daily_start, "18:30");
  assert.equal(s.notebook_collection, false);
  assert.equal(s.contact_notice, false);
  assert.deepEqual(norm({ practice_until: { agree: 4, of: 5 } }, desktop).practice_until, { agree: 4, of: 5 });
});

test("the notebook list of likes and passes is off unless the file says true", () => {
  assert.equal(defaults(desktop).notebook_collection, false, "off on a desktop");
  assert.equal(defaults(server).notebook_collection, false, "off on a server");
  assert.equal(norm({}, desktop).notebook_collection, false, "a file without it: off");
  assert.equal(norm({ notebook_collection: true }, desktop).notebook_collection, true, "an explicit true: on");
  for (const v of [false, null, "true", "yes", 1, {}, []]) assert.equal(norm({ notebook_collection: v }, desktop).notebook_collection, false, JSON.stringify(v));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-nb-"));
  const f = path.join(dir, "settings.json");
  fs.writeFileSync(f, JSON.stringify({ retention_days: 30 }));
  assert.equal(loadSettings(f, desktop).notebook_collection, false);
  fs.writeFileSync(f, JSON.stringify({ notebook_collection: true }));
  assert.equal(loadSettings(f, desktop).notebook_collection, true);
});

test("a broken settings file is read as the defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-bad-"));
  const f = path.join(dir, "settings.json");
  fs.writeFileSync(f, "{ not json");
  assert.equal(loadSettings(f, desktop).retention_days, 42);
  fs.writeFileSync(f, "[1,2]");
  assert.deepEqual(loadSettings(f, desktop).sites, ["flirtual"]);
});

test("the worker's private env file sets only the Wingman's own variables and the model key it names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-env-"));
  const f = path.join(dir, "worker.env");
  fs.writeFileSync(f, "# private\nGODSPEED_WINGMAN_OPENAI_BASE=https://models.example/v1\nGODSPEED_WINGMAN_OPENAI_KEY_ENV=MY_MODEL_KEY\nMY_MODEL_KEY=\"sk-test\"\nPATH=/evil\nBRIDGE_TOKEN=t1\nGODSPEED_WINGMAN_NOTEBOOK=http://127.0.0.1:47831\n");
  const env = { GODSPEED_WINGMAN_NOTEBOOK: "http://already.set" };
  const set = loadWorkerEnv(f, env);
  assert.equal(env.GODSPEED_WINGMAN_OPENAI_BASE, "https://models.example/v1");
  assert.equal(env.MY_MODEL_KEY, "sk-test");
  assert.equal(env.BRIDGE_TOKEN, "t1");
  assert.equal(env.PATH, undefined, "nothing else");
  assert.equal(env.GODSPEED_WINGMAN_NOTEBOOK, "http://already.set", "a value already set wins");
  assert.ok(set.includes("MY_MODEL_KEY"));
  assert.deepEqual(loadWorkerEnv(path.join(dir, "none.env"), {}), []);
});

test("where things go: the state folder, the program and the command, as root on Linux and otherwise", () => {
  const home = path.join(os.tmpdir(), "somebody");
  assert.equal(defaultStateDir({ env: {}, platform: "linux", root: true, home }), "/var/lib/godspeed/wingman");
  assert.equal(defaultStateDir({ env: {}, platform: "linux", root: false, home }), path.join(home, ".godspeed", "wingman"));
  assert.equal(defaultStateDir({ env: {}, platform: "win32", root: false, home }), path.join(home, ".godspeed", "wingman"));
  assert.equal(defaultStateDir({ env: { GODSPEED_WINGMAN_STATE: path.join(home, "x") }, platform: "linux", root: true, home }), path.join(home, "x"));
  assert.equal(appDir({ env: {}, platform: "linux", root: true, home }), "/usr/local/lib/godspeed-wingman");
  assert.equal(appDir({ env: {}, platform: "win32", root: false, home }), path.join(home, ".godspeed", "addons", "godspeed-wingman"));
  assert.equal(binDir({ platform: "linux", root: true, home }), "/usr/local/bin");
  assert.equal(binDir({ platform: "darwin", root: false, home }), path.join(home, ".godspeed", "bin"));
});

test("the mission control folder: the argument, the environment, the device file, the folder above, then the default folders", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-home-"));
  const mc = (name) => { const d = path.join(home, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "AGENTS.md"), "#"); return d; };
  // Started from a folder with no mission control above it (the root of the disk).
  const nowhere = path.parse(home).root;
  const rootIsMc = fs.existsSync(path.join(nowhere, "AGENTS.md"));
  const v1 = mc("godspeed");
  if (!rootIsMc) assert.equal(findMissionControl({ cwd: nowhere, userHome: home, env: {} }), v1);
  const v2 = mc("godspeed-v2");
  if (!rootIsMc) assert.equal(findMissionControl({ cwd: nowhere, userHome: home, env: {} }), v2, "Godspeed v2's folder first");
  const deep = path.join(v1, "routines", "wingman");
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findMissionControl({ cwd: deep, userHome: home, env: {} }), v1, "the folder this runs in, or one above it");
  fs.mkdirSync(path.join(home, ".godspeed"), { recursive: true });
  fs.writeFileSync(path.join(home, ".godspeed", "device.env"), `GODSPEED_DIR="${v1}"\n`);
  assert.equal(findMissionControl({ cwd: nowhere, userHome: home, env: {} }), v1, "the device file");
  assert.equal(findMissionControl({ cwd: nowhere, userHome: home, env: { GODSPEED_WINGMAN_DIR: v2 } }), v2);
  assert.equal(findMissionControl({ arg: path.join(home, "nothing"), cwd: nowhere, userHome: home, env: {} }), null, "a wrong argument is not guessed around");
});
