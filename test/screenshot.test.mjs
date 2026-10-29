// The picture of a whole profile. Before the picture the Flirtual adapter waits until the page has
// finished; the picture is the whole profile card; old pictures are taken again while no session
// runs, at a person's pace, without ever liking, passing or writing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorker, user } from "./helpers.mjs";
import * as archive from "../lib/core/archive.mjs";
import * as collection from "../lib/core/collection.mjs";
import { normalize } from "../lib/sites/flirtual/profile.mjs";
import { appendJsonl, readJson } from "../lib/core/store.mjs";
import { waitForProfile, isReady, isShown, probeScript, prepareScript, stripPendingScript, cleanupScript, CARD } from "../lib/sites/flirtual/page.mjs";
import { imageKind, imageSize } from "../lib/core/image.mjs";
import { sendsAsPhoto } from "../lib/channels/telegram.mjs";
import { RETAKE_SECONDS } from "../lib/core/worker.mjs";

const SKELETON = { card: false, loggedIn: true, where: "/en/x", skeleton: 13 };
const LOADING = { card: true, loggedIn: true, name: true, skeleton: 0, images: 3, pending: 2, broken: 0 };
const READY = { card: true, loggedIn: true, name: true, skeleton: 0, images: 3, pending: 0, broken: 0 };

// A JPEG of the given size: the start marker and one frame header are all imageSize reads.
function jpeg(width, height) {
  const b = Buffer.alloc(40);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  b.writeUInt16BE(height, 13);
  b.writeUInt16BE(width, 15);
  return b;
}
function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

// A pretend browser with Flirtual's page in it: `probes` is what the page shows on each look (the
// last one stays), and every call is written down.
function fakeDriver(probes, { capture = true, picture = jpeg(680, 3000) } = {}) {
  const seq = [...probes];
  const calls = [];
  const br = {
    calls,
    async goto(url) { calls.push(["goto", url]); },
    async evaluate(js) {
      if (js.includes("#profile-dropdown-button")) { calls.push(["probe"]); return seq.length > 1 ? seq.shift() : seq[0]; }
      if (js.includes("lucide-(ellipsis")) { calls.push(["prepare"]); return { card: true, unfolded: true, added: 2, hidden: 1, pictures: 3 }; }
      if (js === stripPendingScript) { calls.push(["strip"]); return 0; }
      if (js === cleanupScript) { calls.push(["cleanup"]); return true; }
      if (js.includes("document.images")) return [];
      if (js === "location.origin") return "https://flirtu.al";
      calls.push(["eval", js.slice(0, 60)]);
      return null;
    },
    async screenshot() { calls.push(["screenshot"]); return png(1300, 767); },
    async content() { calls.push(["content"]); return "<html><body>their page</body></html>"; },
  };
  if (capture) br.capture = async (opts) => { calls.push(["capture", opts]); return { data: picture, capture: opts.selector ? "element" : "full", cut: false }; };
  return br;
}

// ---- waiting for the page -------------------------------------------------------------------------

test("ready means the card with the name, no grey bars, no picture still loading", () => {
  assert.equal(isReady(READY), true);
  assert.equal(isReady(LOADING), false, "a picture still loading");
  assert.equal(isShown(LOADING), true, "but the card is there");
  assert.equal(isReady(SKELETON), false);
  assert.equal(isShown(SKELETON), false);
  assert.equal(isReady({ ...READY, name: false }), false, "someone else's card");
  assert.equal(isReady({ ...READY, skeleton: 2 }), false, "grey bars left");
  assert.equal(isReady(null), false);
});

test("waitForProfile waits through the skeleton and the loading pictures, then lets it settle", async () => {
  const br = fakeDriver([SKELETON, SKELETON, LOADING, READY]);
  const waits = [];
  const r = await waitForProfile(br, "Ilka", { wait: async (ms) => waits.push(ms) });
  assert.equal(r.ready, true);
  assert.equal(br.calls.filter((c) => c[0] === "probe").length, 4);
  assert.deepEqual(waits, [500, 500, 500, 800], "three looks half a second apart, then the settle");
  assert.equal(r.waitedMs, 3 * 500 + 800);
});

