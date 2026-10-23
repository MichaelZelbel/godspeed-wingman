// Every profile the Wingman opens is kept for the retention (retention_days, 42 by default): the
// profile as the site sent it (raw.json), as the Wingman reads it (profile.json), the page as the
// browser showed it (compressed, page.html.gz) and a picture of the whole profile. When someone
// writes elsewhere "you liked me on <site>", one search finds them: by their name, another name they
// go by, their Discord name (the site's field, or the one in their bio, kept with the outcome of a
// like) or a word from their bio. After the retention the folder is deleted for good.
//
// One folder per profile and day: archive/<day>/<site>.<id>. The picture is named by the day, the
// name and the start of the profile id ("2026-10-10 Mara u_test_0.jpg"), and a second name for the
// same file (a hard link) sits in screenshots/<day>/, the one folder the owner opens to look back.
// Nothing else of theirs is in there. Next to it, shot.json says how the picture was taken: whole
// profile or only the window, whether the page had finished loading, how often it was taken again.
//
// The person's own pictures (avatar-1.jpg) are kept separately only when the picture of their page
// is missing or may not show all of them, and then only the first: a whole-profile picture lays
// every one of them out, so copies would only double the archive.
//
// The disk is shared with everything else on the machine, so before a picture is kept the worker
// checks that min_free_gb is still free; below that, the oldest pictures go first (makeRoom).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { appendJsonl, readJsonl, readJson, writeJson, writeBuffer, removeTree, ensureDir, writeText } from "./store.mjs";
import { imageKind } from "./image.mjs";

const safe = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_");

export function folderName(site, id) { return `${safe(site || "site")}.${safe(id)}`; }
export function folderFor(paths, day, site, id) { return path.join(paths.archive, day, folderName(site, id)); }
// The site a kept folder belongs to, from its name.
export function siteOfFolder(dirRel) { const m = String(dirRel || "").split("/").pop()?.match(/^([^.]+)\./); return m ? m[1] : null; }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SHOT = /^\d{4}-\d{2}-\d{2} .+\.(png|jpg)$/;
const listDir = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// A name a stranger chose, made safe for a file name on Linux, macOS and Windows: no path signs, no
// characters Windows refuses, no dots or spaces at the ends, short.
export function fileSafe(name, max = 40) {
  const t = String(name ?? "").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ").trim();
  return [...t].slice(0, max).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "no name";
}

// "2026-10-10 Mara u_test_0.jpg": the day, the name, the first 8 letters of the profile id, so two
// people with one name stay two files.
export function shotName(day, name, id, ext = "png") {
  return `${day} ${fileSafe(name)} ${String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "noid"}.${ext === "jpg" ? "jpg" : "png"}`;
}

// Every kept profile folder: { day, rel: "<day>/<folder>", abs }.
function* folders(paths, { before } = {}) {
  for (const day of listDir(paths.archive).filter((d) => DAY.test(d) && (!before || d < before)).sort()) {
    for (const f of listDir(path.join(paths.archive, day))) {
      const abs = path.join(paths.archive, day, f);
      if (isDir(abs)) yield { day, rel: `${day}/${f}`, abs };
    }
  }
}

// The browsing copy: the same file under screenshots/<day>/. A hard link costs no space; where a
// link is not possible the file is copied.
function linkShot(paths, day, file) {
  const dst = path.join(paths.screenshots, day, path.basename(file));
  try {
    if (fs.existsSync(dst)) {
      const a = fs.statSync(dst), b = fs.statSync(file);
      if (a.ino && a.ino === b.ino && a.dev === b.dev) return dst;
      fs.unlinkSync(dst);
    }
    ensureDir(path.dirname(dst));
    try { fs.linkSync(file, dst); } catch { fs.copyFileSync(file, dst); }
    return dst;
  } catch { return null; }
}

function removeShot(paths, day, file) {
  try { fs.unlinkSync(file); } catch { /* gone */ }
  try { fs.unlinkSync(path.join(paths.screenshots, day, path.basename(file))); } catch { /* none */ }
}

// Writes the picture under its name and links it into screenshots/. An older picture of the same
// day's visit (page.png, one under a name since changed, or the .png a .jpg replaces) goes, once
// the new one is written.
function placeShot(paths, dir, day, name, id, buf) {
  const file = path.join(dir, shotName(day, name, id, imageKind(buf)));
  writeBuffer(file, buf);
  for (const f of listDir(dir)) if ((f === "page.png" || SHOT.test(f)) && f !== path.basename(file)) removeShot(paths, day, path.join(dir, f));
  linkShot(paths, day, file);
  return file;
}

