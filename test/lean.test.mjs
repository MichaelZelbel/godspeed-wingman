// A lean archive and a disk guard. The disk is shared with everything else on the machine. A
// separate copy of a person's pictures is kept only when the picture of their page is missing or
// may lack some of them (and then only the first), the pictures are JPEG quality 72, the page is
// kept compressed, and below min_free_gb free the oldest pictures go first, never the profiles,
// never the session.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorker, user, settingsFile } from "./helpers.mjs";
import * as archive from "../lib/core/archive.mjs";
import * as collection from "../lib/core/collection.mjs";
import { normalize } from "../lib/sites/flirtual/profile.mjs";
import { loadSettings } from "../lib/core/settings.mjs";
import { readJson, writeJson, appendJsonl } from "../lib/core/store.mjs";
import { stripPendingScript, cleanupScript } from "../lib/sites/flirtual/page.mjs";

const GB = 1024 ** 3;
const READY = { card: true, loggedIn: true, name: true, skeleton: 0, images: 2, pending: 0, broken: 0 };
const LENA = "u_test_001";
const THEIR_PICTURES = { images: [{ external_id: "k1-aaaa" }, { external_id: "k2-bbbb" }] };

function jpeg(size = 4000) {
  const b = Buffer.alloc(size);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  b.writeUInt16BE(1000, 13);
  b.writeUInt16BE(680, 15);
  return b;
}

// The profile page in a pretend browser. `prep` is what laying out the pictures reports, `pending`
// how many of the laid-out pictures are still loading on every look.
function fakeDriver({ prep = { card: true, unfolded: true, added: 1, hidden: 1, pictures: 2 }, pending = 0, gotoFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async goto(url) { calls.push(["goto", url]); if (gotoFails) throw new Error("bridge /goto answered 502"); },
    async evaluate(js) {
      if (js.includes("#profile-dropdown-button")) return READY;
      if (js.includes("lucide-(ellipsis")) return prep;
      if (js === stripPendingScript) return pending;
      if (js === cleanupScript) return true;
      if (js.includes("document.images")) return [];
      return null;
    },
    async screenshot() { return jpeg(); },
    async capture(opts) { calls.push(["capture", opts]); return { data: jpeg(), capture: opts.selector ? "element" : "full", cut: false }; },
    async content() { return "<html><body>their page, ".padEnd(5000, "x") + "</body></html>"; },
  };
}

// Every download of a picture is written down; each answers with a small JPEG.
function fetcher() {
  const urls = [];
  const f = async (url) => { urls.push(url); return { ok: true, headers: new Headers({ "content-type": "image/jpeg" }), arrayBuffer: async () => jpeg(3000) }; };
  f.urls = urls;
  return f;
}

const avatars = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("avatar-")).sort();

function browsing(h, br, fetch = fetcher()) {
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  h.w.deps.fetch = fetch;
  return fetch;
}

// ---- no second copy of their pictures ------------------------------------------------------------

test("a whole-profile picture: no separate copies of the pictures, nothing downloaded, the page compressed", async () => {
  const h = makeWorker([user(LENA, "Lena", THEIR_PICTURES), user("b2", "Juno")]);
  const fetch = browsing(h, fakeDriver());
  await h.w.tick();
  const dir = path.join(h.w.paths.archive, h.w.state.waiting.dir);
  assert.deepEqual(avatars(dir), []);
  assert.deepEqual(fetch.urls, [], "the pictures are in the picture of the page already");
  assert.ok(fs.existsSync(path.join(dir, "2026-10-03 Lena u_test_0.jpg")));
  assert.equal(path.basename(h.told[0].picture), "2026-10-03 Lena u_test_0.jpg", "the practice question still carries the picture");
  assert.equal(readJson(path.join(dir, "shot.json")).morePending, 0);
  assert.ok(fs.existsSync(path.join(dir, archive.PAGE)));
  assert.equal(fs.existsSync(path.join(dir, "page.html")), false);
  assert.match(archive.readPage(dir), /^<html><body>their page, x+<\/body><\/html>$/);
  assert.ok(fs.statSync(path.join(dir, archive.PAGE)).size < 500, "compressed");
});

