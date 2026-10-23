// Matches and conversations in the notebook list "Wingman: likes and passes", and `who` saying
// whether someone is in that list, with a link to their item.
//
// A person can reach the owner as a match or a conversation without the Wingman ever liking or
// passing them (the owner liked them in the site's own app). Such a person still gets an item:
// liked, by the owner on that site. A later like or pass by the Wingman takes the item over.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorker, user, settingsFile } from "./helpers.mjs";
import * as archive from "../lib/core/archive.mjs";
import * as collection from "../lib/core/collection.mjs";
import { Notebook } from "../lib/core/notebook.mjs";
import { appendJsonl } from "../lib/core/store.mjs";
import { normalize } from "../lib/sites/flirtual/profile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "godspeed-wingman.mjs");

const listWorker = (users, opts = {}) => makeWorker(users, { ...opts, settings: { notebook_collection: true, ...(opts.settings || {}) } });
const later = async (h, ms = 61000) => { h.advance(ms); h.w.update((s) => { s.nextActionAt = 0; }); await h.w.tick(); };
const byName = (nb) => Object.fromEntries(nb.list().map((i) => [i.data.name, i]));

function cli(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
const who = (h, name) => cli(["who", name, "--godspeed", h.mc, "--state", h.state]);

// Profiles kept by an earlier Wingman, each as it came: from a match, a message, the queue or the
// "liked you" list, with the decisions made about them. Nothing in the notebook yet.
async function keptBefore(h, people) {
  for (const p of people) {
    const profile = normalize(user(p.id, p.name, p.extra || {}), new Date(p.at));
    delete profile.raw;
    await archive.save(h.w.paths, { day: p.at.slice(0, 10), at: p.at, site: "flirtual", raw: {}, profile, screenshot: null, html: "<p>x</p>", source: p.source, fetchImpl: async () => ({ ok: false }) });
    for (const d of p.decisions || []) appendJsonl(h.w.paths.decisions, { site: "flirtual", id: p.id, name: p.name, ...d });
  }
}

test("a match or a conversation the Wingman never decided on gets an item: liked, by you on the site", async () => {
  const h = listWorker([user("a1", "Mara", { country: "de" }), user("b2", "Juno")], { at: "2026-10-03T10:00:00Z" });
  h.fl.queueIds = [];
  // As Flirtual sends them: the kind of match ("love" or "friend") and when it was made.
  h.fl.convs = [
    { id: "c1", user_id: "a1", kind: "love", created_at: "2026-10-02T21:15:00Z", last_message: null },
    { id: "c2", user_id: "b2", kind: "friend", created_at: "2026-10-03T08:00:00Z", last_message: { id: "m2", content: "Hi!", sender_id: "b2" } },
  ];
  await h.w.tick();
  assert.equal(h.w.collectionDirty, true, "a new match marks the list for the next update");
  await later(h);
  const got = byName(h.nb);
  assert.deepEqual(Object.keys(got).sort(), ["Juno", "Mara"]);
  assert.deepEqual({ ...got.Mara.data }, {
    seen: "2026-10-02", name: "Mara", age: 26, gender: "Cis Woman", location: "Germany", site: "Flirtual", decision: "liked",
    decided_by: "you, on Flirtual", reason: "You matched with them on Flirtual.", profile: "https://flirtu.al/a1", discord: "",
  });
  assert.equal(got.Mara.source_id, "flirtual:a1");
  assert.equal(got.Juno.data.decided_by, "you, on Flirtual, as friends", "a friend match says so");
  assert.equal(got.Juno.data.reason, "You matched as friends on Flirtual.");
  assert.equal(got.Juno.data.seen, "2026-10-03");
  const inserts = h.nb.calls.filter((c) => c[0] === "insertItem").map((c) => c[1]);
  assert.deepEqual(inserts.map((v) => [v.data.name, v.created_at]), [["Mara", "2026-10-02T21:15:00.000Z"], ["Juno", "2026-10-03T08:00:00.000Z"]], "oldest match first, made when the match was");
  for (const it of h.nb.list()) assert.ok(!("comment" in it.data), "the Wingman never writes the comment");

  // Later the Wingman likes Mara itself: its like takes over her item, her comment stays.
  h.nb.comment(got.Mara.id, "Met at the lake world");
  appendJsonl(h.w.paths.decisions, { at: "2026-10-03T19:00:00Z", site: "flirtual", id: "a1", name: "Mara", action: "like", by: "wingman", reason: "Same timezone as you." });
  h.w.collectionDirty = true;
  await later(h);
  const mara = h.nb.itemsById.get(got.Mara.id);
  assert.equal(h.nb.list().length, 2, "still one item each");
  assert.equal(mara.data.decided_by, "the Wingman");
  assert.equal(mara.data.reason, "Same timezone as you.");
  assert.equal(mara.data.seen, "2026-10-03");
  assert.equal(mara.data.comment, "Met at the lake world");
  // Nothing new: nothing written.
  const writes = h.nb.calls.length;
  h.w.collectionDirty = true;
  await later(h);
  assert.equal(h.nb.calls.length, writes);
});

test("the first update after the upgrade adds the matches and conversations kept before", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  await keptBefore(h, [
    { id: "u_test_011", name: "Sam", at: "2026-10-08T12:00:00Z", source: "match" },
    { id: "u_test_011", name: "Sam", at: "2026-10-09T12:00:00Z", source: "message" },
    { id: "u_test_012", name: "Kiri", at: "2026-10-09T13:00:00Z", source: "message" },
    { id: "u_test_013", name: "Robin", at: "2026-10-09T14:00:00Z", source: "liked-you" },
    { id: "u_test_014", name: "Tamsin", at: "2026-10-09T15:00:00Z", source: "queue", decisions: [{ at: "2026-10-09T15:01:00Z", action: "asked", verdict: "like", reason: "x" }] },
    { id: "u_test_015", name: "Odile", at: "2026-10-09T08:00:00Z", source: "queue", decisions: [{ at: "2026-10-09T08:01:00Z", action: "pass", by: "wingman", reason: "They want to meet in person soon." }] },
    { id: "u_test_015", name: "Odile", at: "2026-10-10T09:00:00Z", source: "message" },
  ]);
  await h.w.tick();
  const got = byName(h.nb);
  assert.deepEqual(Object.keys(got).sort(), ["Kiri", "Odile", "Sam"], "nobody kept only from the queue or the \"liked you\" list");
  assert.equal(got.Sam.data.seen, "2026-10-08", "the day of the first match or message");
  assert.equal(got.Sam.data.decided_by, "you, on Flirtual");
  assert.equal(got.Sam.data.reason, "You matched with them on Flirtual.");
  assert.equal(got.Kiri.data.decision, "liked");
  assert.equal(got.Odile.data.decision, "passed", "a like or pass of the Wingman's wins over a conversation");
  assert.equal(got.Odile.data.decided_by, "the Wingman");
  const inserts = h.nb.calls.filter((c) => c[0] === "insertItem").map((c) => c[1].data.name);
  assert.deepEqual(inserts, ["Sam", "Odile", "Kiri"], "in the order they came");
});

