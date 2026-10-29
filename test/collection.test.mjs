// The collection "Wingman: likes and passes" in the notebook, the screenshots named by day and
// name, and the retention.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeWorker, user, FakeNotebook, setMode, settingsFile, result } from "./helpers.mjs";
import * as requests from "../lib/core/requests.mjs";
import * as archive from "../lib/core/archive.mjs";
import * as collection from "../lib/core/collection.mjs";
import { Notebook } from "../lib/core/notebook.mjs";
import { loadSettings, DEFAULTS } from "../lib/core/settings.mjs";
import { appendJsonl, readJsonl } from "../lib/core/store.mjs";
import { normalize } from "../lib/sites/flirtual/profile.mjs";

// The list is off unless the settings switch it on, so every test of what it holds switches it on.
const listWorker = (users, opts = {}) => makeWorker(users, { ...opts, settings: { notebook_collection: true, ...(opts.settings || {}) } });
const answer = async (w, decision, reason = "") => { requests.submit(w.paths, "answer", { decision, reason }); await w.tick(); };
// The next tick may write the collection (at most once a minute).
const later = async (h, ms = 61000) => { h.advance(ms); h.w.update((s) => { s.nextActionAt = 0; }); await h.w.tick(); };
const byName = (nb) => Object.fromEntries(nb.list().map((i) => [i.data.name, i]));

// Profiles and decisions already kept, with a picture still called page.png, nothing in the
// notebook yet.
async function keptBefore(h, people) {
  for (const p of people) {
    const profile = normalize(user(p.id, p.name, p.extra || {}), new Date(p.at));
    delete profile.raw;
    const day = p.at.slice(0, 10);
    const entry = await archive.save(h.w.paths, { day, site: "flirtual", raw: {}, profile, screenshot: null, html: "<p>x</p>", source: "queue", fetchImpl: async () => ({ ok: false }) });
    fs.writeFileSync(path.join(h.w.paths.archive, entry.dir, "page.png"), Buffer.from(`png of ${p.name}`));
    for (const d of p.decisions) appendJsonl(h.w.paths.decisions, { site: "flirtual", id: p.id, name: p.name, ...d });
  }
}

test("the retention is 42 days unless the settings say otherwise", () => {
  assert.equal(DEFAULTS.retention_days, 42);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-set-"));
  const f = path.join(dir, "settings.json");
  fs.writeFileSync(f, "{}");
  assert.equal(loadSettings(f).retention_days, 42);
  fs.writeFileSync(f, JSON.stringify({ retention_days: 183 }));
  assert.equal(loadSettings(f).retention_days, 183);
  fs.writeFileSync(f, JSON.stringify({ retention_days: "forever" }));
  assert.equal(loadSettings(f).retention_days, 42);
});