test("waitForProfile gives up after its time and says what it saw", async () => {
  const br = fakeDriver([SKELETON]);
  const r = await waitForProfile(br, "Ilka", { wait: async () => {}, timeoutMs: 3000, everyMs: 500 });
  assert.equal(r.ready, false);
  assert.equal(r.shown, false);
  assert.equal(br.calls.filter((c) => c[0] === "probe").length, 6, "counted in looks, not by the clock");
  const slow = await waitForProfile(fakeDriver([LOADING]), "Ilka", { wait: async () => {}, timeoutMs: 1000 });
  assert.deepEqual([slow.ready, slow.shown], [false, true], "the card was there, a picture never arrived");
});

test("waitForProfile survives a page that does not answer", async () => {
  const br = { async evaluate() { throw new Error("bridge /eval answered 500"); } };
  const r = await waitForProfile(br, "Ilka", { wait: async () => {}, timeoutMs: 1000 });
  assert.equal(r.ready, false);
});

test("the page scripts are valid JavaScript, look for the name, and click nothing but the ...", () => {
  for (const js of [probeScript("Ilka \"the\" `cat`"), prepareScript(["1200fe98-f989", "x'y"]), stripPendingScript, cleanupScript]) {
    assert.doesNotThrow(() => new Function(`return ${js};`), js.slice(0, 80));
  }
  assert.match(probeScript("Ｌena"), /"ｌena"/, "the name as written, in lower case");
  assert.ok(probeScript("x").includes(CARD));
  const prep = prepareScript([]);
  assert.equal((prep.match(/\.click\(\)/g) || []).length, 1, "exactly one click in the whole script");
  assert.match(prep, /!b\.hasAttribute\("class"\) && !\(b\.textContent \|\| ""\)\.trim\(\)/, "only a button with no class and no words");
  assert.match(prep, /cs\.position !== "fixed"/, "what is pinned to the window is hidden, not clicked");
  assert.match(cleanupScript, /el\.getAttribute\("style"\); if \(css === null\) el\.removeAttribute\("style"\)/, "and put back exactly");
});

test("pictures are named by what they are", () => {
  assert.equal(imageKind(jpeg(10, 10)), "jpg");
  assert.equal(imageKind(png(10, 10)), "png");
  assert.deepEqual(imageSize(jpeg(680, 3123)), { width: 680, height: 3123 });
  assert.deepEqual(imageSize(png(1300, 767)), { width: 1300, height: 767 });
  assert.equal(imageSize(Buffer.from("nope")), null);
});

test("a very long picture goes to Telegram as a file, a normal one as a photo", () => {
  assert.equal(sendsAsPhoto(jpeg(680, 3000)), true);
  assert.equal(sendsAsPhoto(jpeg(680, 9400)), false, "width and height together over 10000");
  assert.equal(sendsAsPhoto(jpeg(300, 7000)), false, "more than 20 times as tall as wide");
  assert.equal(sendsAsPhoto(png(1300, 767)), true);
});

// ---- a new profile ----------------------------------------------------------------------------------