test("an item from a like or pass whose records are gone is never turned into a match", async () => {
  const h = listWorker([], { at: "2026-10-10T16:00:00Z" });
  const c = { ...collection.shape("", 42), field_schema: structuredClone(collection.FIELDS), id: "coll-1", slug: "wingman-likes-and-passes" };
  h.nb.collections.set(c.id, c);
  h.nb.stamp(c);
  const it = { id: "item-old", collection_id: c.id, source_app: "godspeed-wingman", source_id: "flirtual:u_test_021", data: { seen: "2026-08-20", name: "Lena", decision: "liked", decided_by: "the Wingman", reason: "You both build worlds.", comment: "mine" } };
  h.nb.itemsById.set(it.id, it);
  h.nb.stamp(it);
  // The like is past the retention; the match came later and is still kept.
  await keptBefore(h, [{ id: "u_test_021", name: "Lena", at: "2026-10-09T12:00:00Z", source: "match" }]);
  await h.w.tick();
  assert.equal(h.nb.calls.filter((x) => x[0] === "updateItem" || x[0] === "insertItem").length, 0);
  assert.deepEqual(h.nb.itemsById.get("item-old").data, it.data);
});

test("who says whether they are in the notebook list, with a link to their item", async () => {
  const h = listWorker([user("a1", "Mara"), user("b2", "Juno"), user("c3", "Sam")], { at: "2026-10-03T10:00:00Z" });
  h.fl.queueIds = [];
  h.nb.web = "https://notebook.example";
  h.fl.convs = [{ id: "c1", user_id: "a1", kind: "love", created_at: "2026-10-03T09:00:00Z", last_message: null }];
  await h.w.tick();
  await later(h);
  // Juno was only seen in the queue.
  await keptBefore(h, [{ id: "b2", name: "Juno", at: "2026-10-03T10:30:00Z", source: "queue" }]);
  const mara = byName(h.nb).Mara;
  let r = await who(h, "Mara");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split("\n")[1], `  In your notebook list "Wingman: likes and passes": https://notebook.example/collections/wingman-likes-and-passes/${mara.id}`);
  r = await who(h, "Juno");
  assert.equal(r.out.split("\n")[1], "  Not in your notebook list \"Wingman: likes and passes\": the Wingman has no like, pass or match of theirs.");
  // A new match, kept but not written yet.
  h.fl.convs.push({ id: "c3", user_id: "c3", kind: "love", created_at: "2026-10-03T10:40:00Z", last_message: null });
  h.w.update((s) => { s.lastInboxAt = 0; });
  h.advance(1000);
  await h.w.tick();
  r = await who(h, "Sam");
  assert.equal(r.out.split("\n")[1], "  Not in your notebook list \"Wingman: likes and passes\" yet: the Wingman adds them at its next update of the list.");
  await later(h);
  r = await who(h, "Sam");
  assert.match(r.out.split("\n")[1], /^ {2}In your notebook list "Wingman: likes and passes": https:\/\/notebook\.example\/collections\/wingman-likes-and-passes\/item-\d+$/);
});