test("a page that could not be pictured keeps the first picture only, from the address the page uses", async () => {
  const h = makeWorker([user(LENA, "Lena", THEIR_PICTURES), user("b2", "Juno")]);
  const fetch = browsing(h, fakeDriver({ gotoFails: true }));
  await h.w.tick();
  const dir = path.join(h.w.paths.archive, h.w.state.waiting.dir);
  assert.deepEqual(fetch.urls, ["https://content.flirtual.com/k1-aaaa/profile"]);
  assert.deepEqual(avatars(dir), ["avatar-1.jpg"]);
  assert.equal(path.basename(h.told[0].picture), "avatar-1.jpg", "the owner's message still shows them");
  const entry = archive.search(h.w.paths, "Lena")[0];
  assert.equal(path.basename(archive.picturePath(h.w.paths, entry)), "avatar-1.jpg", "and so does who --photo");
});

test("a picture that may lack some pictures (laid-out ones still loading, or not laid out) keeps the first picture", async () => {
  for (const br of [fakeDriver({ pending: 1 }), fakeDriver({ prep: null })]) {
    const h = makeWorker([user(LENA, "Lena", THEIR_PICTURES), user("b2", "Juno")]);
    const fetch = browsing(h, br);
    await h.w.tick();
    const dir = path.join(h.w.paths.archive, h.w.state.waiting.dir);
    assert.deepEqual(fetch.urls, ["https://content.flirtual.com/k1-aaaa/profile"]);
    assert.deepEqual(avatars(dir), ["avatar-1.jpg"]);
    assert.equal(path.basename(h.told[0].picture), "2026-10-03 Lena u_test_0.jpg", "the picture of the page is still the one the owner sees");
  }
});

test("a picture that cannot be written leaves the profile, and the session goes on", async () => {
  const h = makeWorker([user(LENA, "Lena"), user("b2", "Juno")]);
  browsing(h, fakeDriver());
  // A folder where the picture's file would go: writing it fails, as on a full disk.
  const dir = archive.folderFor(h.w.paths, "2026-10-03", "flirtual", LENA);
  fs.mkdirSync(path.join(dir, "2026-10-03 Lena u_test_0.jpg"), { recursive: true });
  await h.w.tick();
  assert.equal(h.w.state.waiting?.name, "Lena", "judged and asked about all the same");
  assert.ok(readJson(path.join(dir, "profile.json")));
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /Lena: could not keep the picture of their page/);
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), false, "no half-written file left");
});

// ---- what an older archive left, and the pictures taken again ------------------------------------

// A folder as an older version kept it: the picture, shot.json as given (none: undescribed), four
// separate pictures, the page uncompressed.
function keptBefore(h, { day = "2026-10-10", id = LENA, name = "Lena", shot, ext = "jpg" } = {}) {
  const profile = normalize(user(id, name, THEIR_PICTURES), new Date("2026-10-10T14:00:00Z"));
  delete profile.raw;
  const dir = archive.folderFor(h.w.paths, day, "flirtual", id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "profile.json"), profile);
  writeJson(path.join(dir, "raw.json"), {});
  const file = archive.shotName(day, name, id, ext);
  fs.writeFileSync(path.join(dir, file), jpeg());
  if (shot) writeJson(path.join(dir, "shot.json"), { file, ...shot });
  for (const a of ["avatar-1.jpg", "avatar-2.jpg", "avatar-3.webp", "avatar-4.webp"]) fs.writeFileSync(path.join(dir, a), Buffer.alloc(2000, 1));
  fs.writeFileSync(path.join(dir, "page.html"), "<html>".padEnd(3000, "y") + "</html>");
  appendJsonl(h.w.paths.archiveIndex, { site: "flirtual", id, day, name, dir: `${day}/${path.basename(dir)}`, pictures: ["avatar-1.jpg", "avatar-2.jpg", "avatar-3.webp", "avatar-4.webp"] });
  return dir;
}

const WHOLE = { kind: "element", ready: true, shown: true, pictures: 2, retakes: 0 };

