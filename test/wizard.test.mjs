// The setup questions in a terminal (a server over SSH), with typed answers played in, and what
// happens after `setup` on a desktop and without a screen. Nothing here opens a real browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { terminalWizard, afterSetup, pickNumbers, lineReader } from "../lib/onboarding/terminal.mjs";
import { readWatch } from "../lib/core/watch.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { tempMc, settingsFile } from "./helpers.mjs";
import { PREFERENCES_TEMPLATE } from "../lib/core/preferences.mjs";

const SITES = [{ id: "flirtual", name: "Flirtual", builtin: true, kind: "browser", ok: true, why: "", login_url: "https://flirtu.al/login" }];
const LANES = [
  { lane: "claude", label: "Claude Code", found: true, where: "/usr/local/bin/claude", name: "sonnet" },
  { lane: "codex", label: "Codex", found: false, where: "", name: "" },
  { lane: "openai", label: "An OpenAI-compatible service", found: false, where: "no key in OPENAI_API_KEY", name: "" },
];
const detected = (over = {}) => async () => ({ desktop: false, platform: "linux", sites: SITES, lanes: LANES, telegram: { found: true, file: "/home/sam/.hermes/.env" }, assistant: { hermes: true, claude: false }, notifications: { ok: false, how: "no desktop session on this machine" }, timezone: "UTC", ...over });

function scripted(lines) {
  const input = new PassThrough();
  input.end(lines.map((l) => `${l}\n`).join(""));
  const output = new PassThrough();
  let out = "";
  output.on("data", (d) => { out += d; });
  return { input, output, text: () => out };
}

test("numbers pick from a list; lines typed ahead of a question are kept", async () => {
  assert.deepEqual(pickNumbers("1, 3 3 9 x", ["a", "b", "c"]), ["a", "c"]);
  const io = scripted(["first", "", "third"]);
  const r = lineReader(io.input, io.output);
  assert.equal(await r.ask("One"), "first");
  assert.equal(await r.ask("Two", "kept"), "kept", "Enter keeps the value in brackets");
  assert.equal(await r.ask("Three"), "third");
  assert.equal(await r.ask("Four", "end"), "end", "after the last line, the defaults");
  r.close();
  assert.match(io.text(), /Two \[kept\]: /);
});

test("the terminal wizard on a server: same questions, the files written, one welcome asked for on Telegram", async () => {
  const { mc, state } = tempMc({ sites: ["flirtual"], talk: ["telegram"], browser: "bridge", onboarded: false });
  fs.rmSync(path.join(mc, "routines", "wingman", "preferences.md"));
  const io = scripted([
    "1",                       // sites
    "a man in my thirties",    // me
    "1,3",                     // women, nonbinary people
    "",                        // nothing more specific
    "25-40",                   // ages
    "4",                       // anywhere
    "",                        // no places named
    "2",                       // flirty and playful
    "3,4,8",                   // vrchat, humour, shared interests
    "building worlds",         // which interests
    "kind to animals; laughs a lot",
    "2,5",                     // smoking, only wants friends
    "",                        // no own deal-breakers
    "3",                       // witty
    "",                        // no sample
    "",                        // language as offered
    "20:00",                   // daily
    "Europe/Vienna",
    "30",                      // retention
    "1",                       // telegram
    "http://10.0.0.5:3010",    // the bridge
    "1",                       // claude
    "",                        // its default name
    "n",                       // no test call
    "Robin, Lena",             // watch
    "y",                       // save
  ]);
  const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected() }, now: new Date("2026-10-10T12:00:00Z") });
  assert.equal(r.done, true, io.text());
  const prefs = fs.readFileSync(path.join(mc, "routines", "wingman", "preferences.md"), "utf8");
  assert.match(prefs, /I am a man in my thirties, and I am looking for women and nonbinary people, aged 25 to 40\./);
  assert.match(prefs, /Someone flirty and playful/, "the flirty starter");
  assert.match(prefs, /They live anywhere; distance matters less than fit\./);
  assert.match(prefs, /- Someone who plays VRChat\.\n- Someone whose bio makes me smile; a sense of humour like mine\.\n- Someone who shares at least one of my interests: building worlds\.\n- Kind to animals\.\n- Laughs a lot\./);
  // "Only wants friends" is ticked, but the flirty starter says it already: one line, not two.
  assert.match(prefs, /## Who does not fit\n\n- A smoker\.\n- Someone who says flirting is not for them, or who wants everything to go slow and careful\.\n- Someone who is clearly only looking for friends\.\n/);
  assert.doesNotMatch(prefs, /Someone who writes that they only want friends/);
  assert.match(prefs, /^Witty, with dry humour\./m);
  assert.doesNotMatch(prefs, /\{[a-z_]+\}/);
  const set = JSON.parse(fs.readFileSync(settingsFile(mc), "utf8"));
  assert.deepEqual([set.daily_start, set.timezone, set.retention_days, set.talk, set.browser, set.bridge, set.model, set.onboarded], ["20:00", "Europe/Vienna", 30, ["telegram"], "bridge", "http://10.0.0.5:3010", { lane: "claude", name: "sonnet" }, "2026-10-10"]);
  assert.deepEqual(readWatch(path.join(mc, "routines", "wingman", "watch.md")), ["Robin", "Lena"]);
  assert.equal(r.welcome, true);
  const queued = fs.readdirSync(statePaths(state).requests).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(statePaths(state).requests, n), "utf8")));
  assert.deepEqual(queued.map((q) => q.type), ["welcome"], "the worker sends the welcome, once");
  assert.match(io.text(), /welcome on Telegram/);
  assert.doesNotMatch(io.text(), /Plays VRChat.*Plays VRChat/s, "each choice listed once");
});