test("a new profile: waits for the page, opens the ..., takes the whole card as JPEG, notes how", async () => {
  const h = makeWorker([user("u_test_001", "Ilka"), user("b2", "Juno")]);
  const br = fakeDriver([SKELETON, LOADING, READY]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  await h.w.tick();
  const w = h.w.state.waiting;
  const dir = path.join(h.w.paths.archive, w.dir);
  const shot = "2026-10-03 Ilka u_test_0.jpg";
  assert.ok(fs.existsSync(path.join(dir, shot)), fs.readdirSync(dir).join(","));
  assert.ok(fs.existsSync(path.join(h.w.paths.screenshots, "2026-10-03", shot)), "and its copy in screenshots/");
  assert.equal(path.basename(h.told[0].picture), shot, "the practice question carries the whole picture");
  const order = br.calls.map((c) => c[0]);
  assert.deepEqual(order.slice(0, 7), ["goto", "probe", "probe", "probe", "prepare", "strip", "capture"]);
  assert.ok(order.indexOf("cleanup") > order.indexOf("capture"), "the extra pictures are taken away after the picture");
  assert.ok(order.indexOf("content") > order.indexOf("cleanup"), "the page is kept as Flirtual shows it");
  assert.deepEqual(br.calls.find((c) => c[0] === "capture")[1], { selector: "[data-mask]", pad: 16, format: "jpeg", quality: 72 });
  const meta = readJson(path.join(dir, "shot.json"));
  assert.equal(meta.kind, "element");
  assert.equal(meta.ready, true);
  assert.equal(meta.file, shot);
  assert.equal(meta.unfolded, true);
  assert.equal(meta.hidden, 1, "the floating bar was out of the way");
  assert.deepEqual(archive.needingRetake(h.w.paths), [], "a finished picture is not taken again");
});

test("a page that never finishes is still pictured, logged, and taken again later", async () => {
  const h = makeWorker([user("u_test_001", "Ilka"), user("b2", "Juno")]);
  const br = fakeDriver([SKELETON]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  await h.w.tick();
  const dir = path.join(h.w.paths.archive, h.w.state.waiting.dir);
  assert.ok(fs.existsSync(path.join(dir, "2026-10-03 Ilka u_test_0.jpg")));
  assert.deepEqual(br.calls.find((c) => c[0] === "capture")[1], { full: true, format: "jpeg", quality: 72 }, "no card: the whole page");
  assert.equal(br.calls.some((c) => c[0] === "prepare"), false, "nothing laid out on a page without the card");
  const meta = readJson(path.join(dir, "shot.json"));
  assert.equal(meta.ready, false);
  assert.equal(meta.unfinished.card, false);
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /the page of Ilka had not finished loading after 25 s; picture taken anyway/);
  assert.equal(archive.needingRetake(h.w.paths).length, 1);
});

test("an older bridge without whole-page pictures still gives the window, as PNG", async () => {
  const h = makeWorker([user("u_test_001", "Ilka"), user("b2", "Juno")]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = fakeDriver([READY], { capture: false });
  await h.w.tick();
  const dir = path.join(h.w.paths.archive, h.w.state.waiting.dir);
  assert.ok(fs.existsSync(path.join(dir, "2026-10-03 Ilka u_test_0.png")));
  assert.equal(readJson(path.join(dir, "shot.json")).kind, "viewport");
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /only the window/);
});

test("a failed card picture falls back to the whole page", async () => {
  const h = makeWorker([user("u_test_001", "Ilka"), user("b2", "Juno")]);
  const br = fakeDriver([READY]);
  const real = br.capture;
  br.capture = async (opts) => { if (opts.selector) { br.calls.push(["capture", opts]); throw new Error("bridge /screenshot answered 404"); } return real(opts); };
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  await h.w.tick();
  const caps = br.calls.filter((c) => c[0] === "capture").map((c) => c[1]);
  assert.deepEqual(caps.map((o) => (o.selector ? "card" : o.full ? "page" : "?")), ["card", "page"]);
  assert.equal(readJson(path.join(h.w.paths.archive, h.w.state.waiting.dir, "shot.json")).kind, "full");
});

// ---- the old pictures, taken again ---------------------------------------------------------------

// An archive kept with only window pictures: PNGs named by day and name, no shot.json.
async function oldArchive(h, people) {
  for (const p of people) {
    const profile = normalize(user(p.id, p.name), new Date("2026-10-10T14:00:00Z"));
    delete profile.raw;
    const entry = await archive.save(h.w.paths, { day: "2026-10-10", site: "flirtual", raw: {}, profile, screenshot: png(1300, 767), html: "<p>skeleton</p>", source: "queue", fetchImpl: async () => ({ ok: false }) });
    for (const d of p.decisions || []) appendJsonl(h.w.paths.decisions, { site: "flirtual", id: p.id, name: p.name, ...d });
    p.dir = entry.dir;
  }
  archive.nameShots(h.w.paths);
}

const PEOPLE = () => [
  { id: "u_test_004", name: "robinbird25", decisions: [{ at: "2026-10-10T14:42:46Z", action: "pass", by: "wingman" }] },
  { id: "u_test_001", name: "Ilka", decisions: [{ at: "2026-10-10T14:50:00Z", action: "like", by: "wingman" }] },
];

test("old pictures are taken again one by one, read only, at a person's pace, under the same names", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z", screenshotsUrl: "https://srv.example/wingman" });
  const people = PEOPLE();
  await oldArchive(h, people);
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; });
  assert.equal(archive.needingRetake(h.w.paths).length, 2);
  const br = fakeDriver([READY]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;

  await h.w.tick();
  assert.deepEqual(br.calls.filter((c) => c[0] === "goto").map((c) => c[1]), ["https://flirtu.al/u_test_004"], "oldest first, by the account id");
  const dir = path.join(h.w.paths.archive, people[0].dir);
  const files = fs.readdirSync(dir).filter((f) => archive.SHOT.test(f));
  assert.deepEqual(files, ["2026-10-10 robinbird25 u_test_0.jpg"], "the .jpg replaces the .png under the same name scheme");
  assert.deepEqual(fs.readdirSync(path.join(h.w.paths.screenshots, "2026-10-10")).sort(), ["2026-10-10 Ilka u_test_0.png", "2026-10-10 robinbird25 u_test_0.jpg"]);
  const meta = readJson(path.join(dir, "shot.json"));
  assert.deepEqual([meta.kind, meta.ready, meta.retakes, meta.retakenOf], ["element", true, 1, "an undescribed picture"]);
  assert.equal(archive.readPage(dir), "<html><body>their page</body></html>", "the page as it showed now");
  assert.equal(fs.existsSync(path.join(dir, "page.html")), false, "kept compressed, the uncompressed one gone");
  const next = h.w.state.retake.nextAt - h.w.now().getTime();
  assert.ok(next >= RETAKE_SECONDS[0] * 1000 && next <= RETAKE_SECONDS[1] * 1000, `${next} ms to the next`);

  await h.w.tick();
  assert.equal(br.calls.filter((c) => c[0] === "goto").length, 1, "nothing before the pause is over");
  h.advance(61000);
  await h.w.tick();
  assert.equal(br.calls.filter((c) => c[0] === "goto").length, 2);
  assert.deepEqual(archive.needingRetake(h.w.paths), []);
  h.advance(61000);
  await h.w.tick();
  assert.ok(h.w.state.retake.finishedAt);
  assert.equal(h.w.state.retake.done, 2);
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /done taking pictures again \(2 new, 0 kept as they were\)/);
  h.advance(61000);
  await h.w.tick();
  assert.equal(br.calls.filter((c) => c[0] === "goto").length, 2, "and then it stops");

  // Read only: no like, no pass, no message, nothing clicked but the "...".
  assert.equal(h.fl.responses.length, 0);
  assert.equal(h.fl.sent.length, 0);
  // The notebook's Screenshot links follow to the .jpg.
  const rows = collection.rows(h.w.paths, { timezone: "UTC", screenshotsUrl: "https://srv.example/wingman" });
  assert.deepEqual(rows.map((r) => r.fields.screenshot), [
    "https://srv.example/wingman/2026-10-10/2026-10-10%20robinbird25%20u_test_0.jpg",
    "https://srv.example/wingman/2026-10-10/2026-10-10%20Ilka%20u_test_0.jpg",
  ]);
  // "who --photo" sends the new picture.
  assert.equal(path.basename(archive.picturePath(h.w.paths, archive.search(h.w.paths, "Ilka")[0])), "2026-10-10 Ilka u_test_0.jpg");
});

