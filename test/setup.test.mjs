// Adding the Wingman and taking it out again, in a stand-in home folder: where everything goes, the
// worker's task or service files, the command, the recipe, the Claude Code hook, the Hermes plugin.
// Nothing here installs a real task or service.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, launchers, launcherArgv, initialSettings, explicitSettings, setup, uninstall, MARKER, PKG } from "../lib/setup/index.mjs";
import { windowsTaskXml, launchAgentPlist, systemdUnit, serviceFile } from "../lib/setup/service.mjs";
import { mergeHook, removeHookText, hookCommand } from "../lib/setup/claude.mjs";
import { installPlugin, removePlugin, PLUGIN } from "../lib/setup/hermes.mjs";
import { tempMc, makeWorker, user } from "./helpers.mjs";

const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

function standIn(platform = process.platform) {
  const home = temp("wingman-home-");
  return { home, sys: { home, platform, root: false, env: { PATH: "", Path: "", LOCALAPPDATA: path.join(home, "AppData", "Local") } } };
}

test("the plan: where the program, the command and the private folder go, and how the worker runs", () => {
  const { mc } = tempMc();
  const { home, sys } = standIn("win32");
  const p = plan({ godspeed: mc }, sys);
  assert.equal(p.mcDir, mc);
  assert.equal(p.appDir, path.join(home, ".godspeed", "addons", "godspeed-wingman"));
  assert.equal(p.binDir, path.join(home, ".godspeed", "bin"));
  assert.equal(p.stateDir, path.join(home, ".godspeed", "wingman"));
  assert.equal(p.service, "windows-task");
  assert.equal(p.desktop, true);
  assert.equal(p.node, process.execPath, "an absolute Node path");
  assert.equal(plan({ godspeed: mc }, { ...sys, platform: "darwin" }).service, "launch-agent");
  assert.equal(plan({ godspeed: mc }, { ...sys, platform: "linux" }).service, "systemd-user");
  assert.equal(plan({ godspeed: mc }, { ...sys, platform: "linux", root: true }).service, "systemd-system");
  assert.equal(plan({ godspeed: mc }, { ...sys, platform: "linux", root: true }).stateDir, path.resolve("/var/lib/godspeed/wingman"));
  assert.equal(plan({ godspeed: mc, "no-service": true }, sys).service, "none");
  assert.throws(() => plan({ godspeed: path.join(home, "nothing") }, sys), /No Godspeed Mission Control folder found/);
});