test("backfill: every decision already made becomes one item, in the order decided, with its first line", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z", screenshotsUrl: "https://srv.example/wingman" });
  await keptBefore(h, [
    { id: "u_test_001", name: "Ilka", at: "2026-10-09T12:00:00Z", extra: { country: "de" }, decisions: [{ at: "2026-10-09T12:30:00Z", action: "asked", verdict: "like", reason: "You both build worlds in VRChat." }, { at: "2026-10-09T12:39:00Z", action: "like", by: "you", reason: "", judge: "like" }] },
    { id: "u_test_002", name: "Odile", at: "2026-10-10T12:00:00Z", extra: { country: "fr" }, decisions: [{ at: "2026-10-10T12:42:00Z", action: "pass", by: "wingman", reason: "They want to meet in person soon." }] },
    { id: "u_test_003", name: "Asked Only", at: "2026-10-10T13:00:00Z", decisions: [{ at: "2026-10-10T13:00:00Z", action: "asked", verdict: "pass" }] },
  ]);
  await h.w.tick();
  const items = h.nb.list();
  assert.equal(items.length, 2, "an open question is not a like or a pass yet");
  const inserts = h.nb.calls.filter((c) => c[0] === "insertItem").map((c) => c[1]);
  assert.deepEqual(inserts.map((v) => v.data.name), ["Ilka", "Odile"], "oldest first, so the newest is the newest item");
  assert.deepEqual(inserts.map((v) => v.created_at), ["2026-10-09T12:39:00Z", "2026-10-10T12:42:00Z"]);
  const ilka = byName(h.nb).Ilka;
  assert.deepEqual({ ...ilka.data }, {
    seen: "2026-10-09", name: "Ilka", age: 26, gender: "Cis Woman", location: "Germany", site: "Flirtual", decision: "liked", decided_by: "you",
    reason: "You both build worlds in VRChat.", profile: "https://flirtu.al/u_test_001", discord: "",
    screenshot: "https://srv.example/wingman/2026-10-09/2026-10-09%20Ilka%20u_test_0.png",
  });
  assert.equal(ilka.source_id, "flirtual:u_test_001");
  assert.equal(byName(h.nb).Odile.data.decided_by, "the Wingman");
  assert.equal(byName(h.nb).Odile.data.reason, "They want to meet in person soon.");
  assert.equal(byName(h.nb).Odile.data.location, "France");
  assert.ok(!("comment" in ilka.data), "the Wingman never writes the comment");
  // The collection itself: hidden from every assistant, a comment column, one link to the screenshots.
  const made = h.nb.calls.find((c) => c[0] === "createCollection")[1];
  assert.equal(made.name, "Wingman: likes and passes");
  assert.equal(made.ai_visibility, "hidden");
  assert.equal(made.source_app, "godspeed-wingman");
  assert.ok(made.field_schema.some((f) => f.key === "comment"));
  assert.ok(made.field_schema.some((f) => f.key === "site"));
  assert.deepEqual(made.field_schema.map((f) => f.key).slice(7, 9), ["decided_by", "reason"], "the reason right after Decided by");
  assert.equal((made.description.match(/https:\/\//g) || []).length, 1);
  assert.match(made.description, /https:\/\/srv\.example\/wingman/);
  assert.match(made.description, /kept 42 days/);
  assert.ok(!collection.OWNED.includes("comment"));
  // Again, nothing changes: one item per profile.
  await later(h);
  assert.equal(h.nb.list().length, 2);
  assert.equal(h.nb.calls.filter((c) => c[0] !== "createCollection").length, 2);
});

test("a like or pass reaches the collection; a second decision on the same profile updates its item", async () => {
  const h = listWorker([user("a1", "Mara", { country: "de" }), user("b2", "Juno")]);
  await h.w.tick();
  await answer(h.w, "agree");
  await later(h);
  assert.equal(h.nb.list().length, 1);
  assert.equal(byName(h.nb).Mara.data.decision, "liked");
  // Later the site shows the same profile again and the owner passes this time.
  appendJsonl(h.w.paths.decisions, { at: new Date(Date.parse("2026-10-03T18:31:00Z") + 7200000).toISOString(), site: "flirtual", id: "a1", name: "Mara", action: "pass", by: "you" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(h.nb.list().filter((i) => i.data.name === "Mara").length, 1);
  assert.equal(byName(h.nb).Mara.data.decision, "passed");
});

test("the person's comment is never overwritten or cleared, not even when they save at the same moment", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await h.w.tick();
  await answer(h.w, "agree");
  await later(h);
  const mara = byName(h.nb).Mara;
  h.nb.comment(mara.id, "Met in the Blue Room, lovely voice");
  // A new decision changes the Wingman's columns.
  appendJsonl(h.w.paths.decisions, { at: "2026-10-04T10:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "pass", by: "wingman" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(byName(h.nb).Mara.data.comment, "Met in the Blue Room, lovely voice");
  assert.equal(byName(h.nb).Mara.data.decision, "passed");
  // The person saves exactly between the Wingman's read and its write: the notebook refuses the
  // stale write, nothing of theirs is lost, and the next round writes over their version.
  const real = h.nb.updateItem.bind(h.nb);
  let once = true;
  h.nb.updateItem = async (id, data, hash) => { if (once) { once = false; h.nb.comment(id, "changed my mind, write on Discord"); } return real(id, data, hash); };
  appendJsonl(h.w.paths.decisions, { at: "2026-10-04T11:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "like", by: "you" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(byName(h.nb).Mara.data.comment, "changed my mind, write on Discord");
  assert.equal(byName(h.nb).Mara.data.decision, "passed", "the stale write was refused");
  await later(h);
  assert.equal(byName(h.nb).Mara.data.comment, "changed my mind, write on Discord");
  assert.equal(byName(h.nb).Mara.data.decision, "liked", "the next round wrote it over their version");
  // A column added by the person stays too.
  h.nb.itemsById.get(mara.id).data.met = true;
  appendJsonl(h.w.paths.decisions, { at: "2026-10-04T12:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "pass", by: "you" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(byName(h.nb).Mara.data.met, true);
  for (const c of h.nb.calls.filter((x) => x[0] === "updateItem")) assert.ok(c[2].comment !== "" && c[2].comment !== null);
});

test("a review answer shows on the item", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno")]);
  setMode(h.w, "auto");
  await h.w.tick();
  await later(h);
  assert.equal(byName(h.nb).Mara.data.decided_by, "the Wingman");
  requests.submit(h.w.paths, "review", { count: 1 });
  await h.w.tick();
  await answer(h.w, "disagree", "too far away");
  await later(h);
  // The review goes through the newest autopilot decision first: Juno.
  assert.equal(byName(h.nb).Juno.data.decided_by, "the Wingman; on review you would have passed");
  assert.equal(byName(h.nb).Juno.data.decision, "liked", "a review never changes what was done on the site");
  assert.equal(byName(h.nb).Mara.data.decided_by, "the Wingman");
});

test("hostile names reach the collection as plain short text, and links only go where they should", async () => {
  const evil = "<img src=x onerror=alert(1)>[click](javascript:alert(1)) ![](http://t.example/p.png) [[Real Person]] `rm` {x} \"q\" | $HOME";
  const h = listWorker([], { at: "2026-10-10T16:00:00Z", screenshotsUrl: "javascript:alert(1)" });
  await keptBefore(h, [{ id: "../../etc", name: evil, at: "2026-10-10T12:00:00Z", decisions: [{ at: "2026-10-10T12:30:00Z", action: "like", by: "you" }] }]);
  const p = path.join(h.w.paths.archive, "2026-10-10", "flirtual.______etc", "profile.json");
  const prof = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...prof, url: "javascript:alert(1)", contact: { discord: "<b>dc</b>\nnext line" } }));
  await h.w.tick();
  const it = h.nb.list()[0];
  for (const v of Object.values(it.data)) {
    if (typeof v !== "string") continue;
    assert.doesNotMatch(v, /[<>\[\]{}"`|$\n]/, v);
    assert.doesNotMatch(v, /javascript:/i, v);
  }
  assert.ok(it.data.name.length <= 40);
  assert.equal(it.data.profile, "https://flirtu.al/etc");
  assert.equal(it.data.discord, "b dc /b next line");
  assert.equal(it.data.screenshot, undefined, "no screenshot link to an address that is not https");
  const made = h.nb.calls.find((c) => c[0] === "createCollection")[1];
  assert.doesNotMatch(made.description, /javascript/);
  // The picture's file name holds no path and nothing Windows refuses.
  const shots = fs.readdirSync(path.join(h.w.paths.screenshots, "2026-10-10"));
  assert.equal(shots.length, 1);
  assert.doesNotMatch(shots[0], /[\/\\:*?"<>|]/);
});

test("a profile link is the kept one only on the site's own host", () => {
  const meta = { home: "https://flirtu.al", profile_url: "https://flirtu.al/{id}" };
  assert.equal(collection.profileLink("https://flirtu.al/abc", "abc", meta), "https://flirtu.al/abc");
  assert.equal(collection.profileLink("https://evil.example/abc", "abc", meta), "https://flirtu.al/abc");
  assert.equal(collection.profileLink("https://evil.example/abc", "abc", {}), "", "without the site's own address, nothing");
});

test("columns are left alone once the kept profile is gone; the notebook being away is retried", async () => {
  const h = listWorker([user("a1", "Mara", { country: "de" }), user("b2", "Juno")]);
  h.nb.down = true;
  await h.w.tick();
  await answer(h.w, "agree");
  await later(h);
  assert.equal(h.nb.list().length, 0);
  h.nb.down = false;
  await later(h);
  assert.equal(byName(h.nb).Mara.data.location, "Germany");
  fs.rmSync(h.w.paths.archive, { recursive: true, force: true });
  appendJsonl(h.w.paths.decisions, { at: "2026-10-04T10:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "pass", by: "you" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(byName(h.nb).Mara.data.decision, "passed");
  assert.equal(byName(h.nb).Mara.data.location, "Germany");
  assert.equal(byName(h.nb).Mara.data.age, 26);
});

test("screenshots are named by day and name, also the ones kept before, and the open question follows", async () => {
  const h = listWorker([user("u_test_001", "Ilka"), user("b2", "Juno")]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = { goto: async () => {}, evaluate: async () => [], screenshot: async () => Buffer.from("PNG"), content: async () => "<html></html>" };
  await h.w.tick();
  const w0 = h.w.state.waiting;
  const dir = path.join(h.w.paths.archive, w0.dir);
  assert.ok(fs.existsSync(path.join(dir, "2026-10-03 Ilka u_test_0.png")), fs.readdirSync(dir).join(","));
  assert.equal(path.basename(h.told[0].picture), "2026-10-03 Ilka u_test_0.png");
  const link = path.join(h.w.paths.screenshots, "2026-10-03", "2026-10-03 Ilka u_test_0.png");
  assert.equal(fs.readFileSync(link, "utf8"), "PNG");
  // As an older version kept it: page.png, and the open question pointing at it.
  fs.renameSync(path.join(dir, "2026-10-03 Ilka u_test_0.png"), path.join(dir, "page.png"));
  fs.rmSync(h.w.paths.screenshots, { recursive: true, force: true });
  h.w.update((s) => { s.waiting.picture = path.join(dir, "page.png"); });
  h.w.nameShots();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".png")), ["2026-10-03 Ilka u_test_0.png"]);
  assert.ok(fs.existsSync(link));
  assert.equal(h.w.state.waiting.picture, path.join(dir, "2026-10-03 Ilka u_test_0.png"));
  assert.equal(h.w.state.waiting.id, w0.id);
  assert.equal(h.w.state.waiting.notifiedAt, w0.notifiedAt, "the question itself is untouched");
  // "who --photo" finds the renamed picture.
  const hit = archive.search(h.w.paths, "Ilka")[0];
  assert.equal(path.basename(archive.picturePath(h.w.paths, hit)), "2026-10-03 Ilka u_test_0.png");
  // Running it again changes nothing.
  assert.deepEqual(archive.nameShots(h.w.paths), []);
  // An open question whose picture moved without it is still sent with the picture.
  h.w.update((s) => { s.waiting.picture = path.join(dir, "page.png"); });
  assert.equal(path.basename(h.w.pictureOf(h.w.state.waiting)), "2026-10-03 Ilka u_test_0.png");
  // After the retention both names of the picture go.
  h.setNow("2026-11-20T10:00:00Z");
  await h.w.tick();
  assert.ok(!fs.existsSync(link));
  assert.ok(!fs.existsSync(dir));
});

test("the notebook client sends the requests the notebook's screens send", async () => {
  const sent = [];
  const nb = new Notebook({ base: "http://127.0.0.1:1/", fetchImpl: async (url, opt) => {
    sent.push({ url, body: JSON.parse(opt.body) });
    if (JSON.parse(opt.body).expected?.i1 === "old") return { ok: false, status: 409, json: async () => ({ error: "This record changed.", code: "CONFLICT" }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "i1" }], error: null }) };
  } });
  assert.deepEqual(await nb.insertItem({ collection_id: "c1", data: { name: "x" } }), { id: "i1" });
  await nb.updateItem("i1", { name: "y" }, "h1");
  await assert.rejects(nb.updateItem("i1", { name: "z" }, "old"), (e) => e.status === 409 && e.code === "CONFLICT");
  assert.equal(sent[0].url, "http://127.0.0.1:1/api/query");
  assert.deepEqual(sent[0].body, { table: "collection_items", operation: "insert", values: { collection_id: "c1", data: { name: "x" } } });
  assert.deepEqual(sent[1].body, { table: "collection_items", operation: "update", values: { data: { name: "y" } }, filters: [["eq", "id", "i1"]], expected: { i1: "h1" } });
  // A collection's columns: only the field_schema is sent, with the version read just before.
  await nb.updateCollection("c1", { field_schema: [{ key: "name" }] }, "h2");
  assert.deepEqual(sent[3].body, { table: "collections", operation: "update", values: { field_schema: [{ key: "name" }] }, filters: [["eq", "id", "c1"]], expected: { c1: "h2" } });
});

test("a collection the person deleted is not made again", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno")]);
  await h.w.tick();
  await answer(h.w, "agree");
  await later(h);
  const id = h.w.state.collection.id;
  h.nb.collections.get(id).removed_at = "2026-10-04T00:00:00Z";
  appendJsonl(h.w.paths.decisions, { at: "2026-10-04T10:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "pass", by: "you" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(h.nb.collections.size, 1);
  assert.equal(h.w.state.collection.removed, true);
  assert.equal(byName(h.nb).Mara.data.decision, "liked");
});

test("the collection can be switched off", async () => {
  const h = makeWorker([user("a1", "Mara"), user("b2", "Juno")], { settings: { notebook_collection: false } });
  await h.w.tick();
  await answer(h.w, "agree");
  await later(h);
  assert.equal(h.nb.calls.length, 0);
  assert.equal(loadSettings(settingsFile(h.mc)).notebook_collection, false);
});

test("the list is off unless the settings say true: nothing reaches the notebook, and asking for it says how to switch it on", async () => {
  assert.equal(DEFAULTS.notebook_collection, false);
  for (const settings of [{}, { notebook_collection: "yes" }, { notebook_collection: 1 }]) {
    const h = makeWorker([user("a1", "Mara"), user("b2", "Juno")], { settings });
    assert.equal(loadSettings(settingsFile(h.mc)).notebook_collection, false, JSON.stringify(settings));
    await h.w.tick();
    await answer(h.w, "agree");
    await later(h);
    await later(h);
    assert.ok(readJsonl(h.w.paths.decisions).some((d) => d.action === "like" || d.action === "pass"), "a like or pass was made");
    assert.equal(h.nb.calls.length, 0, `nothing written to the notebook with ${JSON.stringify(settings)}`);
    assert.equal(h.nb.list().length, 0);
    const id = requests.submit(h.w.paths, "notebook", {});
    await h.w.tick();
    const r = result(h.w, id);
    assert.equal(r.ok, false);
    assert.match(r.text, /is off\. Switch it on in the setup questions, or with "notebook_collection": true in the settings\./);
    assert.equal(h.nb.calls.length, 0, "asking for it does not write it either");
  }
});

test("FakeNotebook refuses a stale version like the notebook does", async () => {
  const nb = new FakeNotebook();
  const c = await nb.createCollection({ name: "x" });
  const i = await nb.insertItem({ collection_id: c.id, data: {} });
  nb.comment(i.id, "mine");
  await assert.rejects(nb.updateItem(i.id, { a: 1 }, i._hash), (e) => e.status === 409);
});

// ---- the reason ---------------------------------------------------------------------------------

test("the reason: the Wingman's for its own decisions, the person's words, the Wingman's when they agreed without words, else empty", async () => {
  const beer = { biography: "<p>Beer every night.</p>" };
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno", beer), user("c3", "Sam"), user("d4", "Kiri"), user("e5", "Robin")]);
  await h.w.tick();
  assert.equal(h.w.state.waiting.name, "Mara");
  await answer(h.w, "agree");
  await later(h);
  assert.equal(h.w.state.waiting.name, "Juno");
  await answer(h.w, "disagree", "she plays horror worlds, my favourite");
  await later(h);
  assert.equal(h.w.state.waiting.name, "Sam");
  await answer(h.w, "disagree");
  await later(h);
  assert.equal(h.w.state.waiting.name, "Kiri");
  await answer(h.w, "agree", "lovely voice");
  await later(h);
  const got = byName(h.nb);
  assert.equal(got.Mara.data.reason, "VRChat with full-body tracking.", "agreed without words: the Wingman's reason");
  assert.equal(got.Juno.data.reason, "she plays horror worlds, my favourite", "their own words");
  assert.equal(got.Sam.data.reason, "", "they disagreed without words: nothing to say");
  assert.equal(got.Kiri.data.reason, "lovely voice", "their words come first, also when they agreed");
  // The decision log now keeps the reason the Wingman gave with its verdict.
  const mara = readJsonl(h.w.paths.decisions).find((d) => d.id === "a1" && d.action === "like");
  assert.equal(mara.judgeReason, "VRChat with full-body tracking.");
  for (const it of h.nb.list()) assert.ok(!("comment" in it.data), "the Wingman never writes the comment");
});

test("the reason on autopilot is the Wingman's own, and stays it after a review", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno", { biography: "<p>Beer, beer, beer.</p>" })]);
  setMode(h.w, "auto");
  await h.w.tick();
  await later(h);
  await later(h);
  assert.equal(byName(h.nb).Mara.data.reason, "VRChat with full-body tracking.");
  assert.equal(byName(h.nb).Juno.data.reason, "They drink a lot, not your thing.", "the judge's dash is gone, as on the screen");
  requests.submit(h.w.paths, "review", { count: 1 });
  await h.w.tick();
  await answer(h.w, "disagree", "beer is fine with me");
  await later(h);
  assert.equal(byName(h.nb).Juno.data.decided_by, "the Wingman; on review you would have liked");
  assert.equal(byName(h.nb).Juno.data.reason, "They drink a lot, not your thing.", "the reason for what was done");
});

test("an agreement done on the next session keeps the Wingman's reason", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno")]);
  h.fl.likesLeft = 0;
  await h.w.tick();
  await answer(h.w, "agree");
  assert.equal(h.w.state.decided["flirtual:a1"].judgeReason, "VRChat with full-body tracking.");
  h.fl.likesLeft = 10;
  h.setNow("2026-10-04T18:31:00Z");
  h.w.update((s) => { s.lastInboxAt = Date.parse("2026-10-04T18:31:00Z"); });
  await h.w.tick();
  await later(h);
  assert.equal(byName(h.nb).Mara.data.reason, "VRChat with full-body tracking.");
});

test("reasonFor reads older records too, and says nothing it does not know", () => {
  const like = (x) => ({ action: "like", ...x });
  const asked = { action: "asked", verdict: "like", reason: "You both love horror worlds." };
  assert.equal(collection.reasonFor(like({ by: "wingman", reason: "Same timezone as you." })), "Same timezone as you.");
  assert.equal(collection.reasonFor(like({ by: "wingman" })), "", "no reason kept");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "  great   laugh " }), asked), "great laugh");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "", judge: "like", judgeReason: "Quest and full-body tracking." }), asked), "Quest and full-body tracking.");
  // Written by 0.6.1: the answer carries the verdict but not its reason; the question asked holds it.
  assert.equal(collection.reasonFor(like({ by: "you", reason: "", judge: "like" }), asked), "You both love horror worlds.");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "" }), asked), "You both love horror worlds.", "a decision done the next session");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "", judge: "pass" }), asked), "", "they disagreed");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "" }), { ...asked, verdict: "pass" }), "", "they disagreed");
  // A watch-list stop: "you said like" is what the Wingman kept, not their words.
  assert.equal(collection.reasonFor(like({ by: "you", reason: "you said like", watch: "Tamsin" }), { action: "stopped" }), "");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "an old friend", watch: "Tamsin" }), { action: "stopped" }), "an old friend");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "" }), { action: "pass", by: "wingman", reason: "Too far away." }), "", "a new decision without a question says nothing");
  assert.equal(collection.reasonFor(like({ by: "you", reason: "", judge: "like" })), undefined, "the question is gone with the retention: left as it is");
  // Short, and plain text.
  const long = collection.reasonFor(like({ by: "you", reason: `${"really ".repeat(60)}nice` }));
  assert.ok(long.length <= 200, String(long.length));
  assert.match(long, /^really really .*really…$/);
  assert.equal(collection.reasonFor(like({ by: "you", reason: "<b>sweet</b> `x` {y}\nand \"kind\"" })), "b sweet /b x y and kind");
});

