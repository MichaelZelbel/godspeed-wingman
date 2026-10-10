// Several sites at once: the daily session goes site after site, practice and autopilot are per
// site (a new site starts in practice), the owner's answers teach the judge on every site, the
// inbox covers each site, and a lost login stops only its own site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorker, user, setMode, result } from "./helpers.mjs";
import * as requests from "../lib/core/requests.mjs";
import * as training from "../lib/core/training.mjs";
import { loadSite } from "../lib/sites/index.mjs";
import { SiteError } from "../lib/sites/errors.mjs";
import createFlirtual from "../lib/sites/flirtual/adapter.mjs";

const KIND_MEET = {
  id: "kindmeet", name: "Kind Meet", kind: "browser", home: "https://kindmeet.example", about: "Kind Meet, a dating site for testing",
  profile_url: "https://kindmeet.example/u/{id}",
  terms: { checked_on: "2026-10-01", urls: ["https://kindmeet.example/terms"], verdict: "allowed", quotes: ["x"] },
  can: ["queue", "like", "pass", "inbox", "send"],
};

// A second site, played in memory, keeping the same contract as any adapter.
class FakeSite {
  constructor(people = []) {
    this.people = new Map(people.map((p) => [p.id, p]));
    this.queueIds = people.map((p) => p.id);
    this.liked = []; this.passed = []; this.sent = []; this.convs = [];
    this.loggedIn = true;
  }
  check() { if (!this.loggedIn) throw new SiteError("Kind Meet shows no login", { loggedOut: true }); }
  async session() { return this.loggedIn ? { loggedIn: true, me: { id: "km-me", name: "me" } } : { loggedIn: false, me: null }; }
  async queue() { this.check(); return { next: this.queueIds.slice(0, 2), limits: null, done: this.queueIds.length === 0 }; }
  async profile(id) {
    this.check();
    const p = this.people.get(id);
    return { id, name: p.name, age: 30, gender: "", pronouns: "they/them", location: "", country: "nz", bio: p.bio || "", fields: {}, prompts: [], photos: [], url: `https://kindmeet.example/u/${id}`, contact: {}, raw: { id } };
  }
  async like(id) { this.check(); this.liked.push(id); this.queueIds = this.queueIds.filter((x) => x !== id); return { match: false, limitReached: false }; }
  async pass(id) { this.check(); this.passed.push(id); this.queueIds = this.queueIds.filter((x) => x !== id); return { match: false, limitReached: false }; }
  async conversations() { this.check(); return this.convs; }
  async send(conversationId, text) { this.check(); this.sent.push({ conversationId, text }); }
}

function twoSites(flirtualUsers, kindPeople, opts = {}) {
  const h = makeWorker(flirtualUsers, { ...opts, settings: { sites: ["flirtual", "kindmeet"], ...(opts.settings || {}) } });
  const km = new FakeSite(kindPeople);
  h.km = km;
  h.w.deps.loadSite = async (id) => (id === "kindmeet" ? { id, meta: KIND_MEET, create: null } : loadSite(id, { mcDir: h.mc }));
  h.w.deps.makeAdapter = (id, ctx) => (id === "kindmeet" ? km : createFlirtual({ ...ctx, api: h.fl }));
  return h;
}

const go = async (w) => { w.update((s) => { s.nextActionAt = 0; }); await w.tick(); };