// At every start and once a day: a picture still called page.png gets its name, and every named
// picture its place in screenshots/. Returns each rename, so an open question can follow its picture.
export function nameShots(paths) {
  const moved = [];
  for (const { day, abs: dir } of folders(paths)) {
    const files = listDir(dir);
    let shot = files.filter((f) => SHOT.test(f)).sort().pop();
    if (!shot && files.includes("page.png")) {
      const profile = readJson(path.join(dir, "profile.json"), null) || {};
      const to = shotName(day, profile.name, profile.id || path.basename(dir));
      try { fs.renameSync(path.join(dir, "page.png"), path.join(dir, to)); } catch { continue; }
      moved.push({ from: path.join(dir, "page.png"), to: path.join(dir, to) });
      shot = to;
    }
    if (shot) linkShot(paths, day, path.join(dir, shot));
  }
  return moved;
}

// ---- what is kept, and how lean ------------------------------------------------------------------
export const PAGE = "page.html.gz";
const AVATAR = /^avatar-\d+\.(jpg|png|webp|gif)$/;
// Every picture file a kept profile can hold: the picture of the page and the person's own pictures.
export const isPicture = (f) => SHOT.test(f) || f === "page.png" || AVATAR.test(f);

// The page as the browser showed it, compressed (about a quarter of the size; `zcat` reads it).
function keepPage(dir, html) {
  writeBuffer(path.join(dir, PAGE), zlib.gzipSync(Buffer.from(String(html)), { level: 9 }));
  try { fs.unlinkSync(path.join(dir, "page.html")); } catch { /* none */ }
}

// The kept page of a profile folder, as text, whichever way it was kept; null when none is.
export function readPage(dir) {
  try { return zlib.gunzipSync(fs.readFileSync(path.join(dir, PAGE))).toString("utf8"); } catch { /* not compressed */ }
  try { return fs.readFileSync(path.join(dir, "page.html"), "utf8"); } catch { return null; }
}

// Whether the picture of the page shows every picture of theirs: the whole profile (or the whole
// page around it), finished, their other pictures laid out and arrived. Then a separate copy of
// their pictures is only weight.
export function showsAllPictures(shot, profile) {
  if (!shot || shot.deletedAt || !shot.shown || !["element", "full"].includes(shot.kind) || shot.morePending) return false;
  const want = (profile?.photos || []).length;
  return Number.isFinite(shot.pictures) && shot.pictures >= want;
}

// The person's own pictures in a folder go, all of them or all but the first. Returns the bytes freed.
function removeAvatars(dir, { keepFirst = false } = {}) {
  let freed = 0;
  for (const f of listDir(dir)) {
    if (!AVATAR.test(f) || (keepFirst && /^avatar-1\./.test(f))) continue;
    try { freed += fs.statSync(path.join(dir, f)).size; fs.unlinkSync(path.join(dir, f)); } catch { /* gone */ }
  }
  return freed;
}

const handlesOf = (profile) => Object.fromEntries(Object.entries(profile?.handles || {}).filter(([, v]) => typeof v === "string" && v));