test("taking pictures again waits while a session runs and while paused", async () => {
  const h = makeWorker([user("x1", "Xena")], { at: "2026-10-10T16:00:00Z" });
  await oldArchive(h, PEOPLE());
  const br = fakeDriver([READY]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  h.w.update((s) => { s.paused = true; s.lastRunDay = "2026-10-10"; });
  await h.w.tick();
  assert.equal(br.calls.length, 0, "paused: nothing is opened");
  h.w.update((s) => { s.paused = false; });
  h.w.startRun("asked for");
  await h.w.tick();
  const opened = br.calls.filter((c) => c[0] === "goto").map((c) => c[1]);
  assert.ok(opened.every((u) => !u.includes("u_test_004") && !u.includes("u_test_001")), `the session's own profiles only, got ${opened}`);
  assert.equal(archive.needingRetake(h.w.paths).length, 2, "both still waiting for after the session");
});

test("the old picture stays when the card does not appear; after two tries the profile is left alone", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  const people = PEOPLE().slice(0, 1);
  await oldArchive(h, people);
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; });
  const gone = { card: false, loggedIn: true, where: "/en/u_test_004", skeleton: 0 };
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = fakeDriver([gone]);
  const dir = path.join(h.w.paths.archive, people[0].dir);
  await h.w.tick();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => archive.SHOT.test(f)), ["2026-10-10 robinbird25 u_test_0.png"], "old picture kept");
  assert.equal(readJson(path.join(dir, "shot.json")).retakes, 1);
  h.advance(61000);
  await h.w.tick();
  assert.equal(readJson(path.join(dir, "shot.json")).retakes, 2);
  assert.deepEqual(archive.needingRetake(h.w.paths), []);
  assert.equal(h.w.state.retake.kept, 2);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => archive.SHOT.test(f)), ["2026-10-10 robinbird25 u_test_0.png"]);
});