// ---- adding the reason to a collection an older Wingman made -------------------------------------

// The collection as 0.6.1 made it, with a column of the person's own and a label they changed, and
// one item with their comment.
function oldCollection(nb, { extra = [{ key: "met", label: "Met in VR", type: "boolean" }], drop = [] } = {}) {
  const fields = collection.FIELDS.filter((f) => f.key !== "reason" && !drop.includes(f.key)).map((f) => ({ ...f }));
  const by = fields.find((f) => f.key === "decided_by");
  if (by) by.label = "Who decided";
  fields.push(...extra);
  const c = { ...collection.shape("", 42), field_schema: fields, id: "coll-old", slug: "wingman-likes-and-passes" };
  nb.collections.set(c.id, c);
  nb.stamp(c);
  const it = { id: "item-old", collection_id: c.id, source_app: "godspeed-wingman", source_id: "flirtual:u_test_001", data: { name: "Ilka", decision: "liked", decided_by: "you", comment: "Lovely voice", met: true } };
  nb.itemsById.set(it.id, it);
  nb.stamp(it);
  return { fields: structuredClone(fields), item: it };
}
const ilka = [{ id: "u_test_001", name: "Ilka", at: "2026-10-09T12:00:00Z", decisions: [{ at: "2026-10-09T12:30:00Z", action: "asked", verdict: "like", reason: "You both build worlds in VRChat." }, { at: "2026-10-09T12:39:00Z", action: "like", by: "you", reason: "", judge: "like" }] }];