const P = { node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\Users\\Some One\\.godspeed\\addons\\godspeed-wingman\\bin\\godspeed-wingman.mjs", mcDir: "C:\\Users\\Some One\\godspeed-v2", stateDir: "C:\\Users\\Some One\\.godspeed\\wingman", version: "0.5.0", user: "PC\\someone" };

test("the Windows task: at logon, the person's own account, no window, an absolute node.exe, started again when it stops", () => {
  const x = windowsTaskXml({ ...P, conhost: "C:\\Windows\\System32\\conhost.exe" });
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-16"\?>/);
  assert.match(x, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>PC\\someone<\/UserId>/);
  assert.match(x, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(x, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(x, /<Hidden>true<\/Hidden>/);
  assert.match(x, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>/);
  assert.match(x, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(x, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(x, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command>/);
  assert.match(x, /<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; &quot;C:\\Users\\Some One\\.godspeed\\addons\\godspeed-wingman\\bin\\godspeed-wingman\.mjs&quot; &quot;worker&quot; &quot;--supervise&quot; &quot;--godspeed&quot; &quot;C:\\Users\\Some One\\godspeed-v2&quot;/);
  assert.match(x, /<URI>\\Godspeed Wingman<\/URI>/);
  const amp = windowsTaskXml({ ...P, mcDir: "C:\\R&D <x>", conhost: "C:\\c.exe" });
  assert.match(amp, /C:\\R&amp;D &lt;x&gt;/, "a path is escaped for XML");
  const plain = windowsTaskXml({ ...P, conhost: null });
  assert.match(plain, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/, "without conhost, node itself");
});

test("the macOS LaunchAgent and the systemd units", () => {
  const p = { node: "/usr/local/bin/node", script: "/opt/app/bin/godspeed-wingman.mjs", mcDir: "/home/sam/godspeed v2", stateDir: "/home/sam/.godspeed/wingman", version: "0.5.0", path: "/usr/local/bin:/usr/bin:/bin", home: "/home/sam" };
  const plist = launchAgentPlist(p);
  assert.match(plist, /<key>Label<\/key><string>com\.godspeed\.wingman<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/opt\/app\/bin\/godspeed-wingman\.mjs<\/string>\s*<string>worker<\/string>/);
  assert.match(plist, /<key>PATH<\/key><string>\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/);
  const user = systemdUnit(p);
  assert.match(user, /^ExecStart="\/usr\/local\/bin\/node" "\/opt\/app\/bin\/godspeed-wingman\.mjs" "worker" "--godspeed" "\/home\/sam\/godspeed v2" "--state" "\/home\/sam\/\.godspeed\/wingman"$/m);
  assert.match(user, /^Restart=always$/m);
  assert.match(user, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(user, /^User=/m);
  const sys = systemdUnit({ ...p, runAs: { user: "sam", group: "sam", home: "/home/sam" } }, { system: true });
  assert.match(sys, /^User=sam$/m);
  assert.match(sys, /^Group=sam$/m);
  assert.match(sys, /^Environment="HOME=\/home\/sam"$/m);
  assert.match(sys, /^WantedBy=multi-user\.target$/m);
  const root = systemdUnit(p, { system: true });
  assert.doesNotMatch(root, /^User=/m, "as root when the mission control belongs to root");
  assert.match(root, /^Environment="HOME=\/root"$/m);
  assert.match(systemdUnit({ ...p, mcDir: "/x/100%" }), /"\/x\/100%%"/, "systemd's % is doubled");
  assert.equal(serviceFile({ service: "systemd-user", home: "/home/sam" }), path.join("/home/sam", ".config", "systemd", "user", "godspeed-wingman.service"));
  assert.equal(serviceFile({ service: "launch-agent", home: "/Users/sam" }), path.join("/Users/sam", "Library", "LaunchAgents", "com.godspeed.wingman.plist"));
});

test("the command: a sh launcher everywhere and a .cmd on Windows, both with the absolute node path and the folders", () => {
  const { mc } = tempMc();
  const { home, sys } = standIn("win32");
  const p = plan({ godspeed: mc }, sys);
  const [sh, cmd] = launchers(p);
  assert.equal(sh.file, path.join(home, ".godspeed", "bin", "godspeed-wingman"));
  assert.match(sh.body, new RegExp(`^#!/bin/sh\\n# Written by godspeed-wingman setup\\.\\nexec "${process.execPath.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" `));
  assert.match(sh.body, /--godspeed ".*" --state ".*" "\$@"\n$/);
  assert.equal(cmd.file, path.join(home, ".godspeed", "bin", "godspeed-wingman.cmd"));
  assert.match(cmd.body, /^@echo off\r\n".*node(\.exe)?" ".*godspeed-wingman\.mjs" --godspeed ".*" --state ".*" %\*\r\n$/);
  assert.equal(launchers(plan({ godspeed: mc }, { ...sys, platform: "linux" })).length, 1, "no .cmd off Windows");
  assert.deepEqual(launcherArgv(p).slice(2), ["--godspeed", mc, "--state", p.stateDir]);
});

test("the Claude Code hook is added once, and taken out without touching anyone else's", () => {
  const cmd = hookCommand("C:\\Users\\x\\.godspeed\\bin\\godspeed-wingman");
  assert.equal(cmd, '"C:/Users/x/.godspeed/bin/godspeed-wingman" context --hook claude');
  const theirs = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "other-tool context" }] }] }, model: "x" };
  const added = mergeHook(JSON.stringify(theirs), cmd);
  const cfg = JSON.parse(added);
  assert.equal(cfg.hooks.UserPromptSubmit.length, 2);
  assert.equal(cfg.model, "x");
  assert.equal(mergeHook(added, cmd), null, "only once");
  const removed = JSON.parse(removeHookText(added));
  assert.deepEqual(removed, theirs);
  assert.equal(removeHookText(JSON.stringify(theirs)), null);
  assert.deepEqual(JSON.parse(removeHookText(mergeHook("", cmd))), {});
});