test("once at the start: copies go where the whole picture shows them all, every page is compressed, nothing else changes", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  const whole = keptBefore(h, { id: "A1aaaaaaaaaa", name: "Ada", shot: WHOLE });
  const unsure = keptBefore(h, { id: "B2bbbbbbbbbb", name: "Juno", shot: { ...WHOLE, pictures: null } });
  const old = keptBefore(h, { id: "C3cccccccccc", name: "Kiri", ext: "png" });
  h.w.update((s) => { s.paused = true; });
  await h.w.loop({ once: true });
  assert.deepEqual(avatars(whole), []);
  assert.deepEqual(avatars(unsure), ["avatar-1.jpg", "avatar-2.jpg", "avatar-3.webp", "avatar-4.webp"], "a picture that may lack some: left as it was");
  assert.deepEqual(avatars(old), ["avatar-1.jpg", "avatar-2.jpg", "avatar-3.webp", "avatar-4.webp"], "undescribed: left until it is taken again");
  for (const d of [whole, unsure, old]) {
    assert.equal(fs.existsSync(path.join(d, "page.html")), false);
    assert.equal(archive.readPage(d), "<html>".padEnd(3000, "y") + "</html>");
  }
  assert.ok(fs.existsSync(path.join(whole, "2026-10-10 Ada A1aaaaaa.jpg")), "the picture itself stays");
  assert.deepEqual([h.w.state.slimmed.avatars, h.w.state.slimmed.pages], [4, 3]);
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /archive: 4 separate picture\(s\) shown in the whole-profile picture deleted, 3 page\(s\) compressed/);
  // Once: a later start does not walk the archive again.
  fs.writeFileSync(path.join(whole, "avatar-9.jpg"), "x");
  h.w.slimOnce();
  assert.deepEqual(avatars(whole), ["avatar-9.jpg"]);
});

test("taking a picture again downloads nothing, and the copies go once the new picture shows them all", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  const dir = keptBefore(h, { ext: "png" });
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; s.slimmed = { at: "x" }; });
  const fetch = browsing(h, fakeDriver());
  await h.w.tick();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => archive.SHOT.test(f)), ["2026-10-10 Lena u_test_0.jpg"]);
  assert.deepEqual(fetch.urls, [], "no picture is downloaded");
  assert.deepEqual(avatars(dir), []);
  assert.deepEqual(h.w.deps.driver.calls.find((c) => c[0] === "capture")[1], { selector: "[data-mask]", pad: 16, format: "jpeg", quality: 72 });
  assert.equal(archive.readPage(dir).startsWith("<html><body>their page"), true, "the page as it showed now, compressed");
});

test("a picture taken again that may lack some keeps the copies", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  const dir = keptBefore(h, { ext: "png" });
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; s.slimmed = { at: "x" }; });
  browsing(h, fakeDriver({ pending: 1 }));
  await h.w.tick();
  assert.equal(avatars(dir).length, 4);
});

// ---- the disk guard --------------------------------------------------------------------------------

// A pretend disk: `free` bytes at the start, and every byte deleted from the state folder comes back.
function disk(h, free) {
  const du = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? du(p) : fs.statSync(p).size; } return n; };
  const start = du(h.w.paths.root);
  h.w.deps.freeBytes = () => free + Math.max(0, start - du(h.w.paths.root));
  h.w.deps.roomMargin = 0;
}

// Days kept: two profiles in April, one in June, one two days ago. Each picture 1 MB.
async function keptDays(h) {
  const out = {};
  for (const [day, id, name] of [["2026-04-20", "A1aaaaaaaaaa", "Ada"], ["2026-04-20", "B2bbbbbbbbbb", "Juno"], ["2026-06-01", "C3cccccccccc", "Kiri"], ["2026-10-08", "D4dddddddddd", "Dora"]]) {
    const profile = normalize(user(id, name), new Date(`${day}T18:00:00Z`));
    delete profile.raw;
    const e = await archive.save(h.w.paths, { day, site: "flirtual", raw: {}, profile, screenshot: jpeg(1024 * 1024), shot: WHOLE, html: "<p>page</p>", source: "queue", fetchImpl: async () => ({ ok: false }) });
    appendJsonl(h.w.paths.decisions, { at: `${day}T18:05:00Z`, site: "flirtual", id, name, action: "like", by: "wingman" });
    archive.noteOutcome(h.w.paths, e, { action: "like", by: "wingman" });
    out[name] = path.join(h.w.paths.archive, e.dir);
  }
  return out;
}

