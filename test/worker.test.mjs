import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeWorker, user, setMode, settingsFile, watchFile, result } from "./helpers.mjs";
import * as requests from "../lib/core/requests.mjs";
import { render } from "../lib/core/context.mjs";
import { loadSettings } from "../lib/core/settings.mjs";

const answer = async (w, decision, reason = "") => {
  requests.submit(w.paths, "answer", { decision, reason });
  await w.tick();
};

test("nothing happens before the daily start time", async () => {
  const { w, fl, told } = makeWorker([user("a1", "Mara")], { at: "2026-10-03T17:00:00Z" });
  await w.tick();
  assert.equal(w.state.run, null);
  assert.equal(fl.responses.length, 0);
  assert.equal(told.length, 0);
});

test("practice: the first profile is asked about, nothing is liked until the owner answers", async () => {
  const { w, fl, told } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  assert.equal(w.state.run.why, "daily");
  assert.deepEqual(w.state.run.sites, ["flirtual"]);
  assert.equal(w.state.waiting.kind, "practice");
  assert.equal(w.state.waiting.site, "flirtual");
  assert.equal(w.state.waiting.verdict, "like");
  assert.equal(fl.responses.length, 0, "no like before the answer");
  assert.match(told[0].text, /^From your Wingman: practice\. Mara, \d+: I would LIKE them/);
  assert.match(told[0].text, /Say "agree", or "disagree" and why/);
  await w.tick();
  assert.equal(told.length, 1, "the question is not repeated while it waits");
});