test("the first settings follow the machine and the flags; a later run changes only what was asked", () => {
  const { mc } = tempMc();
  const { sys } = standIn("win32");
  const d = initialSettings(plan({ godspeed: mc }, sys));
  assert.deepEqual([d.browser, d.talk, d.sites, d.retention_days, d.desk_port], ["local", ["desk", "desktop"], ["flirtual"], 42, 47860]);
  const server = initialSettings(plan({ godspeed: mc, bridge: "http://10.0.0.5:3012" }, { ...sys, platform: "linux", env: {} }), { telegramEnv: "/home/sam/.hermes/.env" });
  assert.deepEqual([server.browser, server.bridge, server.talk, server.telegram_env], ["bridge", "http://10.0.0.5:3012", ["telegram"], "/home/sam/.hermes/.env"]);
  assert.deepEqual(initialSettings(plan({ godspeed: mc }, { ...sys, platform: "linux", env: {} })).talk, ["desk"], "a server without Telegram: the desk");
  assert.deepEqual(explicitSettings(plan({ godspeed: mc, talk: "telegram,desk", site: "flirtual" }, sys), { telegramEnv: "C:\\Users\\x\\AppData\\Local\\hermes\\.env" }), { sites: ["flirtual"], talk: ["telegram", "desk"], telegram_env: "C:\\Users\\x\\AppData\\Local\\hermes\\.env" });
  assert.deepEqual(explicitSettings(plan({ godspeed: mc }, sys)), {});
});

