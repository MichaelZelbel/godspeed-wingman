// The model lanes, with stand-in programs: no real model is ever called here. Claude Code and Codex
// run without tools, from an empty folder, without a shell; npm's .cmd launchers are read, not run.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ask, claudeArgs, codexArgs, codexPrompt, laneOf, CODEX_OFF } from "../lib/core/model.mjs";
import { resolveShim, findProgram, codexProgram, codexPlaces } from "../lib/core/exe.mjs";
import { modelLine } from "../lib/commands/check.mjs";

const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// A stand-in program: Node runs `body` with the arguments and stdin; on Windows reached through an
// npm-style .cmd launcher, elsewhere through a sh script.
function standIn(name, body) {
  const dir = temp(`wingman-${name}-`);
  const js = path.join(dir, "node_modules", name, `${name}.mjs`);
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, body);
  if (process.platform === "win32") {
    const cmd = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(cmd, `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\${name}\\${name}.mjs" %*\r\n`);
    return { dir, file: cmd, js };
  }
  const sh = path.join(dir, name);
  fs.writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  return { dir, file: sh, js };
}

const RECORD = `import fs from "node:fs";
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  fs.writeFileSync(process.env.RECORD_TO, JSON.stringify({ args, input, cwd: process.cwd() }));
  const o = args.indexOf("-o");
  const answer = '{"verdict":"like","sure":"high","reason":"stand-in"}';
  if (o >= 0) fs.writeFileSync(args[o + 1], answer); else process.stdout.write(answer);
});`;

test("Claude Code runs in print mode with every hook off, no tools, no MCP servers and our own system prompt", () => {
  const a = claudeArgs("SYSTEM TEXT", "sonnet");
  assert.deepEqual(a.slice(0, 9), ["-p", "--output-format", "text", "--settings", '{"disableAllHooks": true}', "--tools", "", "--strict-mcp-config", "--system-prompt"]);
  assert.equal(a[9], "SYSTEM TEXT");
  assert.deepEqual(a.slice(10), ["--model", "sonnet"]);
  assert.deepEqual(claudeArgs("x", "").slice(-2), ["--system-prompt", "x"], "no model named: its default");
});