test("practice: agree likes them, disagree does the opposite and keeps the reason", async () => {
  const { w, fl } = makeWorker([user("a1", "Mara"), user("b2", "Juno"), user("c3", "Kiri")]);
  await w.tick();
  await answer(w, "agree");
  assert.deepEqual(fl.responses[0], { type: "like", userId: "a1" });
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  assert.equal(w.state.waiting.name, "Juno");
  await answer(w, "disagree", "their bio says they are shy about ERP");
  assert.deepEqual(fl.responses[1], { type: "pass", userId: "b2" });
  const ex = fs.readFileSync(w.paths.examples, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(ex.length, 2);
  assert.equal(ex[1].agreed, false);
  assert.equal(ex[1].reason, "their bio says they are shy about ERP");
  assert.equal(ex[1].judge, "like");
  assert.equal(ex[1].owner, "pass");
  assert.equal(ex[1].site, "flirtual", "every example carries its site");
});

test("the judge reads the owner's corrections as examples", async () => {
  const { w, calls } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  await answer(w, "disagree", "too young for me");
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  const last = calls.filter((c) => c.prompt.includes("THE PROFILE TO JUDGE")).pop();
  assert.match(last.prompt, /The owner said PASS \(a correction\) because: too young for me/);
  assert.match(last.prompt, /People who play VRChat/);
  assert.match(last.system, /on Flirtual, a dating site for people who meet in virtual reality/);
});

test("nine of ten agreed switches the site to autopilot, and says so once", async () => {
  const users = Array.from({ length: 13 }, (_, i) => user(`u${i}`, `Person${i}`));
  const { w } = makeWorker(users);
  let last = "";
  for (let i = 0; i < 10; i++) {
    w.update((s) => { s.nextActionAt = 0; });
    await w.tick();
    const id = requests.submit(w.paths, "answer", { decision: i === 3 ? "disagree" : "agree", reason: i === 3 ? "no" : "" });
    await w.tick();
    last = result(w, id).text;
  }
  assert.equal(w.state.sites.flirtual.mode, "auto");
  assert.match(last, /agreed with me 9 of the last 10 times, so from now on I like and pass there by myself/);
});

test("autopilot likes and passes by itself and waits 10 s to 3 min between profiles", async () => {
  const beer = user("b2", "Juno", { biography: "<p>I drink beer every night in club worlds</p>" });
  const { w, fl, told } = makeWorker([user("a1", "Mara"), beer]);
  setMode(w, "auto");
  await w.tick();
  assert.deepEqual(fl.responses, [{ type: "like", userId: "a1" }]);
  const gap = w.state.nextActionAt - new Date("2026-10-03T18:31:00Z").getTime();
  assert.ok(gap >= 10000 && gap <= 180000, `gap ${gap}`);
  await w.tick();
  assert.equal(fl.responses.length, 1, "waits for the pause");
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  assert.deepEqual(fl.responses[1], { type: "pass", userId: "b2" });
  assert.equal(told.length, 0, "autopilot is silent");
  const d = fs.readFileSync(w.paths.decisions, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(d[1].reason, "They drink a lot, not your thing.", "no em dash reaches the owner");
  assert.equal(d[1].by, "wingman");
  assert.equal(d[1].site, "flirtual");
});

test("the session ends when the site has no more profiles or no more likes", async () => {
  const { w, fl } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  setMode(w, "auto");
  fl.likesLeft = 1;
  await w.tick();
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  assert.equal(w.state.run, null);
  assert.match(w.state.lastRun.why, /Flirtual says no more likes today/);
  const { w: w2, fl: fl2 } = makeWorker([]);
  setMode(w2, "auto");
  await w2.tick();
  assert.equal(w2.state.run, null);
  assert.match(w2.state.lastRun.why, /Flirtual has no more profiles for today/);
  assert.equal(fl2.responses.length, 0);
});

test("a watch-list name stops everything until the owner decides", async () => {
  const { w, fl, told, mc } = makeWorker([user("y1", "Lady Tamsin"), user("b2", "Juno")]);
  fs.writeFileSync(watchFile(mc), "# Watch\n\n- Tamsin\n");
  setMode(w, "auto");
  await w.tick();
  assert.equal(fl.responses.length, 0);
  assert.equal(w.state.waiting.kind, "watch");
  assert.match(told[0].text, /is on your watch list: their name matches "Tamsin"\. I stopped before liking or passing/);
  await w.tick();
  assert.equal(fl.responses.length, 0, "still waiting");
  await answer(w, "like");
  assert.deepEqual(fl.responses[0], { type: "like", userId: "y1" });
  assert.equal(w.state.waiting, null);
});

test("matches and messages get three reply ideas once, and send 2 sends the second", async () => {
  const { w, fl, told } = makeWorker([user("a1", "Mara"), user("b2", "Juno")], { at: "2026-10-03T10:00:00Z" });
  fl.convs = [
    { id: "c1", user_id: "a1", last_message: { id: "m1", content: "Hey, nice avatar!", sender_id: "a1", system: false } },
    { id: "c2", user_id: "b2", last_message: null },
    { id: "c3", user_id: "a1", last_message: { id: "m3", content: "my own", sender_id: "me123" } },
  ];
  await w.tick();
  assert.equal(told.length, 2);
  assert.match(told[0].text, /Mara, \d+ wrote: "Hey, nice avatar!"\nThree replies:\n1\) one, hi\n2\) two\n3\) three/);
  assert.match(told[1].text, /new match with Juno, \d+\. Three ways to open/);
  w.update((s) => { s.lastInboxAt = 0; });
  await w.tick();
  assert.equal(told.length, 2, "not reported twice");
  const id = requests.submit(w.paths, "send", { option: 2, to: "R1" });
  await w.tick();
  assert.deepEqual(fl.sent, [{ conversationId: "c1", text: "two" }]);
  assert.equal(result(w, id).text, 'Sent to Mara: "two"');
  requests.submit(w.paths, "send", { option: 1 });
  await w.tick();
  assert.deepEqual(fl.sent[1], { conversationId: "c2", text: "one, hi" }, "only Juno's ideas were left open, so send 1 goes there");
});

test("with ideas open for two people, send without a name asks which one", async () => {
  const { w, fl } = makeWorker([user("a1", "Mara"), user("b2", "Juno")], { at: "2026-10-03T10:00:00Z" });
  fl.convs = [
    { id: "c1", user_id: "a1", last_message: { id: "m1", content: "Hey!", sender_id: "a1" } },
    { id: "c2", user_id: "b2", last_message: null },
  ];
  await w.tick();
  const id = requests.submit(w.paths, "send", { option: 2 });
  await w.tick();
  const res = result(w, id);
  assert.equal(res.ok, false);
  assert.match(res.text, /Reply ideas are waiting for .*Mara.*Juno|Juno.*Mara/);
  assert.equal(fl.sent.length, 0);
});