test("an older collection gets the Reason column after Decided by, and every other column stays as it is", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  const { fields } = oldCollection(h.nb);
  // As 0.6.1 remembered it: the id, no columns.
  h.w.update((s) => { s.collection = { id: "coll-old", slug: "wingman-likes-and-passes", total: 1, removed: false, at: "2026-10-09T13:00:00Z" }; });
  await keptBefore(h, ilka);
  await h.w.tick();
  const ups = h.nb.calls.filter((c) => c[0] === "updateCollection");
  assert.equal(ups.length, 1);
  assert.deepEqual(Object.keys(ups[0][2]), ["field_schema"], "only the columns change");
  const at = fields.findIndex((f) => f.key === "decided_by") + 1;
  assert.deepEqual(h.nb.collections.get("coll-old").field_schema, [...fields.slice(0, at), { key: "reason", label: "Reason", type: "text" }, ...fields.slice(at)]);
  assert.equal(h.nb.collections.size, 1, "no second collection");
  const it = h.nb.itemsById.get("item-old");
  assert.equal(it.data.reason, "You both build worlds in VRChat.");
  assert.equal(it.data.comment, "Lovely voice");
  assert.equal(it.data.met, true);
  assert.deepEqual([...h.w.state.collection.columns].sort(), collection.FIELDS.map((f) => f.key).sort(), "it remembers the reason is its own now");
  // Done once: the next round has nothing to add.
  appendJsonl(h.w.paths.decisions, { at: "2026-10-10T17:00:00Z", site: "flirtual", id: "u_test_001", name: "Ilka", action: "pass", by: "you", reason: "she moved away" });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(h.nb.calls.filter((c) => c[0] === "updateCollection").length, 1);
  assert.equal(h.nb.itemsById.get("item-old").data.reason, "she moved away");
  assert.equal(h.nb.itemsById.get("item-old").data.comment, "Lovely voice");
});