const pictures = (dir) => fs.readdirSync(dir).filter(archive.isPicture);

test("below the limit the oldest pictures go first, only as many as needed, never the profiles; the session goes on", async () => {
  const h = makeWorker([user(LENA, "Lena"), user("b2", "Juno")], { at: "2026-10-10T18:31:00Z", screenshotsUrl: "https://srv.example/wingman", settings: { retention_days: 365 } });
  const kept = await keptDays(h);
  h.w.update((s) => { s.slimmed = { at: "x" }; s.lastPruneDay = "2026-10-10"; });
  disk(h, 8 * GB - 1.5 * 1024 * 1024);
  browsing(h, fakeDriver());
  await h.w.tick();

  assert.equal(h.w.state.waiting?.name, "Lena", "the session went on: judged and asked about");
  assert.ok(fs.existsSync(path.join(h.w.paths.archive, h.w.state.waiting.dir, "2026-10-10 Lena u_test_0.jpg")), "and the picture is kept");
  assert.deepEqual(pictures(kept.Ada), [], "the oldest went");
  assert.deepEqual(pictures(kept.Juno), [], "then the next oldest, enough for 1.5 MB");
  assert.equal(pictures(kept.Kiri).length, 1, "no more than needed");
  assert.equal(pictures(kept.Dora).length, 1);
  assert.deepEqual(fs.readdirSync(path.join(h.w.paths.screenshots, "2026-04-20")), [], "their copies in screenshots/ too");
  for (const d of [kept.Ada, kept.Juno]) {
    for (const f of ["profile.json", "raw.json", "outcome.json", archive.PAGE]) assert.ok(fs.existsSync(path.join(d, f)), `${f} stays`);
    assert.ok(readJson(path.join(d, "shot.json")).deletedAt);
  }
  assert.equal(archive.search(h.w.paths, "Ada")[0].outcome.action, "like", "who still finds them");
  assert.equal(archive.picturePath(h.w.paths, archive.search(h.w.paths, "Ada")[0]), null);
  assert.deepEqual(archive.needingRetake(h.w.paths).map((t) => t.dir).filter((d) => d.startsWith("2026-04-20")), [], "never taken again");
  const rows = collection.rows(h.w.paths, { timezone: "UTC", screenshotsUrl: "https://srv.example/wingman" });
  assert.deepEqual(rows.map((r) => r.fields.name), ["Ada", "Juno", "Kiri", "Dora"], "the notebook collection keeps every one");
  assert.equal(rows[0].fields.screenshot, undefined);
  const d = h.w.state.disk;
  assert.deepEqual([d.profiles, d.files, d.first, d.last, d.short], [2, 2, "2026-04-20", "2026-04-20", false]);
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /disk: only 8\.0 GB free \(the guard keeps 8\.0 GB\), so the pictures of the 2 oldest kept profiles \(2026-04-20 to 2026-04-20, 2 files, 2 MB\) were deleted; the profiles stay\. Now 8\.0 GB free\./);
});

