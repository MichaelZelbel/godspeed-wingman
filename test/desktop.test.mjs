// Notifications on this computer: the command each system gets, discreet words (never a
// stranger's name), a click that opens the desk, quiet while the desk is open, and a failure that
// is logged and never stops anything. No real notification is shown here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import * as desktop from "../lib/channels/desktop.mjs";
import { tell, readiness } from "../lib/channels/index.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { writeJson } from "../lib/core/store.mjs";
import { deskSecret } from "../lib/desk/secret.mjs";

const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const decode = (args) => Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");

test("Windows: a toast through Windows PowerShell and WinRT, no modules, opened by protocol activation", () => {
  const url = "http://127.0.0.1:47860/?t=abc123#practice";
  const c = desktop.notifyCommand({ platform: "win32", env: { SystemRoot: "C:\\Windows" }, title: "Your Wingman", body: `Tom & Jerry's "test" <b>`, url });
  assert.equal(c.exe, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "Windows PowerShell, which can load WinRT types");
  assert.deepEqual(c.args.slice(0, 7), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand"]);
  const script = decode(c.args);
  assert.match(script, /\[Windows\.UI\.Notifications\.ToastNotificationManager, Windows\.UI\.Notifications, ContentType = WindowsRuntime\]/);
  assert.match(script, /CreateToastNotifier\('\{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7\}\\WindowsPowerShell\\v1\.0\\powershell\.exe'\)\.Show\(\$t\)/);
  assert.doesNotMatch(script, /Import-Module|Install-Module/);
  assert.match(script, /<toast activationType="protocol" launch="http:\/\/127\.0\.0\.1:47860\/\?t=abc123#practice">/);
  assert.match(script, /<text>Tom &amp; Jerry&apos;s &quot;test&quot; &lt;b&gt;<\/text>/, "XML-escaped, so no quote can end PowerShell's single-quoted string");
  assert.equal(script.match(/LoadXml\((.*)\)$/m)[1].replace(/^'|'$/g, "").includes("'"), false);
  assert.match(script, /<action content="Open the desk" activationType="protocol" arguments="http:\/\/127\.0\.0\.1:47860\/\?t=abc123#practice"\/>/);
});

test("macOS: osascript display notification; Linux: notify-send, without the desk's key", () => {
  const mac = desktop.notifyCommand({ platform: "darwin", title: "Your Wingman", body: 'A "quoted" \\ word\nand a line' });
  assert.equal(mac.exe, "/usr/bin/osascript");
  assert.deepEqual(mac.args, ["-e", 'display notification "A \\"quoted\\" \\\\ word and a line" with title "Your Wingman"']);
  const lin = desktop.notifyCommand({ platform: "linux", env: { PATH: "" }, title: "Your Wingman", body: "A match waits.", url: "http://127.0.0.1:47860/?t=abc123#matches" });
  assert.equal(lin.exe, "notify-send");
  assert.deepEqual(lin.args, ["--app-name=Godspeed Wingman", "--icon=dialog-information", "Your Wingman", "A match waits.\nhttp://127.0.0.1:47860/#matches"]);
});

test("the words are discreet: what waits, never who", () => {
  const cases = [
    ["From your Wingman: practice (you agreed with 3 of my last 4). Mara, 27 (DE): I would LIKE them, high sure. Loves teasing.", /practice question/, "practice"],
    ["From your Wingman: review. On 2026-10-09 I liked Juno, 31 (NL): funny bio", /review question/, "practice"],
    ["From your Wingman: Sam, 29 (AT) is on your watch list: their name matches \"Sam\".", /watch list/, "practice"],
    ["From your Wingman: new match with Kiri, 25 (SE). Three ways to open:\n1) hi", /new match/i, "matches"],
    ["From your Wingman: Robin, 30 (DE) wrote: \"hey\"\nThree replies:\n1) x", /new message/i, "matches"],
    ["From your Wingman: Flirtual logged me out, so I cannot pick", /logged the Wingman out/, "status"],
    ["From your Wingman: still open from 2026-10-08, and today's session waits for it.\npractice. Lena", /earlier day/, "practice"],
  ];
  for (const [text, want, page] of cases) {
    const s = desktop.summary(text);
    assert.match(s.body, want, text);
    assert.equal(s.page, page, text);
    for (const name of ["Mara", "Juno", "Sam", "Kiri", "Robin", "Lena", "teasing", "hey"]) assert.ok(!s.body.includes(name), `${name} stays off the screen`);
  }
});

test("the channel: one notification that opens the desk at the right page; quiet while the desk is open", async () => {
  const paths = statePaths(temp("wingman-dt-"));
  const shown = [];
  const settings = { talk: ["desk", "desktop"], desk_port: 47860 };
  const ok = await desktop.send({ text: "From your Wingman: new match with Kiri. Three ways to open:", settings, paths, deps: { notify: async (n) => { shown.push(n); return true; } } });
  assert.equal(ok, true);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].url, `http://127.0.0.1:47860/?t=${deskSecret(paths)}#matches`);
  await desktop.send({ text: "x", settings: { talk: ["desktop"], desk_port: 47860 }, paths, deps: { notify: async (n) => { shown.push(n); return true; } } });
  assert.equal(shown[1].url, "", "no desk chosen: nothing to open");
  writeJson(path.join(paths.desk, "seen.json"), { at: new Date().toISOString() });
  assert.equal(await desktop.send({ text: "From your Wingman: practice. Mara", settings, paths, deps: { notify: async (n) => { shown.push(n); return true; } } }), true, "the desk shows it already");
  assert.equal(shown.length, 2, "so no notification on top");
  writeJson(path.join(paths.desk, "seen.json"), { at: new Date(Date.now() - 60000).toISOString() });
  await desktop.send({ text: "From your Wingman: practice. Mara", settings, paths, deps: { notify: async (n) => { shown.push(n); return true; } } });
  assert.equal(shown.length, 3, "the desk was closed a minute ago");
});