test("without Telegram there is no welcome; an existing page is kept unless the person picks a starter", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const prefsFile = path.join(mc, "routines", "wingman", "preferences.md");
  const before = fs.readFileSync(prefsFile, "utf8");
  const io = scripted(["", "k", "", "", "", "1", "", "", "", "n", "", "y"]);
  const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" } }) } });
  assert.equal(r.done, true, io.text());
  assert.equal(fs.readFileSync(prefsFile, "utf8"), before, "kept, byte for byte");
  assert.equal(r.welcome, false);
  assert.ok(!fs.existsSync(statePaths(state).requests) || !fs.readdirSync(statePaths(state).requests).some((n) => n.endsWith(".json")));
  assert.match(io.text(), /godspeed-wingman train/);
  assert.doesNotMatch(io.text(), /Telegram, through/, "Telegram is not offered where it is not set up");

  const no = scripted(["", "k", "", "", "", "1", "", "", "", "n", "", "n"]);
  const r2 = await terminalWizard({ mcDir: mc, stateDir: state, input: no.input, output: no.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected() } });
  assert.equal(r2.done, false, "a no at the end saves nothing");
  assert.match(no.text(), /Nothing was saved/);
});

test("the notebook list is offered only when the notebook answers, unticked unless the person says yes", async () => {
  const run = async (lines, over) => {
    const { mc, state } = tempMc({ onboarded: false });
    const io = scripted(lines);
    const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" }, ...over }) } });
    assert.equal(r.done, true, io.text());
    return { text: io.text(), set: JSON.parse(fs.readFileSync(settingsFile(mc), "utf8")) };
  };
  // sites, keep my page, daily, time zone, retention, [the list], talk, bridge, model, name, test, watch, save
  let r = await run(["", "k", "", "", "", "y", "1", "", "", "", "n", "", "y"], { notebook: { found: true } });
  assert.match(r.text, /Also keep a list of every like and pass in my Godspeed notebook \(it stays until I delete it\)\? \(y\/n\) \[n\]/, "offered, no by default");
  assert.match(r.text, /not deleted after the days you chose/);
  assert.equal(r.set.notebook_collection, true);
  r = await run(["", "k", "", "", "", "", "1", "", "", "", "n", "", "y"], { notebook: { found: true } });
  assert.equal(r.set.notebook_collection, false, "Enter keeps it off");
  r = await run(["", "k", "", "", "", "1", "", "", "", "n", "", "y"], { notebook: { found: false } });
  assert.doesNotMatch(r.text, /Godspeed notebook/, "not offered where the notebook does not answer");
  assert.notEqual(r.set.notebook_collection, true);
});

test("the model test runs only when asked, and makes one call", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const calls = [];
  const ask = async (q, model) => { calls.push(model); return "ready"; };
  const io = scripted(["", "k", "", "", "", "1", "", "", "", "y", "", "y"]);
  await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected(), ask } });
  assert.deepEqual(calls, [{ lane: "claude", name: "sonnet" }]);
  assert.match(io.text(), /It answered: ready/);
});