test("a lost login stops the session and tells the owner once a day", async () => {
  const { w, fl, told, advance } = makeWorker([user("a1", "Mara")], { at: "2026-10-03T10:00:00Z" });
  await w.tick();
  assert.equal(w.state.sites.flirtual.me, "me123", "the first inbox check learned the account");
  fl.loggedIn = false;
  w.update((s) => { s.lastInboxAt = 0; });
  await w.tick();
  w.update((s) => { s.lastInboxAt = 0; s.lastRunDay = null; });
  advance(60000);
  await w.tick();
  const notices = told.filter((t) => /logged me out/.test(t.text));
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /Flirtual logged me out, so I cannot pick or read messages there until you log in again/);
  assert.equal(w.state.run, null);
  assert.ok(w.state.sites.flirtual.loggedOutAt);
});

test("before the first login nobody is messaged", async () => {
  const { w, fl, told } = makeWorker([user("a1", "Mara")]);
  fl.loggedIn = false;
  await w.tick();
  assert.equal(told.length, 0);
  assert.match(w.state.lastError.text, /Flirtual logged the Wingman out/);
});

test("a late practice answer still brings the next profile", async () => {
  const { w, told, setNow } = makeWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await w.tick();
  setNow("2026-10-04T02:00:00Z");
  w.update((s) => { s.lastInboxAt = new Date("2026-10-04T02:00:00Z").getTime(); s.lastPruneDay = "2026-10-04"; });
  await answer(w, "agree");
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  assert.equal(w.state.waiting?.name, "Juno");
  assert.equal(told.length, 2);
});

test("every profile is kept, findable by Discord name, and deleted after the retention (42 days unless chosen)", async () => {
  const { w, setNow } = makeWorker([user("a1", "Mara", { discord: "mara_dc" })]);
  await w.tick();
  const { search } = await import("../lib/core/archive.mjs");
  const hits = search(w.paths, "mara_dc");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Mara");
  assert.equal(hits[0].site, "flirtual");
  assert.match(hits[0].dir, /^2026-10-03\/flirtual\.a1$/);
  assert.ok(fs.existsSync(`${w.paths.archive}/${hits[0].dir}/raw.json`));
  setNow("2026-11-10T10:00:00Z"); // five and a half weeks later: kept
  await w.tick();
  assert.equal(search(w.paths, "mara_dc").length, 1);
  setNow("2026-11-20T10:00:00Z"); // past 42 days: gone
  await w.tick();
  assert.equal(search(w.paths, "mara_dc").length, 0);
  assert.equal(fs.readdirSync(w.paths.archive).filter((n) => /^\d{4}/.test(n)).length, 0);
});

test("the assistant sees the open question with the command that answers it", async () => {
  const { w, mc } = makeWorker([user("a1", "Mara")]);
  await w.tick();
  const out = render(w.paths, loadSettings(settingsFile(mc)));
  assert.match(out, /^\[godspeed-wingman\]/);
  assert.match(out, /OPEN PRACTICE QUESTION about Mara on Flirtual: the Wingman said LIKE/);
  assert.match(out, /godspeed-wingman answer disagree --about a1 --reason/);
  assert.doesNotMatch(out, /\b(she|her|he|him|his)\b/i);
  const { w: quiet, mc: mc2 } = makeWorker([], { at: "2026-10-03T10:00:00Z" });
  assert.equal(render(quiet.paths, loadSettings(settingsFile(mc2))), "");
});

test("a practice round the owner asks for runs even on autopilot, then returns to it", async () => {
  const { w, fl, told } = makeWorker([user("a1", "Mara"), user("b2", "Juno"), user("c3", "Kiri")], { at: "2026-10-03T10:00:00Z" });
  setMode(w, "auto");
  w.update((s) => { s.lastInboxAt = Date.now() + 1e12; });
  requests.submit(w.paths, "train", { count: 1 });
  await w.tick();
  assert.equal(w.state.waiting.kind, "practice");
  const id = requests.submit(w.paths, "answer", { decision: "agree" });
  await w.tick();
  assert.match(result(w, id).text, /Back on autopilot/);
  w.update((s) => { s.nextActionAt = 0; });
  await w.tick();
  assert.equal(fl.responses.length, 2, "the next one goes by itself");
  assert.equal(told.length, 1);
});
