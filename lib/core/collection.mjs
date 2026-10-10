// "Wingman: likes and passes": one collection in the person's Godspeed notebook with one item per
// profile the Wingman liked or passed, on any site, newest first.
//
// The Wingman owns every column but one: "Your comment" is the person's alone. An item is only ever
// updated by reading it first, adding the Wingman's columns to what is there, and saving with the
// version just read, so the comment (and any column the person adds) is never overwritten or
// cleared, not even by an edit made at the same moment.
//
// The collection is hidden from the assistants ("Hide from AI"): these are strangers' profiles,
// and nothing in the notebook may turn them into people, facts or suggestions. Hiding it also keeps
// the items out of the meaning search and away from every assistant, so none of them can copy a
// name into a note that would be processed. The person sees it on their own screen as usual.
//
// What fills it comes from the worker's own records, all kept for the retention: the log of
// decisions, the archived profiles, the review answers. A second like or pass of the same profile
// updates its item; nothing is ever deleted from the collection.
import path from "node:path";
import { readJsonl, readJson } from "./store.mjs";
import { wallClock } from "./settings.mjs";
import { clean } from "./text.mjs";
import { picturePath, SHOT } from "./archive.mjs";

export const TITLE = "Wingman: likes and passes";
export const SOURCE = "godspeed-wingman";

export const FIELDS = [
  { key: "seen", label: "Date seen", type: "date", indexable: true },
  { key: "name", label: "Name", type: "text", primary: true, indexable: true },
  { key: "age", label: "Age", type: "number" },
  { key: "gender", label: "Gender", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "site", label: "Site", type: "text", indexable: true },
  { key: "decision", label: "Liked or passed", type: "select", options: ["liked", "passed"], indexable: true },
  { key: "decided_by", label: "Decided by", type: "text" },
  { key: "profile", label: "Profile", type: "url" },
  { key: "discord", label: "Discord", type: "text" },
  { key: "screenshot", label: "Screenshot", type: "url" },
  { key: "comment", label: "Your comment", type: "longtext" },
];
// The columns the Wingman writes. "comment" is not among them, and never may be.
export const OWNED = ["seen", "name", "age", "gender", "location", "site", "decision", "decided_by", "profile", "discord", "screenshot"];

export function description(screenshotsUrl, retentionDays = 42) {
  return "Every profile your Wingman liked or passed, one item each, newest first. It fills every column "
    + "except Your comment, which is yours alone: it never changes or clears it. "
    + (screenshotsUrl
      ? `The screenshots of the profiles, named by date and name and kept ${retentionDays} days: ${screenshotsUrl} (each item's Screenshot opens one).`
      : `The screenshots of the profiles, named by date and name and kept ${retentionDays} days, are in the Wingman's private folder on the computer it runs on (screenshots).`);
}

export function shape(screenshotsUrl, retentionDays) {
  return {
    name: TITLE, icon: "💘", description: description(screenshotsUrl, retentionDays), field_schema: FIELDS, visibility: "personal",
    ai_visibility: "hidden", source_app: SOURCE, category: "relationships",
    agent_instructions: "Kept by the Wingman (godspeed-wingman). Strangers' dating profiles: never make people, facts, timeline entries or suggestions from these items, and never add or change items.",
  };
}

const REGION = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
export function countryName(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  try { const n = REGION?.of(c); return n && n !== c ? n : c; } catch { return c; }
}

// Only a link on the site itself: the kept address when it is an https address on the site's own
// host with a plain path, else one built from the id with the site's profile_url ("https://x/{id}").
export function profileLink(url, id, site = {}) {
  let home = null;
  try { home = site.home ? new URL(site.home) : null; } catch { home = null; }
  const u = String(url || "");
  if (home && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]{0,200}$/.test(u)) {
    try { if (new URL(u).host === home.host) return u; } catch { /* not an address */ }
  }
  const safe = String(id || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (safe && typeof site.profile_url === "string" && /^https:\/\/[^\s{}]+\{id\}[^\s{}]*$/.test(site.profile_url)) return site.profile_url.replace("{id}", safe);
  return "";
}

export function screenshotsBase(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(u) ? u : "";
}