test("the daily session goes site after site; a new site starts in practice while the first is on autopilot", async () => {
  const h = twoSites([user("a1", "Mara"), user("b2", "Juno")], [{ id: "k1", name: "Kiri" }]);
  setMode(h.w, "auto", "flirtual");
  await h.w.tick();
  assert.deepEqual(h.w.state.run.sites, ["flirtual", "kindmeet"]);
  await go(h.w);
  assert.deepEqual(h.fl.responses.map((r) => r.userId), ["a1", "b2"], "Flirtual on autopilot");
  await go(h.w);
  assert.equal(h.w.state.run.at, 1, "Flirtual had no more profiles, so the session moved on");
  await go(h.w);
  const w = h.w.state.waiting;
  assert.equal(w.kind, "practice");
  assert.equal(w.site, "kindmeet");
  assert.match(h.told[0].text, /^From your Wingman: practice\. Kiri, 30 \(NZ\) on Kind Meet: I would LIKE them/);
  assert.equal(h.w.state.sites.flirtual.mode, "auto");
  assert.equal(h.w.state.sites.kindmeet?.mode ?? "practice", "practice");
  const id = requests.submit(h.w.paths, "answer", { decision: "agree" });
  await h.w.tick();
  assert.match(result(h.w, id).text, /^Noted: you liked Kiri\./);
  assert.deepEqual(h.km.liked, ["k1"]);
  assert.equal(h.fl.responses.length, 2, "the like went to the site the profile is on");
  const ex = training.answers(h.w.paths);
  assert.equal(ex[0].site, "kindmeet");
  await go(h.w);
  assert.equal(h.w.state.run, null);
  assert.equal(h.w.state.lastRun.why, "Flirtual has no more profiles for today; Kind Meet has no more profiles for today");
  const decisions = fs.readFileSync(h.w.paths.decisions, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([...new Set(decisions.map((d) => d.site))], ["flirtual", "kindmeet"]);
});

test("taste is shared across sites, the tally is per site", async () => {
  const h = twoSites([user("a1", "Mara")], [{ id: "k1", name: "Kiri" }]);
  await h.w.tick();
  assert.equal(h.w.state.waiting.site, "flirtual");
  requests.submit(h.w.paths, "answer", { decision: "disagree", reason: "lives too far away" });
  await h.w.tick();
  await go(h.w); // Flirtual is done
  await go(h.w);
  assert.equal(h.w.state.waiting.site, "kindmeet");
  const judged = h.calls.filter((c) => c.prompt.includes("THE PROFILE TO JUDGE")).pop();
  assert.match(judged.prompt, /The owner said PASS \(a correction\) because: lives too far away/, "an answer given on Flirtual teaches the judge on Kind Meet");
  assert.match(judged.system, /on Kind Meet, a dating site for testing/);
  assert.equal(training.agreement(h.w.paths, 10, "flirtual").of, 1);
  assert.equal(training.agreement(h.w.paths, 10, "kindmeet").of, 0, "Kind Meet's tally starts at nothing");
});

test("the same id on two sites is two people", async () => {
  const h = twoSites([user("x1", "Mara")], [{ id: "x1", name: "Kiri" }]);
  setMode(h.w, "auto", "flirtual");
  setMode(h.w, "auto", "kindmeet");
  for (let i = 0; i < 4; i++) await go(h.w);
  const days = fs.readdirSync(path.join(h.w.paths.archive, "2026-10-03")).sort();
  assert.deepEqual(days, ["flirtual.x1", "kindmeet.x1"]);
  assert.deepEqual(h.fl.responses.map((r) => r.userId), ["x1"]);
  assert.deepEqual(h.km.liked, ["x1"]);
  const { search } = await import("../lib/core/archive.mjs");
  assert.deepEqual(search(h.w.paths, "").length, 0);
  assert.equal(search(h.w.paths, "Kiri")[0].site, "kindmeet");
  assert.equal(search(h.w.paths, "Mara")[0].site, "flirtual");
});

test("the inbox covers every site, and a reply goes back to the site it came from", async () => {
  const h = twoSites([user("a1", "Mara")], [{ id: "k1", name: "Kiri" }], { at: "2026-10-03T10:00:00Z" });
  h.fl.convs = [{ id: "c1", user_id: "a1", last_message: { id: "m1", content: "Hi there", sender_id: "a1" } }];
  h.km.convs = [{ id: "kc1", with: { id: "k1", name: "Kiri" }, messages: [{ id: "km1", fromMe: false, text: "Hello!", at: "2026-10-03T09:00:00Z" }] }];
  await h.w.tick();
  assert.equal(h.told.length, 2);
  assert.match(h.told[0].text, /Mara, 26 on Flirtual wrote: "Hi there"/);
  assert.match(h.told[1].text, /Kiri, 30 \(NZ\) on Kind Meet wrote: "Hello!"/);
  const replies = JSON.parse(fs.readFileSync(h.w.paths.replies, "utf8"));
  assert.deepEqual(Object.values(replies).map((r) => [r.id, r.site]), [["R1", "flirtual"], ["R2", "kindmeet"]]);
  const id = requests.submit(h.w.paths, "send", { option: 3, to: "R2" });
  await h.w.tick();
  assert.equal(result(h.w, id).text, 'Sent to Kiri: "three"');
  assert.deepEqual(h.km.sent, [{ conversationId: "kc1", text: "three" }]);
  assert.equal(h.fl.sent.length, 0);
  assert.deepEqual(h.w.state.sites.kindmeet.reported, { kc1: "km1" });
});

test("a lost login on one site stops only that site, and says which", async () => {
  const h = twoSites([user("a1", "Mara")], [{ id: "k1", name: "Kiri" }], { at: "2026-10-03T10:00:00Z" });
  setMode(h.w, "auto", "flirtual");
  await h.w.tick();
  assert.equal(h.w.state.sites.kindmeet.me, "km-me");
  h.km.loggedIn = false;
  h.setNow("2026-10-03T18:31:00Z");
  await h.w.tick();
  await go(h.w);
  await go(h.w);
  assert.deepEqual(h.fl.responses, [{ type: "like", userId: "a1" }], "Flirtual went on");
  const notices = h.told.filter((t) => /logged me out/.test(t.text));
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /Kind Meet logged me out/);
  assert.equal(h.w.state.run, null);
  assert.match(h.w.state.lastRun.why, /logged out of Kind Meet/);
  assert.ok(h.w.state.sites.kindmeet.loggedOutAt);
  assert.equal(h.w.state.sites.flirtual.loggedOutAt, null);
});

test("a practice round can be asked for one site only", async () => {
  const h = twoSites([user("a1", "Mara")], [{ id: "k1", name: "Kiri" }], { at: "2026-10-03T10:00:00Z" });
  h.w.update((s) => { s.lastInboxAt = Date.now() + 1e12; });
  const id = requests.submit(h.w.paths, "train", { count: 1, site: "kindmeet" });
  await h.w.tick();
  assert.match(result(h.w, id).text, /Practice round of 1 started/);
  assert.deepEqual(h.w.state.run.sites, ["kindmeet"]);
  assert.equal(h.w.state.waiting.site, "kindmeet");
  const bad = requests.submit(h.w.paths, "run", { site: "nowhere" });
  await h.w.tick();
  assert.equal(result(h.w, bad).ok, true, "a session is already running, so nothing changes");
});
