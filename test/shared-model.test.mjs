import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ask, describeGodspeed, ModelError } from "../lib/core/model.mjs";
import { defaults, normalizeSettings } from "../lib/core/settings.mjs";
import { godspeedModelProgram } from "../lib/core/godspeed-model.mjs";
import { detect, modelHelp } from "../lib/onboarding/index.mjs";
import { makeWorker, user, setMode, tempMc } from "./helpers.mjs";
import { findMissionControl, isDockerModelHost } from "../lib/core/paths.mjs";
import os from "node:os";

function host(mc, body) {
  const file = path.join(mc, ".godspeed", "model.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}
const noPrograms = { PATH: "", Path: "" };

test("a Docker server model host is discovered only from its exact installer marker; native workspaces keep priority", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-docker-host-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-empty-user-"));
  const opts = { cwd: empty, userHome: empty, env: {}, platform: "linux", serverDir: dir };
  host(dir, "console.log(JSON.stringify({text:'ready',provider:'configured-host',model:'chosen-model'}));");
  fs.writeFileSync(path.join(dir, "compose.yaml"), "services:\n  godspeed:\n    image: fixture\n");
  assert.equal(findMissionControl(opts), null, "a compose file and script alone do not fake a personal workspace");
  const markerFile = path.join(dir, ".godspeed", "model-host.json");
  const marker = { format: 1, kind: "godspeed-docker", service: "godspeed", workspace: "/opt/data/full-candidate/workspace" };
  for (const bad of [{ ...marker, service: "another-service" }, { ...marker, workspace: "/etc" }, { ...marker, command: "anything" }]) {
    fs.writeFileSync(markerFile, JSON.stringify(bad));
    assert.equal(isDockerModelHost(dir), false);
    assert.equal(findMissionControl(opts), null);
  }
  fs.writeFileSync(markerFile, JSON.stringify(marker));
  assert.equal(isDockerModelHost(dir), true);
  assert.equal(findMissionControl(opts), dir);
  assert.equal(findMissionControl({ ...opts, arg: dir }), dir);
  assert.equal(findMissionControl({ ...opts, platform: "win32" }), null, "no automatic Linux server fallback on another OS");
  const { mc } = tempMc();
  assert.equal(findMissionControl({ ...opts, cwd: mc }), mc, "the native workspace was not replaced by an unrelated server install");
  assert.equal(await ask({ system: "s", prompt: "p" }, {}, { mcDir: dir, env: noPrograms }), "ready");
  assert.equal(fs.existsSync(path.join(dir, "AGENTS.md")), false);
});

test("new installs inherit Godspeed; explicit standalone choices survive and cannot override its model", () => {
  assert.deepEqual(defaults().model, { lane: "godspeed", name: "" });
  assert.deepEqual(normalizeSettings({ model: { lane: "godspeed", name: "other-provider" } }).model, { lane: "godspeed", name: "" });
  assert.deepEqual(normalizeSettings({ model: { lane: "claude", name: "opus" } }).model, { lane: "claude", name: "opus" });
  assert.deepEqual(normalizeSettings({ model: { lane: "openai", name: "chosen-model" } }).model, { lane: "openai", name: "chosen-model" });
});

test("host launcher is found without PATH on a background worker, and every request uses the host's current choice", async () => {
  const { mc } = tempMc();
  const choice = path.join(mc, ".godspeed", "test-choice.json");
  const file = host(mc, `import fs from 'node:fs'; import path from 'node:path';
    let input=''; for await (const c of process.stdin) input += c;
    const a=process.argv.slice(2), workspace=a[a.indexOf('--workspace')+1];
    const choice=JSON.parse(fs.readFileSync(path.join(workspace,'.godspeed','test-choice.json')));
    if(a.includes('--check')) console.log(JSON.stringify({configured:true,...choice}));
    else { const j=JSON.parse(input); console.log(JSON.stringify({text:JSON.stringify({verdict:'like',reason:j.system+'|'+j.prompt}),...choice})); }
  `);
  assert.deepEqual(godspeedModelProgram({ mcDir: mc, env: noPrograms }), { exe: process.execPath, args: [file] });
  fs.writeFileSync(choice, JSON.stringify({ provider: "local", model: "first-model" }));
  const receipts = [];
  const a = await ask({ system: "rules", prompt: "invented profile" }, {}, { mcDir: mc, env: noPrograms, onReceipt: (r) => receipts.push(r) });
  assert.equal(JSON.parse(a).reason, "rules|invented profile");
  assert.deepEqual(await describeGodspeed({ mcDir: mc, env: noPrograms }), { provider: "local", model: "first-model" });
  fs.writeFileSync(choice, JSON.stringify({ provider: "other-service", model: "second-model" }));
  await ask({ system: "rules", prompt: "invented profile" }, {}, { mcDir: mc, env: noPrograms, onReceipt: (r) => receipts.push(r) });
  assert.deepEqual(receipts.map((r) => r.model), ["first-model", "second-model"]);
  const found = await detect({ mcDir: mc, env: noPrograms, notebook: { collectionsBy: async () => [] } });
  assert.equal(found.lanes[0].lane, "godspeed");
  assert.equal(found.lanes[0].found, true);
  assert.equal(modelHelp({ lanes: found.lanes }), null);
});

test("missing, broken and malformed host connections fail without launching another provider", async () => {
  const { mc } = tempMc();
  await assert.rejects(ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: { ...noPrograms, GODSPEED_MODEL_COMMAND: path.join(mc, "missing") } }), /shared model command was not found/);
  host(mc, "process.stderr.write('connection unavailable'); process.exit(1);");
  await assert.rejects(ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: noPrograms }), (e) => e instanceof ModelError && /connection unavailable/.test(e.message));
  host(mc, "console.log('not-json');");
  await assert.rejects(ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: noPrograms }), /unreadable model answer/);
  host(mc, "console.log(JSON.stringify({text:'answer',provider:'local'}));");
  await assert.rejects(ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: noPrograms }), /no complete model answer/);
});