test("after setup: a desktop opens the desk at the wizard; no screen and no terminal says how; done is done", async () => {
  const quiet = async (fn) => { const log = console.log; const lines = []; console.log = (s) => lines.push(String(s)); try { await fn(); } finally { console.log = log; } return lines.join("\n"); };
  const { mc, state } = tempMc({ onboarded: false, desk_port: 47999 });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-home-"));
  const opened = [];
  const flags = { godspeed: mc, state, "no-service": true };
  let said = await quiet(() => afterSetup(flags, { env: {}, platform: "win32", root: false, home }, { deskUp: async () => true, open: (u) => opened.push(u), interactive: false }));
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^http:\/\/127\.0\.0\.1:47999\/\?t=[0-9a-f]{64}#setup$/);
  assert.match(said, /continues in your browser/);
  said = await quiet(() => afterSetup(flags, { env: {}, platform: "win32", root: false, home }, { deskUp: async () => false, open: (u) => opened.push(u), interactive: false }));
  assert.equal(opened.length, 1, "nobody watches and no desk answers: nothing opens, nothing blocks");
  assert.match(said, /godspeed-wingman desk --setup/);
  said = await quiet(() => afterSetup(flags, { env: {}, platform: "linux", root: false, home }, { interactive: false }));
  assert.match(said, /setup --wizard/, "a server without a terminal attached is told how to answer later");
  const s = JSON.parse(fs.readFileSync(settingsFile(mc), "utf8"));
  fs.writeFileSync(settingsFile(mc), JSON.stringify({ ...s, onboarded: "2026-10-10" }));
  said = await quiet(() => afterSetup(flags, { env: {}, platform: "win32", root: false, home }, { deskUp: async () => true, open: (u) => opened.push(u), interactive: false }));
  assert.equal(opened.length, 1, "already set up: nothing opens again");
  assert.equal(said, "");
  await quiet(() => afterSetup({ ...flags, wizard: true }, { env: {}, platform: "win32", root: false, home }, { deskUp: async () => true, open: (u) => opened.push(u), interactive: false }));
  assert.equal(opened.length, 2, "--wizard asks again");
});

test("the terminal wizard on a new install: the installer's blank page is not offered to keep, the starters come first", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const prefsFile = path.join(mc, "routines", "wingman", "preferences.md");
  fs.writeFileSync(prefsFile, PREFERENCES_TEMPLATE);
  const io = scripted([
    "",                        // sites
    "a person in my thirties", // me
    "4",                       // anyone who fits
    "", "", "", "",            // nothing more specific, ages, where, no places
    "1",                       // looking for a partner
    "", "", "5", "",           // no green flags, none of their own, only wants friends, none of their own
    "", "", "",                // tone, no sample, language
    "", "", "",                // daily, time zone, retention
    "", "", "", "", "n",       // talk, bridge, model, its name, no test
    "",                        // no names to watch
    "y",                       // save
  ]);
  const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" } }) } });
  assert.equal(r.done, true, io.text());
  assert.doesNotMatch(io.text(), /You already have a preferences page/);
  assert.match(io.text(), /Pick a starting point, so you never face a blank page/);
  assert.equal(r.result.prefs, "written");
  assert.equal(r.result.backup, null, "no copy of a blank page");
  assert.match(io.text(), /Saved\. Your preferences are written\./);
  const prefs = fs.readFileSync(prefsFile, "utf8");
  assert.match(prefs, /I am a person in my thirties, and I am looking for anyone who fits, whatever their gender, aged 21 to 45\./);
  assert.match(prefs, /or who is clearly not looking for someone like me/);
  assert.equal(prefs.match(/only want friends/g).length, 1, "the tick and the starter say it once together");

  // One real line in that page: now it is theirs, and the wizard asks before touching it.
  const own = PREFERENCES_TEMPLATE.replace("## Who fits\n", "## Who fits\n\n- Someone kind.\n");
  fs.writeFileSync(prefsFile, own);
  const io2 = scripted(["", "k", "", "", "", "1", "", "", "", "n", "", "y"]);
  const r2 = await terminalWizard({ mcDir: mc, stateDir: state, input: io2.input, output: io2.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" } }) } });
  assert.equal(r2.done, true, io2.text());
  assert.match(io2.text(), /You already have a preferences page\. Keep it \(k\), or start from a starter \(s\)\? \[k\]/);
  assert.equal(fs.readFileSync(prefsFile, "utf8"), own, "kept, byte for byte");
});

test("the terminal wizard keeps the host connection without a second model login", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const io = scripted(["", "k", "", "", "", "1", "", "", "n", "", "y"]);
  const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" }, lanes: [{ lane: "godspeed", label: "Use Godspeed connection", found: true, where: "existing connection", name: "" }] }) } });
  assert.equal(r.done, true, io.text());
  assert.deepEqual(r.answers.model, { lane: "godspeed", name: "" });
  assert.doesNotMatch(io.text(), /codex login|install Codex|model's name/);
});

test("the terminal wizard with Claude Code or Codex found says nothing about installing", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const io = scripted(["", "k", "", "", "", "1", "", "", "", "n", "", "y"]);
  const r = await terminalWizard({ mcDir: mc, stateDir: state, input: io.input, output: io.output, sys: { env: {}, platform: "linux", root: false }, deps: { detect: detected({ telegram: { found: false, file: "" } }) } });
  assert.equal(r.done, true, io.text());
  assert.doesNotMatch(io.text(), /Neither Codex nor Claude Code|chatgpt\.com\/codex/);
});