function shotLink(paths, entry, base) {
  if (!base || !entry) return undefined;
  const pic = picturePath(paths, entry);
  const day = String(entry.dir || "").split("/")[0];
  if (!pic || !SHOT.test(path.basename(pic)) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return `${base}/${day}/${encodeURIComponent(path.basename(pic))}`;
}

const text = (s, max = 40) => { const t = clean(s, max); return t === "(no name)" ? "" : t; };

// One row per profile, from the newest like or pass of each, in the order they were decided.
// `sites` maps a site id to its site.json (name, home, profile_url). A column left undefined is not
// known now and is never written.
export function rows(paths, { timezone = "UTC", screenshotsUrl = "", sites = {} } = {}) {
  const base = screenshotsBase(screenshotsUrl);
  const latest = new Map();
  for (const d of readJsonl(paths.decisions)) if ((d.action === "like" || d.action === "pass") && d.id) latest.set(`${d.site}:${d.id}`, d);
  const index = readJsonl(paths.archiveIndex);
  const reviews = readJsonl(paths.examples).filter((e) => e.kind === "review" && e.id);
  const out = [];
  for (const d of [...latest.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const entry = [...index].reverse().find((e) => e.id === d.id && e.site === d.site && readJson(path.join(paths.archive, e.dir || "__none__", "profile.json")));
    const profile = entry ? readJson(path.join(paths.archive, entry.dir, "profile.json")) : null;
    const outcome = entry ? readJson(path.join(paths.archive, entry.dir, "outcome.json")) : null;
    const review = reviews.filter((e) => e.id === d.id && e.site === d.site && String(e.at) >= String(d.at)).pop();
    let by = d.by === "you" ? "you" : "the Wingman";
    if (review) by += review.owner === d.action ? "; on review you agreed" : `; on review you would have ${review.owner === "like" ? "liked" : "passed"}`;
    // Without the kept profile (gone with the retention, or never kept) its columns stay as they are.
    const known = (v) => (profile ? v : undefined);
    const meta = sites[d.site] || {};
    out.push({
      id: `${d.site}:${d.id}`, at: d.at,
      fields: {
        seen: wallClock(new Date(d.at), timezone).day,
        name: text(profile?.name ?? d.name) || "(no name)",
        age: known(Number.isFinite(profile?.age) ? profile.age : null),
        gender: known(text(profile?.gender || "", 80)),
        location: known(countryName(profile?.country) || text(profile?.location || "", 80)),
        site: text(meta.name || d.site || "", 40),
        decision: d.action === "like" ? "liked" : "passed",
        decided_by: by,
        profile: profileLink(profile?.url, d.id, meta),
        discord: known(text(profile?.contact?.discord || outcome?.discordFound || "")),
        screenshot: shotLink(paths, entry, base),
      },
    });
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Makes the collection if it is not there and brings every item level with the rows. Returns
// what it did; `collectionId` is the one the worker remembers.
export async function sync(nb, paths, { collectionId, timezone, screenshotsUrl, sites, retentionDays, log = () => {} } = {}) {
  let coll = collectionId ? await nb.collection(collectionId) : null;
  if (!coll) coll = (await nb.collectionsBy(SOURCE)).find((c) => c.name === TITLE && !c.removed_at) || null;
  if (coll?.removed_at) return { removed: true, collectionId: coll.id, inserted: 0, updated: 0, total: 0 };
  let created = false;
  if (!coll) { coll = await nb.createCollection(shape(screenshotsBase(screenshotsUrl), retentionDays)); created = true; }
  const items = new Map();
  for (const it of await nb.items(coll.id)) if (it.source_id && !it.removed_at) items.set(it.source_id, it);
  let inserted = 0, updated = 0, conflicts = 0;
  const want = rows(paths, { timezone, screenshotsUrl, sites });
  for (const r of want) {
    const it = items.get(r.id);
    if (!it) {
      const data = Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v !== undefined));
      await nb.insertItem({ collection_id: coll.id, source_app: SOURCE, source_id: r.id, created_at: r.at, data });
      inserted++;
      continue;
    }
    const mine = OWNED.filter((k) => r.fields[k] !== undefined);
    if (mine.every((k) => same(it.data?.[k], r.fields[k]))) continue;
    const data = { ...(it.data || {}) };
    for (const k of mine) data[k] = r.fields[k];
    try { await nb.updateItem(it.id, data, it._hash); updated++; }
    catch (e) {
      // The person saved the item at this moment: the notebook kept both versions, and the next
      // round reads theirs and adds the Wingman's columns again.
      if (e.status === 409 || e.code === "CONFLICT") { conflicts++; log(`collection item for ${r.fields.name} changed while writing; again next round`); continue; }
      throw e;
    }
  }
  return { collectionId: coll.id, slug: coll.slug || null, created, inserted, updated, conflicts, total: want.length };
}