test("notify waits for the system's answer; a failure is logged by the fan-out and never stops the others", async () => {
  const fakeSpawn = (code, err = "") => () => {
    const c = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    setImmediate(() => { if (err) c.stderr.emit("data", err); c.emit("close", code); });
    return c;
  };
  assert.equal(await desktop.notify({ body: "x", platform: "linux", env: { PATH: "" }, spawnImpl: fakeSpawn(0) }), true);
  await assert.rejects(desktop.notify({ body: "x", platform: "linux", env: { PATH: "" }, spawnImpl: fakeSpawn(1, "Cannot autolaunch D-Bus") }), /notify-send said no \(exit 1\): Cannot autolaunch D-Bus/);
  await assert.rejects(desktop.notify({ body: "x", platform: "linux", env: { PATH: "" }, spawnImpl: () => { throw Object.assign(new Error("spawn notify-send ENOENT"), { code: "ENOENT" }); } }), /ENOENT/);
  const lines = [];
  const paths = statePaths(temp("wingman-dt-"));
  const r = await tell("From your Wingman: practice. Mara", null, {
    settings: { talk: ["desktop", "desk"], desk_port: 47860 }, paths, log: (l) => lines.push(l),
    impls: { desktop: (a) => desktop.send({ ...a, deps: { notify: () => Promise.reject(new Error("no notification service")) } }) },
  });
  assert.equal(r.delivered, true, "the desk still has it");
  assert.match(r.results.desktop, /no notification service/);
  assert.match(lines.join("\n"), /talk: desktop did not take the message: no notification service/);
});

test("check says whether notifications can work here", async () => {
  assert.deepEqual(desktop.ready({ platform: "win32" }), { ok: true, why: "Windows notifications" });
  assert.deepEqual(desktop.ready({ platform: "darwin" }), { ok: true, why: "macOS notifications" });
  assert.equal(desktop.ready({ platform: "linux", env: {} }).ok, false, "a server without a desktop session");
  assert.match(desktop.ready({ platform: "linux", env: { DISPLAY: ":0", PATH: "" } }).why, /notify-send is not installed/);
  const lines = await readiness({ talk: ["desktop"], desk_port: 47860 }, statePaths(temp("wingman-dt-")));
  assert.equal(lines[0].name, "desktop");
  assert.equal(typeof lines[0].ok, "boolean");
});