test("who: a notebook on this computer, one without a web address, a list switched off or deleted", async () => {
  const h = listWorker([user("a1", "Mara")], { at: "2026-10-03T10:00:00Z" });
  h.fl.queueIds = [];
  h.fl.convs = [{ id: "c1", user_id: "a1", last_message: null }];
  await h.w.tick();
  await later(h);
  const id = byName(h.nb).Mara.id;
  let r = await who(h, "Mara");
  assert.equal(r.out.split("\n")[1], `  In your notebook list "Wingman: likes and passes": http://127.0.0.1:47831/collections/wingman-likes-and-passes/${id} (opens only on the computer the notebook runs on)`);
  // A notebook in a container that does not know its own web address.
  h.nb.web = null;
  h.w.collectionDirty = true;
  await later(h);
  r = await who(h, "Mara");
  assert.equal(r.out.split("\n")[1], "  In your notebook list \"Wingman: likes and passes\". The notebook does not know its own web address, so there is no link: open your notebook where you usually do, then Collections.");
  // The notebook not answering keeps the address it gave before.
  h.nb.web = "https://notebook.example";
  h.w.collectionDirty = true;
  await later(h);
  h.nb.down = true;
  h.w.collectionDirty = true;
  await later(h);
  r = await who(h, "Mara");
  assert.match(r.out, /https:\/\/notebook\.example\/collections\/wingman-likes-and-passes\//);
  h.nb.down = false;
  // Switched off: no line per person, one line that says so.
  const f = settingsFile(h.mc);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), notebook_collection: false }));
  r = await who(h, "Mara");
  assert.equal(r.out.split("\n").length, 2);
  assert.equal(r.out.split("\n")[1], "The notebook list \"Wingman: likes and passes\" is off, so the Wingman writes nothing new into it.");
  // Deleted in the notebook.
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), notebook_collection: true }));
  h.nb.collections.get(h.w.state.collection.id).removed_at = "2026-10-04T00:00:00Z";
  h.w.collectionDirty = true;
  await later(h);
  r = await who(h, "Mara");
  assert.equal(r.out.split("\n")[1], "The notebook list \"Wingman: likes and passes\" was deleted in the notebook, so nobody is in it.");
});

test("the notebook's own link, asked the way an assistant asks it", async () => {
  const sent = [];
  let answer = { link: "https://notebook.example/dashboard", opens: "on any computer or phone." };
  const nb = new Notebook({ base: "http://127.0.0.1:1/", fetchImpl: async (url, opt) => {
    sent.push({ url, body: JSON.parse(opt.body) });
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(answer) }] } }) };
  } });
  assert.equal(await nb.address(), "https://notebook.example");
  assert.equal(sent[0].url, "http://127.0.0.1:1/mcp");
  assert.deepEqual(sent[0].body, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_notebook_link", arguments: {} } });
  answer = { link: "http://127.0.0.1:47831/dashboard", opens: "only on the computer this notebook runs on" };
  assert.equal(await nb.address(), "http://127.0.0.1:47831");
  answer = { link: null, opens: "This notebook runs in a container that does not know its own web address." };
  assert.equal(await nb.address(), null);
  answer = { link: "javascript:alert(1)//dashboard" };
  assert.equal(await nb.address(), null);
  // An older notebook without the tool answers with an error inside the reply: no address.
  const old = new Notebook({ base: "http://127.0.0.1:1", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Unknown tool" }], isError: true } }) }) });
  assert.equal(await old.address(), null);
  // A notebook that does not answer: the caller keeps what it knew.
  const away = new Notebook({ base: "http://127.0.0.1:1", fetchImpl: async () => { throw new Error("connect ECONNREFUSED"); } });
  await assert.rejects(away.address());
  const shut = new Notebook({ base: "http://127.0.0.1:1", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "Authentication required" }) }) });
  await assert.rejects(shut.address());
});

test("the recipe tells the assistant the list exists, that its notebook tools cannot list it, and that who knows", () => {
  const skill = fs.readFileSync(path.join(HERE, "..", "skill", "wingman", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.match(skill, /holds every like, pass and match/);
  assert.match(skill, /your notebook tools cannot list it: finding nothing there never means it is missing/);
  assert.match(skill, /`godspeed-wingman who "<name>"` says whether someone is in it, with the link to their item/);
});

test("the item link is the notebook's own route for one item", () => {
  assert.equal(collection.itemLink("https://notebook.example", "wingman-likes-and-passes", "1f2e-3d"), "https://notebook.example/collections/wingman-likes-and-passes/1f2e-3d");
  assert.equal(collection.itemLink("https://notebook.example", "a b", "x/y"), "https://notebook.example/collections/a%20b/x%2Fy");
  assert.equal(collection.itemLink(null, "wingman-likes-and-passes", "1"), "");
  assert.equal(collection.itemLink("https://notebook.example", "", "1"), "");
});