test("a Reason column the person made themselves in an older collection stays theirs: never written, nothing added", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  const { fields } = oldCollection(h.nb, { extra: [{ key: "reason", label: "Reason", type: "longtext" }] });
  h.nb.itemsById.get("item-old").data.reason = "my own note";
  await keptBefore(h, [...ilka, { id: "u_test_002", name: "Odile", at: "2026-10-10T12:00:00Z", decisions: [{ at: "2026-10-10T12:42:00Z", action: "pass", by: "wingman", reason: "They want to meet in person soon." }] }]);
  await h.w.tick();
  assert.equal(h.nb.calls.filter((c) => c[0] === "updateCollection").length, 0);
  assert.deepEqual(h.nb.collections.get("coll-old").field_schema, fields);
  assert.equal(h.nb.itemsById.get("item-old").data.reason, "my own note");
  assert.ok(!("reason" in byName(h.nb).Odile.data), "not on a new item either");
  assert.ok(!h.w.state.collection.columns.includes("reason"));
  appendJsonl(h.w.paths.decisions, { at: "2026-10-10T17:00:00Z", site: "flirtual", id: "u_test_001", name: "Ilka", action: "pass", by: "wingman", reason: "Too far away." });
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(h.nb.itemsById.get("item-old").data.decision, "passed");
  assert.equal(h.nb.itemsById.get("item-old").data.reason, "my own note");
});

