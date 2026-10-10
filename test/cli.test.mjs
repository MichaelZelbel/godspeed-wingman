// The command exactly as the assistant runs it: a separate process that drops a request and waits
// for the worker's answer, while the worker ticks here.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorker, user } from "./helpers.mjs";
import { loadCommands, parse, flagSpec } from "../lib/commands/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "godspeed-wingman.mjs");

function cli(args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "", ...env } });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function withTicks(w, promise) {
  let done = false;
  promise.then(() => { done = true; });
  while (!done) { await w.tick(); await new Promise((r) => setTimeout(r, 200)); }
  return promise;
}

test("answer from the command line reaches the worker and comes back as one sentence", async () => {
  const { w, fl, mc, state } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  const r = await withTicks(w, cli(["answer", "disagree", "--reason", "they only want friends", "--godspeed", mc, "--state", state]));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "Noted: you passed on Mara because they only want friends. Next one in a moment.");
  assert.deepEqual(fl.responses[0], { type: "pass", userId: "a1" });
});

test("an unquoted reason keeps every word, and the profile id still arrives", async () => {
  const { w, fl, mc, state } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  const r = await withTicks(w, cli(["answer", "disagree", "--reason", "too", "young", "--for", "me", "--about", "a1", "--godspeed", mc, "--state", state]));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "Noted: you passed on Mara because too young --for me. Next one in a moment.");
  assert.deepEqual(fl.responses[0], { type: "pass", userId: "a1" });
});

test("the command says so when the worker is not running", async () => {
  const { w, mc, state } = makeWorker([user("a1", "Mara")]);
  await w.tick();
  fs.writeFileSync(path.join(state, "heartbeat.json"), JSON.stringify({ at: "2026-01-01T00:00:00Z" }));
  const r = await cli(["answer", "agree", "--godspeed", mc, "--state", state]);
  assert.equal(r.code, 3);
  assert.match(r.out, /not running right now\. This is saved and done as soon as it is back/);
});

test("context, status and who work without the worker", async () => {
  const { w, mc, state } = makeWorker([user("a1", "Mara", { discord: "mara_dc" })]);
  await w.tick();
  const ctx = await cli(["context", "--godspeed", mc, "--state", state]);
  assert.match(ctx.out, /OPEN PRACTICE QUESTION about Mara/);
  const hook = await cli(["context", "--hook", "claude", "--godspeed", mc, "--state", state]);
  const j = JSON.parse(hook.out);
  assert.equal(j.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(j.hookSpecificOutput.additionalContext, /^\[godspeed-wingman\]/);
  const st = await cli(["status", "--godspeed", mc, "--state", state]);
  assert.match(st.out, /Mode: practice \(every decision waits for your answer\) on Flirtual/);
  assert.match(st.out, /Waiting for you: practice question about Mara/);
  const who = await cli(["who", "MaraVR", "--godspeed", mc, "--state", state]);
  assert.match(who.out, /^Mara \(in your queue, 2026-10-03\): seen\. VRChat name MaraVR, Discord mara_dc\. https:\/\/flirtu\.al\/a1$/);
  const nobody = await cli(["who", "Zelda", "--godspeed", mc, "--state", state]);
  assert.match(nobody.out, /Nobody called "Zelda"/);
});

test("watch list and preferences are edited in mission control's files", async () => {
  const { mc, state } = makeWorker([]);
  assert.match((await cli(["watch", "add", "Tamsin", "--godspeed", mc, "--state", state])).out, /Tamsin is on the watch list/);
  assert.match((await cli(["watch", "list", "--godspeed", mc, "--state", state])).out, /Watch list: Tamsin/);
  assert.match((await cli(["prefs", "add", "no smokers", "--godspeed", mc, "--state", state])).out, /Added to your preferences: no smokers/);
  assert.match((await cli(["prefs", "show", "--godspeed", mc, "--state", state])).out, /## Added later\n- no smokers \(\d{4}-\d{2}-\d{2}\)/);
});

test("--exception after a reason reaches the worker and keeps the reason whole", async () => {
  const { w, fl, mc, state } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  const r = await withTicks(w, cli(["answer", "disagree", "--about", "a1", "--reason", "only", "this", "time", "--exception", "--godspeed", mc, "--state", state]));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "Noted: you passed on Mara because only this time. A one-off exception: I do not learn from it. Next one in a moment.");
  assert.deepEqual(fl.responses[0], { type: "pass", userId: "a1" });
  const ex = JSON.parse(fs.readFileSync(path.join(state, "examples.jsonl"), "utf8").trim());
  assert.equal(ex.exception, true);
});

test("every request a command sends is one the worker accepts", async () => {
  const { TYPES } = await import("../lib/core/requests.mjs");
  const dir = path.join(HERE, "..", "lib", "commands");
  const sent = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    sent.push(...[...src.matchAll(/viaWorker\("([a-z-]+)"/g)].map((m) => m[1]), ...[...src.matchAll(/simple\("[a-z-]+", "([a-z-]+)"/g)].map((m) => m[1]));
  }
  assert.ok(sent.length >= 10, `found ${sent.length}`);
  for (const t of sent) assert.ok(TYPES.includes(t), `${t} is not accepted`);
});

test("a second worker stops at once, also under the supervisor, which then stops too", async () => {
  const { mc, state } = makeWorker([]);
  fs.writeFileSync(path.join(state, "worker.pid"), `${process.pid}\n`);
  const direct = await cli(["worker", "--godspeed", mc, "--state", state]);
  assert.equal(direct.code, 4);
  assert.match(direct.err, /Another godspeed-wingman worker is running; this one stops/);
  const supervised = await cli(["worker", "--supervise", "--godspeed", mc, "--state", state]);
  assert.equal(supervised.code, 4);
  assert.match(fs.readFileSync(path.join(state, "worker.log"), "utf8"), /supervisor: another worker is running, so this one stops/);
});

test("the registry finds every command file, and a flag a command declares is known everywhere", async () => {
  const commands = await loadCommands();
  for (const n of ["answer", "exception", "send", "who", "train", "review", "run", "pause", "resume", "inbox", "stop", "notebook", "prefs", "watch", "check", "context", "status", "worker", "setup", "uninstall", "help", "version"]) {
    assert.ok(commands.has(n), n);
  }
  const { flags, rest } = parse(["setup", "--site", "flirtual", "--talk", "desk,telegram", "--no-service", "--yes"], flagSpec(commands));
  assert.deepEqual(rest, ["setup"]);
  assert.deepEqual(flags, { site: "flirtual", talk: "desk,telegram", "no-service": true, yes: true });
  const h = await cli(["help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /godspeed-wingman 0\.5\.0/);
  assert.doesNotMatch(h.out, /_sync/, "hidden commands stay hidden");
  assert.equal((await cli(["version"])).out, "0.5.0");
  assert.equal((await cli(["nonsense"])).code, 1);
});