test("Codex runs `codex exec` read-only, without the person's settings, with its tools off, answering into a file", () => {
  const a = codexArgs("/tmp/empty", "/tmp/empty/answer.txt", "gpt-5.5");
  assert.equal(a[0], "exec");
  for (const f of ["--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf("--sandbox") + 1], "read-only");
  assert.equal(a[a.indexOf("-C") + 1], "/tmp/empty");
  assert.equal(a[a.indexOf("-o") + 1], "/tmp/empty/answer.txt");
  assert.equal(a[a.indexOf("-m") + 1], "gpt-5.5");
  for (const f of CODEX_OFF) assert.ok(a.includes(`features.${f}=false`), f);
  assert.ok(CODEX_OFF.includes("shell_tool"));
  assert.equal(a[a.length - 1], "-", "the prompt comes on stdin");
  assert.match(codexPrompt("SYS", "PROMPT"), /^SYS\n\nDo not run commands or use tools\. Answer from the text below only\.\n\nPROMPT$/);
});

test("npm's .cmd launchers are read, so no shell starts a model", () => {
  const dir = temp("wingman-shim-");
  fs.mkdirSync(path.join(dir, "node_modules", "@x", "tool", "bin"), { recursive: true });
  const exe = path.join(dir, "node_modules", "@x", "tool", "bin", "tool.exe");
  fs.writeFileSync(exe, "");
  fs.writeFileSync(path.join(dir, "tool.cmd"), `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@x\\tool\\bin\\tool.exe"   %*\r\n`);
  assert.deepEqual(resolveShim(path.join(dir, "tool.cmd")), { exe, args: [] });
  const js = path.join(dir, "node_modules", "@x", "other", "bin", "other.js");
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, "");
  fs.writeFileSync(path.join(dir, "other.cmd"), `IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@x\\other\\bin\\other.js" %*\r\n`);
  assert.deepEqual(resolveShim(path.join(dir, "other.cmd")), { exe: process.execPath, args: [js] });
  fs.writeFileSync(path.join(dir, "node.exe"), "");
  assert.deepEqual(resolveShim(path.join(dir, "other.cmd")), { exe: path.join(dir, "node.exe"), args: [js] }, "the launcher's own Node when it has one");
  fs.writeFileSync(path.join(dir, "odd.cmd"), "@echo off\r\nsomething else\r\n");
  assert.equal(resolveShim(path.join(dir, "odd.cmd")), null, "an unknown launcher is not guessed at");
  assert.deepEqual(findProgram("tool", { platform: "win32", env: { PATH: dir } }), { exe, args: [] });
  assert.equal(findProgram("nothing", { platform: "win32", env: { PATH: dir } }), null);
});

test("the lane: the settings choose claude, codex or openai; only the environment chooses a test program", () => {
  assert.equal(laneOf({ lane: "codex" }, {}), "codex");
  assert.equal(laneOf({ lane: "openai" }, {}), "openai");
  assert.equal(laneOf({ lane: "anything" }, {}), "claude");
  assert.equal(laneOf({ lane: "codex" }, { GODSPEED_WINGMAN_MODEL_CMD: "/x.mjs" }), "command");
});

test("the codex lane end to end with a stand-in Codex: the JSON comes back from the answer file", async () => {
  const fake = standIn("codex", RECORD);
  const rec = path.join(fake.dir, "record.json");
  const env = { ...process.env, GODSPEED_WINGMAN_CODEX: fake.file, RECORD_TO: rec };
  delete env.GODSPEED_WINGMAN_MODEL_CMD;
  const text = await ask({ system: "JUDGE RULES", prompt: "THE PROFILE" }, { lane: "codex", name: "gpt-5.5" }, { env, timeoutMs: 30000 });
  assert.equal(JSON.parse(text).reason, "stand-in");
  const r = JSON.parse(fs.readFileSync(rec, "utf8"));
  assert.equal(r.args[0], "exec");
  assert.equal(r.args[r.args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(r.args[r.args.indexOf("-m") + 1], "gpt-5.5");
  assert.match(r.input, /^JUDGE RULES\n\nDo not run commands or use tools\./);
  assert.match(r.input, /THE PROFILE$/);
  assert.notEqual(path.resolve(r.cwd), path.resolve(process.cwd()), "from an empty folder of its own");
  assert.ok(!fs.existsSync(r.cwd), "and the folder is gone afterwards");
});

test("the claude lane end to end with a stand-in Claude Code", async () => {
  const fake = standIn("claude", RECORD);
  const rec = path.join(fake.dir, "record.json");
  const env = { ...process.env, GODSPEED_WINGMAN_CLAUDE: fake.file, RECORD_TO: rec };
  delete env.GODSPEED_WINGMAN_MODEL_CMD;
  const text = await ask({ system: "JUDGE RULES", prompt: "THE PROFILE" }, { lane: "claude", name: "sonnet" }, { env, timeoutMs: 30000 });
  assert.equal(JSON.parse(text).verdict, "like");
  const r = JSON.parse(fs.readFileSync(rec, "utf8"));
  assert.equal(r.args[r.args.indexOf("--system-prompt") + 1], "JUDGE RULES", "the system prompt as one argument, line breaks and all");
  assert.equal(r.args[r.args.indexOf("--tools") + 1], "");
  assert.equal(r.input, "THE PROFILE");
});

test("the command lane and the openai lane take their program and address from the environment only", async () => {
  const dir = temp("wingman-cmd-");
  const script = path.join(dir, "model.mjs");
  fs.writeFileSync(script, `let s = ""; process.stdin.on("data", (d) => { s += d; }); process.stdin.on("end", () => { const j = JSON.parse(s); process.stdout.write(JSON.stringify({ echo: j.system + "|" + j.prompt })); });`);
  const out = await ask({ system: "S", prompt: "P" }, { lane: "claude" }, { env: { ...process.env, GODSPEED_WINGMAN_MODEL_CMD: script } });
  assert.deepEqual(JSON.parse(out), { echo: "S|P" });
  await assert.rejects(ask({ system: "S", prompt: "P" }, { lane: "openai", name: "m" }, { env: { PATH: process.env.PATH } }), /no key in OPENAI_API_KEY/);
  await assert.rejects(ask({ system: "S", prompt: "P" }, { lane: "openai", name: "" }, { env: { OPENAI_API_KEY: "k" } }), /needs a model name/);
});

test("check says whether the chosen model can be reached", () => {
  assert.equal(modelLine({ lane: "openai", name: "m" }, {}).ok, false);
  assert.match(modelLine({ lane: "openai", name: "m" }, {}).fix, /no key in OPENAI_API_KEY; put it in the Wingman's worker\.env/);
  assert.equal(modelLine({ lane: "openai", name: "m" }, { OPENAI_API_KEY: "k" }).ok, true);
  // An empty home: no program where its installer would put it, and nothing on the PATH.
  const home = temp("wingman-empty-home-");
  assert.equal(modelLine({ lane: "codex" }, { PATH: "" }, { home }).ok, false);
  assert.match(modelLine({ lane: "codex" }, { PATH: "" }, { home }).fix, /GODSPEED_WINGMAN_CODEX/);
});

test("Codex is found where OpenAI's installer puts it, also when it is not on the PATH yet", () => {
  assert.deepEqual(codexPlaces({ env: {}, platform: "win32", home: String.raw`C:\Users\sam` }), [
    String.raw`C:\Users\sam\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`,
    String.raw`C:\Users\sam\.codex\packages\standalone\current\bin\codex.exe`,
    String.raw`C:\Users\sam\.codex\packages\standalone\current\codex.exe`,
    String.raw`C:\Users\sam\AppData\Roaming\npm\codex.cmd`,
  ]);
  assert.equal(codexPlaces({ env: { LOCALAPPDATA: String.raw`D:\Local`, CODEX_INSTALL_DIR: String.raw`D:\Tools\codex` }, platform: "win32", home: String.raw`C:\Users\sam` })[0], String.raw`D:\Tools\codex\codex.exe`, "the installer's own folder setting first");
  assert.deepEqual(codexPlaces({ env: {}, platform: "linux", home: "/home/sam" }), ["/home/sam/.local/bin/codex", "/home/sam/.codex/packages/standalone/current/bin/codex", "/home/sam/.codex/packages/standalone/current/codex"]);
  assert.equal(codexPlaces({ env: { CODEX_HOME: "/opt/codex-home" }, platform: "darwin", home: "/Users/sam" })[1], "/opt/codex-home/packages/standalone/current/bin/codex");

  // On this machine: a fresh install in a home of its own, with nothing on the PATH.
  const home = temp("wingman-codex-home-");
  const win = process.platform === "win32";
  const env = win ? { LOCALAPPDATA: path.join(home, "AppData", "Local"), APPDATA: path.join(home, "AppData", "Roaming"), PATH: "" } : { PATH: "" };
  assert.equal(codexProgram({ env, home }), null, "nothing installed yet");
  const installed = win ? path.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe") : path.join(home, ".local", "bin", "codex");
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, "", { mode: 0o755 });
  assert.deepEqual(codexProgram({ env, home }), { exe: installed, args: [] }, "found without the PATH");
  const onPath = temp("wingman-codex-path-");
  const other = path.join(onPath, win ? "codex.exe" : "codex");
  fs.writeFileSync(other, "", { mode: 0o755 });
  assert.equal(codexProgram({ env: { ...env, PATH: onPath }, home }).exe, other, "the PATH still comes first");
  const chosen = path.join(onPath, win ? "chosen.exe" : "chosen");
  fs.writeFileSync(chosen, "", { mode: 0o755 });
  assert.equal(codexProgram({ env: { ...env, PATH: onPath, GODSPEED_WINGMAN_CODEX: chosen }, home }).exe, chosen, "and the program you name before both");
});