test("a column the person deleted is not put back, and a change they make to the columns at that moment is kept", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  oldCollection(h.nb, { drop: ["discord", "decided_by"] });
  await keptBefore(h, ilka);
  // The person changes the columns between the Wingman's read and its write.
  const real = h.nb.updateCollection.bind(h.nb);
  let once = true;
  h.nb.updateCollection = async (id, values, hash) => {
    if (once) { once = false; const c = h.nb.collections.get(id); c.field_schema = [...c.field_schema, { key: "vibe", label: "Vibe", type: "text" }]; h.nb.stamp(c); }
    return real(id, values, hash);
  };
  await h.w.tick();
  assert.ok(!h.nb.collections.get("coll-old").field_schema.some((f) => f.key === "reason"), "the stale write was refused");
  assert.equal(h.nb.itemsById.get("item-old").data.comment, "Lovely voice");
  await later(h);
  const keys = h.nb.collections.get("coll-old").field_schema.map((f) => f.key);
  assert.deepEqual(keys, ["seen", "name", "age", "gender", "location", "site", "decision", "reason", "profile", "screenshot", "comment", "met", "vibe"],
    "added after the column before it, theirs kept, the deleted ones not back");
  assert.equal(h.nb.itemsById.get("item-old").data.reason, "You both build worlds in VRChat.");
});