test("the open question's pictures and the last seven days are never deleted; with nothing left it looks again in half an hour", async () => {
  const h = makeWorker([user(LENA, "Lena"), user("b2", "Juno")], { at: "2026-10-10T18:31:00Z", settings: { retention_days: 365 } });
  const kept = await keptDays(h);
  h.w.update((s) => { s.slimmed = { at: "x" }; s.lastPruneDay = "2026-10-10"; s.waiting = { kind: "review", site: "flirtual", id: "A1aaaaaaaaaa", name: "Ada", dir: path.relative(h.w.paths.archive, kept.Ada).replace(/\\/g, "/"), message: "x", notifiedAt: "2026-10-10T18:00:00Z", askedAt: "2026-10-10T18:00:00Z" }; });
  h.w.deps.freeBytes = () => 1 * GB;
  h.w.ensureRoom();
  assert.equal(pictures(kept.Ada).length, 1, "the open question's");
  assert.deepEqual([pictures(kept.Juno).length, pictures(kept.Kiri).length], [0, 0]);
  assert.equal(pictures(kept.Dora).length, 1, "the last seven days");
  const log = () => fs.readFileSync(h.w.paths.log, "utf8");
  assert.match(log(), /disk: still only 1\.0 GB free; the rest is not the Wingman's to delete/);
  assert.equal(h.w.state.disk.short, true);
  h.w.ensureRoom();
  assert.equal(log().match(/still only/g).length, 1, "quiet for half an hour");
  h.advance(31 * 60000);
  h.w.ensureRoom();
  assert.equal(log().match(/still only/g).length, 2);
});

test("the guard does nothing above the limit, nothing when switched off, and never throws", async () => {
  const h = makeWorker([], { at: "2026-10-10T18:31:00Z" });
  const kept = await keptDays(h);
  h.w.deps.freeBytes = () => 9 * GB;
  h.w.ensureRoom();
  assert.equal(pictures(kept.Ada).length, 1);
  fs.writeFileSync(settingsFile(h.mc), JSON.stringify({ sync: "off", timezone: "UTC", min_free_gb: 0 }));
  h.w.deps.freeBytes = () => 1;
  h.w.ensureRoom();
  assert.equal(pictures(kept.Ada).length, 1, "0 switches it off");
  fs.writeFileSync(settingsFile(h.mc), JSON.stringify({ sync: "off", timezone: "UTC" }));
  h.w.deps.freeBytes = () => { throw new Error("statfs failed"); };
  assert.doesNotThrow(() => h.w.ensureRoom());
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /disk guard: statfs failed/);
});

test("the limit is a setting: 8 GB unless chosen, 0 switches it off", () => {
  const f = settingsFile(makeWorker([]).mc);
  const with_ = (v) => { fs.writeFileSync(f, JSON.stringify(v === undefined ? {} : { min_free_gb: v })); return loadSettings(f).min_free_gb; };
  assert.equal(with_(undefined), 8);
  assert.equal(with_(12), 12);
  assert.equal(with_(0), 0);
  assert.equal(with_(-1), 8);
  assert.equal(with_("lots"), 8);
  assert.ok(archive.freeBytes(path.dirname(f)) > 0, "this disk's free space can be read");
});

// ---- status and check say so ---------------------------------------------------------------------

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-wingman.mjs");
function cli(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "" } });
    let out = "";
    c.stdout.on("data", (d) => { out += d; });
    c.on("close", (code) => resolve({ code, out: out.trim() }));
  });
}

test("status and check show a warning line when the disk is short or the guard deleted pictures", async () => {
  const h = makeWorker([], { at: new Date().toISOString() });
  await h.w.tick();
  const args = ["--godspeed", h.mc, "--state", h.state];
  // The bridge address answers nothing, so check never starts a browser here.
  const settings = (v) => fs.writeFileSync(settingsFile(h.mc), JSON.stringify({ sync: "off", timezone: "UTC", browser: "bridge", bridge: "http://127.0.0.1:9", talk: ["desk"], ...v }));
  // A limit every disk is above (this machine's free space is not the test's business).
  settings({ min_free_gb: 0.001 });
  let st = await cli(["status", ...args]);
  assert.doesNotMatch(st.out, /Disk/, "nothing when all is well");
  let ck = await cli(["check", ...args]);
  assert.match(ck.out, /^ {2}ok {3}disk: \d+\.\d GB free \(the oldest pictures make room below 0\.001 GB\)$/m);
  settings({ min_free_gb: 1000 });
  st = await cli(["status", ...args]);
  assert.match(st.out, /^Disk WARNING: only \d+\.\d GB free on this disk, under the 1000 GB the Wingman keeps/m);
  ck = await cli(["check", ...args]);
  assert.match(ck.out, /^ {2}WARN disk: only \d+\.\d GB free on this disk/m);
  settings({ min_free_gb: 0.001 });
  h.w.update((s) => { s.disk = { cleanedAt: new Date().toISOString(), profiles: 12, files: 30, freed: 5 * 1024 ** 2, first: "2026-04-20", last: "2026-04-22", short: false }; });
  st = await cli(["status", ...args]);
  assert.match(st.out, /Disk WARNING: the disk ran short of space, so the Wingman deleted the pictures of 12 kept profile\(s\) \(from 2026-04-20 to 2026-04-22, 5 MB\)/);
  ck = await cli(["check", ...args]);
  assert.match(ck.out, /WARN disk: the disk ran short of space/);
});
