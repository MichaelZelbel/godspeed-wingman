// An answer the owner calls a one-off exception: the site gets their like or pass, the answer is
// kept for the record, and the Wingman never learns from it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeWorker, user, setMode, settingsFile, result } from "./helpers.mjs";
import * as requests from "../lib/core/requests.mjs";
import * as training from "../lib/core/training.mjs";
import { render } from "../lib/core/context.mjs";
import { loadSettings } from "../lib/core/settings.mjs";

const answer = async (w, body) => {
  const id = requests.submit(w.paths, "answer", body);
  await w.tick();
  return result(w, id);
};
const kept = (w) => fs.readFileSync(w.paths.examples, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("an exception likes them on the site but never reaches the judge or the tally", async () => {
  const { w, fl, calls } = makeWorker([user("a1", "Mara", { biography: "<p>beer and friends</p>" }), user("b2", "Juno")]);
  await w.tick();
  assert.equal(w.state.waiting.verdict, "pass");
  const r = await answer(w, { decision: "disagree", reason: "only in this case, a friend for the photo group", about: "a1", exception: true });
  assert.equal(r.text, "Noted: you liked Mara because only in this case, a friend for the photo group. A one-off exception: I do not learn from it. Next one in a moment.");
  assert.deepEqual(fl.responses[0], { type: "like", userId: "a1" });
  const ex = kept(w);
  assert.equal(ex.length, 1, "kept for the record");
  assert.equal(ex[0].exception, true);
  assert.equal(training.examples(w.paths).length, 0, "the judge does not read it");
  assert.equal(training.agreement(w.paths, 10, "flirtual").of, 0, "the tally does not count it");
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  const last = calls.filter((c) => c.prompt.includes("THE PROFILE TO JUDGE")).pop();
  assert.doesNotMatch(last.prompt, /photo group/);
});

test("without the flag the same answer still teaches, as before", async () => {
  const { w } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  await answer(w, { decision: "disagree", reason: "too young", about: "a1" });
  assert.equal(kept(w)[0].exception, undefined);
  assert.equal(training.examples(w.paths).length, 1);
});

test("a review answered as an exception is reviewed once and not taught", async () => {
  const { w } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  setMode(w, "auto");
  await w.tick();
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  requests.submit(w.paths, "review", { count: 5 });
  await w.tick();
  const first = w.state.waiting;
  assert.equal(first.kind, "review");
  const r = await answer(w, { decision: "disagree", reason: "just this once", about: first.id, exception: true });
  assert.match(r.text, /^Noted for \S+, as an exception I do not learn from\./);
  assert.equal(training.examples(w.paths).filter((e) => e.id === first.id).length, 0);
  // The next review skips it: an exception still counts as reviewed.
  if (w.state.waiting) await answer(w, { decision: "agree", about: w.state.waiting.id });
  requests.submit(w.paths, "review", { count: 5 });
  await w.tick();
  assert.equal(w.state.waiting, null, "nothing left to review");
});

test("the assistant's block names the flag", async () => {
  const { w, mc } = makeWorker([user("a1", "Mara")]);
  await w.tick();
  assert.match(render(w.paths, loadSettings(settingsFile(mc))), /add `--exception` when they call it a one-off/);
});

test("an answer already given can be made an exception afterwards, by its id or the name", async () => {
  const { w, fl } = makeWorker([user("a1", "Mara"), user("b2", "Juno"), user("c3", "Kiri")]);
  await w.tick();
  await answer(w, { decision: "disagree", reason: "a friend only", about: "a1" });
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  await answer(w, { decision: "agree", about: "b2" });
  assert.equal(training.examples(w.paths).length, 2);
  // Juno's profile is the one that came after; marking Mara leaves Juno's answer alone.
  const id = requests.submit(w.paths, "exception", { about: "a1" });
  await w.tick();
  const r = result(w, id);
  assert.equal(r.ok, true);
  assert.match(r.text, /^Your answer about Mara is now a one-off exception: I no longer learn from it\./);
  assert.deepEqual(training.examples(w.paths).map((e) => e.id), ["b2"]);
  assert.equal(kept(w).length, 2, "nothing is deleted");
  assert.equal(fl.responses.length, 2, "the site is not touched");
  const byName = requests.submit(w.paths, "exception", { about: "juno" });
  await w.tick();
  assert.match(result(w, byName).text, /about Juno is now/);
  assert.equal(training.examples(w.paths).length, 0);
  const none = requests.submit(w.paths, "exception", { about: "zz9" });
  await w.tick();
  assert.equal(result(w, none).ok, false);
});