test("a Wingman that forgot which columns are its own (moved to another computer) still knows its Reason from the person's", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  // Made by 0.6.2 elsewhere: the Reason is the Wingman's. Nothing in this Wingman's state.
  const c = { ...collection.shape("", 42), field_schema: structuredClone(collection.FIELDS), id: "coll-new", slug: "wingman-likes-and-passes" };
  h.nb.collections.set(c.id, c);
  h.nb.stamp(c);
  await keptBefore(h, ilka);
  await h.w.tick();
  assert.equal(h.nb.calls.filter((x) => x[0] === "updateCollection").length, 0);
  assert.equal(h.nb.list()[0].data.reason, "You both build worlds in VRChat.");
  // A "Reason" the person added to an older one in the notebook's editor: a text column, at the end.
  const old = [...collection.FIELDS.filter((f) => f.key !== "reason"), { key: "reason", label: "Reason", type: "text" }];
  assert.deepEqual(collection.ownColumns(old), collection.FIRST_COLUMNS);
  assert.deepEqual(collection.upgradeSchema(old, collection.ownColumns(old)).foreign, ["reason"]);
  assert.ok(collection.ownColumns(collection.FIELDS).includes("reason"));
});

test("upgradeSchema only ever adds", () => {
  const first = collection.FIELDS.filter((f) => f.key !== "reason");
  assert.equal(collection.upgradeSchema(collection.FIELDS, collection.FIELDS.map((f) => f.key)).schema, null, "a collection made with the reason");
  const up = collection.upgradeSchema([...first].reverse());
  assert.deepEqual(up.added, ["reason"]);
  assert.equal(up.schema.length, first.length + 1);
  const keys = up.schema.map((f) => f.key);
  assert.equal(keys[keys.indexOf("decided_by") + 1], "reason");
  assert.deepEqual(keys.filter((k) => k !== "reason"), [...first].reverse().map((f) => f.key), "nothing moved");
  assert.deepEqual(collection.upgradeSchema([]).schema.map((f) => f.key), ["reason"]);
});