test("setup and uninstall in a stand-in home: the program, the command, the files, the recipe, the hook; your own files stay", async () => {
  const { mc } = tempMc();
  fs.rmSync(path.join(mc, "routines"), { recursive: true, force: true });
  fs.mkdirSync(path.join(mc, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(mc, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: [] } }, null, 2));
  fs.mkdirSync(path.join(mc, "skills", "wingman-add-site"), { recursive: true });
  fs.writeFileSync(path.join(mc, "skills", "wingman-add-site", "SKILL.md"), "the person's own recipe");
  const { home, sys } = standIn();
  const flags = { godspeed: mc, "no-service": true, "no-hermes": true, site: "flirtual,nowhere", talk: "desk" };
  assert.equal(await quiet(() => setup(flags, sys)), 0);
  const p = plan(flags, sys);
  assert.ok(fs.existsSync(path.join(p.appDir, "bin", "godspeed-wingman.mjs")), "the program copy");
  assert.ok(fs.existsSync(path.join(p.appDir, "lib", "sites", "flirtual", "site.json")));
  assert.ok(!fs.existsSync(path.join(p.appDir, "test")), "no tests in the copy");
  for (const l of launchers(p)) assert.ok(fs.existsSync(l.file), l.file);
  const s = JSON.parse(fs.readFileSync(path.join(mc, "routines", "wingman", "settings.json"), "utf8"));
  assert.deepEqual(s.sites, ["flirtual"], "a site the Wingman does not know is left out, with a note");
  assert.deepEqual(s.talk, ["desk"]);
  assert.equal(s.retention_days, 42);
  assert.match(fs.readFileSync(path.join(mc, "routines", "wingman", "preferences.md"), "utf8"), /## Who fits/);
  assert.ok(fs.existsSync(path.join(mc, "routines", "wingman", "watch.md")));
  assert.ok(fs.existsSync(path.join(mc, "skills", "wingman", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(mc, "skills", "wingman", MARKER)));
  assert.equal(fs.readFileSync(path.join(mc, "skills", "wingman-add-site", "SKILL.md"), "utf8"), "the person's own recipe", "a recipe the person wrote is left alone");
  assert.match(fs.readFileSync(path.join(mc, ".claude", "settings.json"), "utf8"), /godspeed-wingman\\?" context --hook claude/);
  assert.ok(fs.existsSync(p.stateDir));

  // The installed command answers.
  const launcher = process.platform === "win32" ? launchers(p)[1].file : launchers(p)[0].file;
  const v = spawnSync(launcher, ["version"], { encoding: "utf8", shell: process.platform === "win32" });
  assert.equal(v.stdout.trim(), "0.6.2", v.stderr);

  // A second run keeps the person's choices and changes only what is asked.
  fs.appendFileSync(path.join(mc, "routines", "wingman", "preferences.md"), "\nMy own words.\n");
  s.daily_start = "20:15";
  fs.writeFileSync(path.join(mc, "routines", "wingman", "settings.json"), JSON.stringify(s));
  assert.equal(await quiet(() => setup({ godspeed: mc, "no-service": true, "no-hermes": true, talk: "telegram" }, sys)), 0);
  const s2 = JSON.parse(fs.readFileSync(path.join(mc, "routines", "wingman", "settings.json"), "utf8"));
  assert.deepEqual([s2.daily_start, s2.talk], ["20:15", ["telegram"]]);
  assert.match(fs.readFileSync(path.join(mc, "routines", "wingman", "preferences.md"), "utf8"), /My own words/);
  assert.equal((fs.readFileSync(path.join(mc, ".claude", "settings.json"), "utf8").match(/godspeed-wingman/g) || []).length, 1, "the hook only once");

  fs.writeFileSync(path.join(p.stateDir, "kept.txt"), "x");
  assert.equal(await quiet(() => uninstall({ godspeed: mc, "no-service": true, "no-hermes": true, yes: true }, sys)), 0);
  for (const l of launchers(p)) assert.ok(!fs.existsSync(l.file), l.file);
  assert.ok(!fs.existsSync(p.appDir));
  assert.ok(!fs.existsSync(path.join(mc, "skills", "wingman")));
  assert.ok(fs.existsSync(path.join(mc, "skills", "wingman-add-site")), "not ours, so not removed");
  assert.doesNotMatch(fs.readFileSync(path.join(mc, ".claude", "settings.json"), "utf8"), /godspeed-wingman/);
  assert.ok(fs.existsSync(path.join(mc, "routines", "wingman", "preferences.md")), "the person's files stay");
  assert.ok(fs.existsSync(path.join(p.stateDir, "kept.txt")), "the private folder stays unless asked");
  assert.equal(await quiet(() => uninstall({ godspeed: mc, "no-service": true, "no-hermes": true, "delete-state": true }, sys)), 0);
  assert.ok(!fs.existsSync(p.stateDir), "and goes when asked");
  assert.ok(home);
});

test("the Hermes plugin is copied with the exact command line and switched on; taken out again", () => {
  const home = temp("wingman-hermes-");
  const calls = [];
  const h = { home, hermes: (args) => { calls.push(args); return { status: 0, stdout: "", stderr: "" }; } };
  const argv = [process.execPath, path.join(PKG, "bin", "godspeed-wingman.mjs"), "--godspeed", "/x", "--state", "/y"];
  const r = installPlugin(h, { pkgDir: PKG, argv, launcher: "/z/godspeed-wingman" });
  assert.equal(r.enabled, true);
  const dir = path.join(home, "plugins", PLUGIN);
  assert.ok(fs.existsSync(path.join(dir, "__init__.py")));
  assert.match(fs.readFileSync(path.join(dir, "plugin.yaml"), "utf8"), /^name: godspeed-wingman$/m);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "launcher.json"), "utf8")).argv, argv);
  assert.deepEqual(calls[0], ["plugins", "enable", "godspeed-wingman"]);
  assert.equal(removePlugin(h).ok, true);
  assert.ok(!fs.existsSync(dir));
  assert.deepEqual(calls[1], ["plugins", "disable", "godspeed-wingman"]);
  assert.match(installPlugin({ home: null }, { pkgDir: PKG, argv }).text, /Hermes was not found/);
});

const python = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);

test("the Hermes plugin hands the open question to the model, with no shell and no .cmd, on any system", { skip: python ? false : "no Python here" }, async () => {
  const h = makeWorker([user("a1", "Mara")]);
  await h.w.tick();
  const home = temp("wingman-hermes-run-");
  installPlugin({ home, hermes: () => ({ status: 0, stdout: "", stderr: "" }) }, { pkgDir: PKG, argv: [process.execPath, path.join(PKG, "bin", "godspeed-wingman.mjs"), "--godspeed", h.mc, "--state", h.state] });
  const script = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("plug", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
hooks = {}
class Ctx:
    def register_hook(self, name, fn): hooks[name] = fn
m.register(Ctx())
print(json.dumps(hooks["pre_llm_call"]()))`;
  const r = spawnSync(python, ["-c", script, path.join(home, "plugins", PLUGIN, "__init__.py")], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.match(out.context, /^\[godspeed-wingman\]/);
  assert.match(out.context, /OPEN PRACTICE QUESTION about Mara/);
});