// `source` says where the profile came from: queue, match, message or liked-you. `match`, for a
// match or a conversation, is what the site said about it: { at (when it was made), friend (a
// friend-type match) }, kept with the entry so the notebook list can say it.
export async function save(paths, { day, at, site, raw, profile, screenshot, shot, html, source, match, fetchImpl = fetch, log = () => {} }) {
  const siteId = site || profile.site;
  const dir = folderFor(paths, day, siteId, profile.id);
  writeJson(path.join(dir, "raw.json"), raw ?? null);
  writeJson(path.join(dir, "profile.json"), { ...profile, site: siteId });
  // A picture or a page that cannot be written (a full disk) is logged and left out: the profile
  // and the like or pass matter more than the picture of them.
  let file = null;
  if (screenshot?.length) {
    try {
      file = placeShot(paths, dir, day, profile.name, profile.id, screenshot);
      if (shot) writeJson(path.join(dir, "shot.json"), { ...shot, file: path.basename(file), at: new Date().toISOString(), retakes: 0 });
    } catch (e) { log(`could not keep the picture of their page: ${e.message}`); file = null; }
  }
  if (html) { try { keepPage(dir, html); } catch (e) { log(`could not keep their page: ${e.message}`); } }
  // Their first picture, separately, only when the picture of the page is missing or may lack
  // some of theirs, so the owner's messages and `who --photo` still show them. Otherwise none, and
  // none left over from an earlier visit the same day.
  const saved = [];
  const whole = !!file && showsAllPictures(shot, profile);
  removeAvatars(dir, { keepFirst: !whole });
  if (!whole) {
    for (const url of (profile.photos || []).filter((u) => /^https:\/\//.test(String(u))).slice(0, 1)) {
      try {
        const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const type = r.headers.get("content-type") || "";
        const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
        removeAvatars(dir);
        const f = path.join(dir, `avatar-1.${ext}`);
        writeBuffer(f, Buffer.from(await r.arrayBuffer()));
        saved.push(path.basename(f));
      } catch { /* a missing picture never stops the run */ }
    }
    if (!saved.length) saved.push(...listDir(dir).filter((f) => AVATAR.test(f)));
  }
  const matchedAt = typeof match?.at === "string" && Number.isFinite(Date.parse(match.at)) ? new Date(match.at).toISOString() : null;
  const entry = {
    site: siteId, id: profile.id, day, at: typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : new Date().toISOString(), source,
    name: profile.name, handles: handlesOf(profile), discord: typeof profile.contact?.discord === "string" ? profile.contact.discord : null,
    url: profile.url, dir: path.relative(paths.archive, dir).replace(/\\/g, "/"), pictures: saved,
    ...(matchedAt ? { matchedAt } : {}), ...(match?.friend === true ? { friend: true } : {}),
  };
  appendJsonl(paths.archiveIndex, entry);
  return entry;
}

// ---- taking the picture again --------------------------------------------------------------------
// Kept profiles whose picture should be taken again, oldest first: one without shot.json (kept
// before the picture was described) and one whose page had not finished loading, at most twice.
export const RETAKES = 2;

export function needingRetake(paths) {
  const order = new Map();
  readJsonl(paths.archiveIndex).forEach((e, i) => { if (e.dir && !order.has(e.dir)) order.set(e.dir, i); });
  const out = [];
  for (const { day, rel, abs } of folders(paths)) {
    if (!fs.existsSync(path.join(abs, "profile.json"))) continue;
    const shot = readJson(path.join(abs, "shot.json"), null);
    // A picture the disk guard deleted stays deleted: taking it again would undo the guard.
    if (shot && (shot.ready || shot.deletedAt || (shot.retakes || 0) >= RETAKES)) continue;
    out.push({ dir: rel, day, site: siteOfFolder(rel), tries: shot ? shot.retakes || 0 : 0, old: !shot });
  }
  return out.sort((a, b) => (order.get(a.dir) ?? 1e9) - (order.get(b.dir) ?? 1e9) || a.dir.localeCompare(b.dir));
}

// A new picture in place of the old one, under the same name scheme (the .png of before goes when
// the new one is a .jpg). When it shows all their pictures, their separate copies go. Returns the
// new file.
export function replaceShot(paths, dirRel, { buf, shot, html }) {
  const dir = path.join(paths.archive, dirRel);
  const day = dirRel.split("/")[0];
  const profile = readJson(path.join(dir, "profile.json"), null) || {};
  const before = readJson(path.join(dir, "shot.json"), null);
  const file = placeShot(paths, dir, day, profile.name, profile.id || path.basename(dir), buf);
  writeJson(path.join(dir, "shot.json"), { ...shot, file: path.basename(file), at: new Date().toISOString(), retakes: (before?.retakes || 0) + 1, retakenOf: before?.file || "an undescribed picture" });
  if (html) { try { keepPage(dir, html); } catch { /* the picture is what was asked for */ } }
  if (showsAllPictures(shot, profile)) removeAvatars(dir);
  return file;
}

// ---- making the archive lean, and room on the disk -----------------------------------------------
// Once: separate pictures go wherever the picture of the page shows them all, and every page is
// compressed. Returns what it did.
export function slimArchive(paths) {
  const out = { avatars: 0, pages: 0, freed: 0 };
  for (const { abs: dir } of folders(paths)) {
    const files = listDir(dir);
    const shot = readJson(path.join(dir, "shot.json"), null);
    if (files.some((f) => AVATAR.test(f)) && shot?.file && files.includes(shot.file) && showsAllPictures(shot, readJson(path.join(dir, "profile.json"), null))) {
      const n = files.filter((f) => AVATAR.test(f)).length;
      out.freed += removeAvatars(dir);
      out.avatars += n;
    }
    if (files.includes("page.html") && !files.includes(PAGE)) {
      try {
        const before = fs.statSync(path.join(dir, "page.html")).size;
        keepPage(dir, fs.readFileSync(path.join(dir, "page.html")));
        out.freed += Math.max(0, before - fs.statSync(path.join(dir, PAGE)).size);
        out.pages++;
      } catch { /* left as it was */ }
    }
  }
  return out;
}

// Free space on the disk that holds `dir`, in bytes, as an ordinary program may use it (what `df`
// shows as Avail); null when the system does not say.
export function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// The disk guard's part here: the pictures of the oldest kept profiles go first, one profile at a
// time, until about `need` bytes are free again. Only pictures: the profile, the outcome and the
// page stay, so `who`, the notebook collection and the practice examples keep working, and
// shot.json notes the deletion so the picture is never taken again. The last `keepDays` days and
// the folders in `keep` (an open question's) are never touched. Returns what went.
export function makeRoom(paths, need, { keepDays = 7, keep = [], now = new Date() } = {}) {
  const floor = new Date(now.getTime() - keepDays * 86400000).toISOString().slice(0, 10);
  const out = { files: 0, profiles: 0, freed: 0, first: null, last: null };
  const order = new Map();
  readJsonl(paths.archiveIndex).forEach((e, i) => { if (e.dir && !order.has(e.dir)) order.set(e.dir, i); });
  const byDay = new Map();
  for (const f of folders(paths, { before: floor })) { if (!byDay.has(f.day)) byDay.set(f.day, []); byDay.get(f.day).push(f.rel); }
  for (const [day, dirs] of byDay) {
    dirs.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
    for (const rel of dirs) {
      if (out.freed >= need) return out;
      if (keep.includes(rel)) continue;
      const dir = path.join(paths.archive, rel);
      const pics = listDir(dir).filter(isPicture);
      if (!pics.length) continue;
      for (const f of pics) {
        const p = path.join(dir, f);
        try { out.freed += fs.statSync(p).size; } catch { continue; }
        if (AVATAR.test(f)) { try { fs.unlinkSync(p); } catch { /* gone */ } } else removeShot(paths, day, p);
        out.files++;
      }
      const before = readJson(path.join(dir, "shot.json"), null);
      try { writeJson(path.join(dir, "shot.json"), { ...(before || { kind: "undescribed", ready: false }), deletedAt: now.toISOString(), deleted: "the disk guard, for room on the disk" }); } catch { /* the disk is full */ }
      out.profiles++;
      out.first = out.first || day;
      out.last = day;
    }
  }
  return out;
}

// A try that brought nothing better: the old picture stays, the try is counted.
export function retakeFailed(paths, dirRel, why) {
  const f = path.join(paths.archive, dirRel, "shot.json");
  const before = readJson(f, null);
  writeJson(f, { ...(before || { kind: "undescribed", ready: false }), ready: before?.ready || false, retakes: (before?.retakes || 0) + 1, lastTry: new Date().toISOString(), why: String(why || "").slice(0, 200) });
}

// The outcome is written next to the profile once it is known (like, pass, the owner's answer).
export function noteOutcome(paths, entry, outcome) {
  if (!entry?.dir) return;
  writeJson(path.join(paths.archive, entry.dir, "outcome.json"), { ...outcome, at: new Date().toISOString() });
}

export function readOutcome(paths, entry) {
  return entry?.dir ? readJson(path.join(paths.archive, entry.dir, "outcome.json"), null) : null;
}

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Newest first, one hit per person. Names count before the bio.
export function search(paths, query, { limit = 5 } = {}) {
  const q = norm(query).replace(/^@/, "").trim();
  if (!q) return [];
  const entries = readJsonl(paths.archiveIndex).reverse();
  const seen = new Set();
  const strong = [], weak = [];
  for (const e of entries) {
    const who = `${e.site}:${e.id}`;
    if (seen.has(who)) continue;
    if (!fs.existsSync(path.join(paths.archive, e.dir || "__none__"))) continue;
    const outcome = readOutcome(paths, e);
    const ids = [e.name, ...Object.values(e.handles || {}), e.discord, outcome?.discordFound].map(norm);
    if (ids.some((v) => v && (v === q || v.includes(q)))) { seen.add(who); strong.push(e); continue; }
    const bio = norm(readJson(path.join(paths.archive, e.dir, "profile.json"), null)?.bio);
    if (bio.includes(q)) { seen.add(who); weak.push(e); }
  }
  return [...strong, ...weak].slice(0, limit).map((e) => ({ ...e, outcome: readOutcome(paths, e) }));
}

// Deletes day folders older than the retention, in the archive and in screenshots/, and drops
// their lines from the index.
export function prune(paths, days, now = new Date()) {
  let removed = 0;
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  for (const d of listDir(paths.screenshots)) if (DAY.test(d) && d < cutoff) removeTree(path.join(paths.screenshots, d));
  for (const d of listDir(paths.archive)) {
    if (DAY.test(d) && d < cutoff && isDir(path.join(paths.archive, d))) { removeTree(path.join(paths.archive, d)); removed++; }
  }
  if (removed) {
    const kept = readJsonl(paths.archiveIndex).filter((e) => (e.day || "") >= cutoff);
    writeText(paths.archiveIndex, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
  }
  return removed;
}

// The picture of the page (named, or page.png), else their first own picture.
export function picturePath(paths, entry) {
  if (!entry?.dir) return null;
  const dir = path.join(paths.archive, entry.dir);
  const named = listDir(dir).filter((f) => SHOT.test(f)).sort().pop();
  for (const f of [named, "page.png", ...(entry.pictures || [])]) if (f && fs.existsSync(path.join(dir, f))) return path.join(dir, f);
  return null;
}
