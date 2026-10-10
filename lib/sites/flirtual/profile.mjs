// A Flirtual user, turned into what a person reads on the profile page and into the Wingman's
// common profile shape (see ../contract.md): the name, age, the boxes they ticked, their bio and
// their answers. Flirtual stores the boxes as codes; the names come from its own word list
// (names.json, copied from the open-source web app).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileUrl } from "./api.mjs";

const NAMES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "names.json"), "utf8"));
const TYPES = ["gender", "sexuality", "kink", "game", "platform", "interest"];

export function nameOf(id, type) {
  if (type && NAMES[type]?.[id]) return NAMES[type][id];
  for (const t of TYPES) if (NAMES[t]?.[id]) return NAMES[t][id];
  return null;
}

function typeOf(id) {
  for (const t of TYPES) if (NAMES[t]?.[id]) return t;
  return null;
}

// Flirtual has sent attributes both grouped by type ({ gender: [ids] }) and as a flat list of ids
// or {id, type} objects; read all three.
export function groupAttributes(raw) {
  const out = Object.fromEntries(TYPES.map((t) => [t, []]));
  const add = (id, type) => {
    if (!id) return;
    const t = TYPES.includes(type) ? type : typeOf(id);
    if (!t) return;
    const name = nameOf(id, t);
    if (name && !out[t].includes(name)) out[t].push(name);
  };
  const take = (item, type) => {
    if (typeof item === "string") add(item, type);
    else if (item && typeof item === "object") add(item.id, item.type || type);
  };
  if (Array.isArray(raw)) raw.forEach((i) => take(i));
  else if (raw && typeof raw === "object") for (const [type, list] of Object.entries(raw)) (Array.isArray(list) ? list : [list]).forEach((i) => take(i, type));
  return out;
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ageOf(user, now = new Date()) {
  if (Number.isFinite(user?.age)) return user.age;
  const born = user?.born_at || user?.bornAt;
  if (!born) return null;
  const b = new Date(born);
  if (Number.isNaN(b.getTime())) return null;
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return undefined; };
const list = (a) => (a && a.length ? a.join(", ") : "");

export function normalize(user, now = new Date()) {
  const p = user?.profile || {};
  const attrs = groupAttributes(pick(p, "attributes") || {});
  const genders = attrs.gender.filter((g) => !g.includes("/"));
  const pronouns = attrs.gender.filter((g) => g.includes("/"));
  const prompts = (pick(p, "prompts") || []).map((x) => ({
    q: NAMES.prompt?.[pick(x, "prompt_id", "promptId")] || pick(x, "prompt_id", "promptId") || "",
    a: htmlToText(pick(x, "response", "answer") || ""),
  })).filter((x) => x.a);
  // Flirtual sends picture ids, not addresses; the web app builds the address from a bucket origin
  // set at build time. The adapter prefers the real addresses read off the open page; these are
  // the fallback, the address the page uses (content.flirtual.com/<id>/profile).
  const rawImages = pick(p, "images") || [];
  const photoKeys = rawImages.map((i) => pick(i, "external_id", "externalId", "original_file", "originalFile")).filter((k) => typeof k === "string" && k);
  const photos = rawImages.map((i) => {
    const url = pick(i, "url");
    if (typeof url === "string" && /^https:/.test(url)) return url;
    const ext = pick(i, "external_id", "externalId");
    if (ext) return `https://content.flirtual.com/${encodeURIComponent(ext)}/profile`;
    const orig = pick(i, "original_file", "originalFile");
    return orig ? `https://api.flirtu.al/v1/images/files/${encodeURIComponent(orig)}` : null;
  }).filter(Boolean);
  const languages = (pick(p, "languages") || []).map((l) => NAMES.language?.[l] || l);
  const lookingFor = (pick(p, "relationships") || []).map((r) => NAMES.relationship?.[r] || r);
  const monogamy = pick(p, "monopoly") || null;
  const domsub = pick(p, "domsub") || null;
  const customInterests = (pick(p, "custom_interests", "customInterests") || []).filter((x) => typeof x === "string");
  const vrchatName = pick(p, "vrchat_name", "vrchatName") || null;
  const vrchat = pick(p, "vrchat") || null;
  const fields = {
    "Sexuality": list(attrs.sexuality),
    "Looking for": `${list(lookingFor)}${monogamy ? ` (${monogamy})` : ""}`,
    "Dominant/submissive": domsub || "",
    "Kinks": list(attrs.kink),
    "VR setup": list(attrs.platform),
    "Games": list(attrs.game),
    "Interests": list([...attrs.interest, ...customInterests]),
    "Languages": list(languages),
    ...(pick(p, "new") ? { "New to VR": "yes" } : {}),
  };
  const discord = pick(p, "discord");
  return {
    id: user?.id,
    site: "flirtual",
    name: pick(p, "display_name", "displayName") || user?.slug || "(no name)",
    age: ageOf(user, now),
    gender: genders.join(", "),
    pronouns: pronouns.join(", "),
    location: "",
    country: pick(p, "country") || null,
    bio: htmlToText(pick(p, "biography") || ""),
    fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
    prompts,
    texts: customInterests,
    handles: Object.fromEntries([["VRChat name", vrchatName], ["VRChat", typeof vrchat === "string" ? vrchat : null], ["page name", user?.slug || null]].filter(([, v]) => v)),
    photos,
    photoKeys,
    url: profileUrl(user),
    contact: discord ? { discord } : {},
    timezone: pick(p, "timezone") || null,
    activeAt: user?.active_at || user?.activeAt || null,
    raw: user,
  };
}

const none = (s) => s || "none given";

// What the judge reads. Everything a person would see on the page, nothing they would not.
export function digest(pr) {
  const f = pr.fields || {};
  const lines = [
    `Name: ${pr.name}${Number.isFinite(pr.age) ? `, ${pr.age}` : ""}${pr.country ? `, ${String(pr.country).toUpperCase()}` : ""}`,
    `Gender they ticked: ${none(pr.gender)}`,
    `Pronouns they ticked: ${none(pr.pronouns)}`,
    `Sexuality they ticked: ${none(f.Sexuality)}`,
    `Looking for: ${none(f["Looking for"])}`,
    `Dominant/submissive: ${f["Dominant/submissive"] || "not given"}`,
    `Kinks: ${none(f.Kinks)}`,
    `VR setup: ${none(f["VR setup"])}`,
    `Games: ${none(f.Games)}`,
    `Interests: ${none(f.Interests)}`,
    `Languages: ${none(f.Languages)}`,
    f["New to VR"] ? "New to VR: yes" : null,
    `Bio:\n${pr.bio || "(empty)"}`,
  ].filter(Boolean);
  for (const q of pr.prompts || []) lines.push(`${q.q}: ${q.a}`);
  return lines.join("\n");
}