test("a lost login pauses taking pictures again for half an hour without counting the try", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  await oldArchive(h, PEOPLE());
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; });
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = fakeDriver([{ card: false, loggedIn: false, where: "/en/login", skeleton: 0 }]);
  await h.w.tick();
  assert.equal(archive.needingRetake(h.w.paths).every((t) => t.tries === 0), true);
  assert.equal(h.w.state.retake.nextAt - h.w.now().getTime(), 30 * 60000);
  assert.match(fs.readFileSync(h.w.paths.log, "utf8"), /Flirtual shows no login/);
});

test("a kept profile of a site that is no longer switched on is not opened", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z", settings: { sites: [] } });
  await oldArchive(h, PEOPLE().slice(0, 1));
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; });
  const br = fakeDriver([READY]);
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = br;
  await h.w.tick();
  assert.equal(br.calls.length, 0);
  assert.match(readJson(path.join(h.w.paths.archive, archive.needingRetake(h.w.paths)[0].dir, "shot.json")).why, /not switched on/);
});

test("an open question's picture follows when it is taken again", async () => {
  const h = makeWorker([], { at: "2026-10-10T16:00:00Z" });
  const people = PEOPLE().slice(1);
  await oldArchive(h, people);
  const dir = path.join(h.w.paths.archive, people[0].dir);
  const old = path.join(dir, "2026-10-10 Ilka u_test_0.png");
  h.w.update((s) => { s.lastRunDay = "2026-10-10"; s.waiting = { kind: "review", site: "flirtual", id: people[0].id, name: "Ilka", dir: people[0].dir, picture: old, message: "x", notifiedAt: "2026-10-10T15:00:00Z", askedAt: "2026-10-10T15:00:00Z" }; });
  h.w.deps.noBrowserPage = false;
  h.w.deps.driver = fakeDriver([READY]);
  await h.w.tick();
  assert.equal(h.w.state.waiting.picture, path.join(dir, "2026-10-10 Ilka u_test_0.jpg"));
  assert.equal(h.w.state.waiting.notifiedAt, "2026-10-10T15:00:00Z", "the question itself is untouched");
});