test("shared model JSON survives a UTF-8 character split across real child stdout chunks", async () => {
  const { mc } = tempMc();
  host(mc, `const bytes=Buffer.from(JSON.stringify({text:'Grüße 👩‍🚀',provider:'local',model:'chosen'}));
    const split=bytes.indexOf(0xc3)+1;
    process.stdout.write(bytes.subarray(0,split));
    setTimeout(()=>process.stdout.write(bytes.subarray(split)),30);`);
  assert.equal(await ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: noPrograms }), "Grüße 👩‍🚀");
});

test("oversized child output fails closed instead of accumulating without a bound", async () => {
  const { mc } = tempMc();
  host(mc, "process.stdout.write('x'.repeat(1024*1024+1));");
  await assert.rejects(ask({ system: "s", prompt: "p" }, {}, { mcDir: mc, env: noPrograms }), /too much output/);
});

test("AI quota failure pauses before actions and retries one undelivered warning while paused", async () => {
  let up = false;
  const { w, fl, told, advance } = makeWorker([user("u_test_001", "Mara")], { telegramUp: () => up });
  w.deps.ask = async () => { throw new ModelError(new Error("usage limit reached")); };
  setMode(w, "auto");
  await w.tick();
  assert.equal(w.state.paused, true);
  assert.equal(w.state.run, null);
  assert.deepEqual(fl.responses, []);
  assert.deepEqual(fl.queueIds, ["u_test_001"]);
  assert.equal(told.length, 0);
  up = true;
  advance(6 * 60000);
  await w.tick();
  assert.equal(told.length, 1);
  advance(6 * 60000);
  await w.tick();
  assert.equal(told.length, 1);
});

test("an inbox model failure keeps the message unhandled and prevents a daily session in the same tick", async () => {
  const { w, fl } = makeWorker([user("u_test_002", "Juno")]);
  fl.convs = [{ id: "c_test_001", user_id: "u_test_002", last_message: { id: "m_test_001", content: "Hi", sender_id: "u_test_002" } }];
  w.deps.ask = async () => { throw new ModelError(new Error("connection unavailable")); };
  await w.tick();
  assert.equal(w.state.paused, true);
  assert.equal(w.state.run, null);
  assert.equal(w.state.sites.flirtual.reported.c_test_001, undefined);
  assert.deepEqual(fl.responses, []);
});
