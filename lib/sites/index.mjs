// The site registry. A site is a folder with site.json (what it is, whether its terms allow the
// Wingman) and adapter.mjs (how to work it, see contract.md). Built-in sites live next to this file
// (lib/sites/<id>/); the person's own, written by them or their coding helper, live in their
// mission control (routines/wingman/sites/<id>/). A built-in site wins over one of the person's
// with the same id.
//
// What a site's terms say is information for the person, never a veto over them. The loader
// refuses a site whose terms were never checked (nobody could tell the person what they say). A
// site whose terms forbid bots, automation or AI use is used only when the person chose it, which
// `site use <id> --accept-terms-risk` records with the day in settings.json (terms_risk_accepted);
// without that choice the loader says, in plain words, what the terms say and how to go ahead.
// Terms checked more than 180 days ago are a reminder to read them again, never a refusal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SiteError } from "./errors.mjs";
import { trustProblem } from "./trust.mjs";
import { SITE_ID, acceptedRisks } from "../core/settings.mjs";
import { PACKAGE } from "../android/sdk.mjs";

export const BUILTIN_DIR = path.dirname(fileURLToPath(import.meta.url));
export const VERDICTS = ["allowed", "silent", "forbidden"];
export const KINDS = ["browser", "android"];
export const CAN = ["queue", "like", "pass", "skip", "inbox", "send", "picture", "liked-you"];
export const RECHECK_DAYS = 180;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const https = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

// The person's choices to use a site although its terms forbid automated use, from the settings
// file in their mission control: { <site id>: "YYYY-MM-DD" }.
export function riskChoices(mcDir) {
  if (!mcDir) return {};
  return acceptedRisks(readJson(path.join(mcDir, "routines", "wingman", "settings.json"))?.terms_risk_accepted);
}

// How a site on by the person's choice is shown in site list, status and check.
export const choiceLine = (day) => `terms forbid automated use; on by your choice (${day})`;

// What is wrong with a site.json: `problems` (it cannot be used as written) and `refused` (the
// plain reason the Wingman does not work there now), each empty when all is well. The option
// `chosenOn` is the day the person chose this site although its terms forbid automated use (from
// riskChoices). The result says whether the site waits for that choice (`needsChoice`) and, when
// it counts, the day it was made (`chosenOn`).
export function validateSite(meta, { dirName, chosenOn = null } = {}) {
  const problems = [];
  if (!meta || typeof meta !== "object") return { problems: ["site.json is missing or not valid JSON"], refused: null, needsChoice: false, chosenOn: null };
  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : meta.id || dirName || "this site";
  if (typeof meta.id !== "string" || !SITE_ID.test(meta.id)) problems.push("id must be lower-case letters, digits and dashes");
  else if (dirName && meta.id !== dirName) problems.push(`id "${meta.id}" must match its folder name "${dirName}"`);
  if (typeof meta.name !== "string" || !meta.name.trim()) problems.push("name is missing");
  if (!KINDS.includes(meta.kind)) problems.push(`kind must be one of ${KINDS.join(", ")}`);
  if (meta.kind === "browser" && !https(meta.home)) problems.push("home must be an https address");
  if (meta.kind === "android" && meta.home !== undefined && !https(meta.home)) problems.push("home must be an https address");
  if (meta.kind === "android" && !(meta.android && typeof meta.android.package === "string" && PACKAGE.test(meta.android.package))) problems.push("android.package must be the app's package name, like com.example.app");
  if (meta.login_url !== undefined && !https(meta.login_url)) problems.push("login_url must be an https address");
  if (meta.post_reads !== undefined && !(Array.isArray(meta.post_reads) && meta.post_reads.every(https))) problems.push("post_reads must list https addresses");
  if (meta.profile_url !== undefined && !(typeof meta.profile_url === "string" && https(meta.profile_url.replace("{id}", "x")) && meta.profile_url.includes("{id}"))) problems.push("profile_url must be an https address containing {id}");
  if (!Array.isArray(meta.can) || meta.can.some((c) => !CAN.includes(c))) problems.push(`can must list only ${CAN.join(", ")}`);
  const t = meta.terms;
  let refused = null, needsChoice = false, chosen = null;
  if (!t || typeof t !== "object" || !VERDICTS.includes(t.verdict)) {
    refused = `Nobody has checked whether the terms of ${name} allow a helper like the Wingman, so it does not work there. Read the terms and record what they say in its site.json.`;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.checked_on || ""))) problems.push("terms.checked_on must be a date like 2026-10-10");
    if (!Array.isArray(t.urls) || !t.urls.length || t.urls.some((u) => !https(u))) problems.push("terms.urls must list the https addresses of the terms that were read");
    if (t.verdict === "forbidden") {
      if (chosenOn) chosen = chosenOn;
      else {
        needsChoice = true;
        refused = `${forbidsText(name, t)}, so the Wingman works there only if you choose that, knowing the site may suspend or close your account. To go ahead: godspeed-wingman site use ${meta.id || dirName} --accept-terms-risk`;
      }
    }
  }
  return { problems, refused, needsChoice, chosenOn: chosen };
}

// "The terms of Kind Meet forbid bots, automation or AI use (read on 2026-10-10)".
export function forbidsText(name, t) {
  return `The terms of ${name} forbid bots, automation or AI use${t?.checked_on ? ` (read on ${t.checked_on})` : ""}`;
}

// A reminder when the terms were read more than RECHECK_DAYS ago (or the date is unreadable).
export function termsReminder(meta, now = new Date()) {
  const t = meta?.terms;
  if (!t || !VERDICTS.includes(t.verdict)) return null;
  const d = Date.parse(`${t.checked_on}T00:00:00Z`);
  if (Number.isNaN(d)) return `The terms of ${meta.name || meta.id} have no date of when they were read; read them again.`;
  const days = Math.floor((now.getTime() - d) / 86400000);
  return days > RECHECK_DAYS ? `The terms of ${meta.name || meta.id} were last read ${days} days ago (${t.checked_on}). Read them again and update its site.json.` : null;
}

// Every site folder: built-ins first, then the person's own (a same-named one is reported, not used).
export function siteDirs({ mcDir } = {}) {
  const out = [];
  const seen = new Set();
  const scan = (root, builtin) => {
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith(".")).map((d) => d.name).sort(); } catch { return; }
    for (const id of names) {
      const dir = path.join(root, id);
      if (!fs.existsSync(path.join(dir, "site.json"))) continue;
      if (seen.has(id)) { out.push({ id, dir, builtin, shadowed: true }); continue; }
      seen.add(id);
      out.push({ id, dir, builtin, shadowed: false });
    }
  };
  scan(BUILTIN_DIR, true);
  if (mcDir) scan(path.join(mcDir, "routines", "wingman", "sites"), false);
  return out;
}

// Every site the Wingman knows, with what is wrong with each. `untrusted` (the person's own sites
// only) says why this process must not run the adapter's code (trust.mjs); `trust` stands in for
// the machine in tests. `needsChoice`: the terms forbid automated use and the person has not
// chosen the site; `chosenOn`: the day they did.
export function listSites({ mcDir, now = new Date(), trust, choices = riskChoices(mcDir) } = {}) {
  return siteDirs({ mcDir }).map((d) => {
    const meta = readJson(path.join(d.dir, "site.json"));
    const { problems, refused, needsChoice, chosenOn } = validateSite(meta, { dirName: d.id, chosenOn: d.shadowed ? null : choices[d.id] || null });
    if (!fs.existsSync(path.join(d.dir, "adapter.mjs"))) problems.push("adapter.mjs is missing");
    if (d.shadowed) problems.push(`a built-in site has the id ${d.id}, so this one is not used`);
    return {
      id: d.id, dir: d.dir, builtin: d.builtin, shadowed: d.shadowed, meta,
      name: meta?.name || d.id, kind: meta?.kind || null,
      ok: !problems.length && !refused, problems, refused, needsChoice, chosenOn,
      reminder: meta && !refused ? termsReminder(meta, now) : null,
      untrusted: d.builtin ? null : trustProblem(d.dir, meta?.name || d.id, trust),
    };
  });
}

// The SiteError for a site the terms keep out, with what the worker needs to tell the person once
// (code "terms": the terms forbid automated use and the person has not chosen the site).
function refusedError(id, v, meta) {
  return v.needsChoice
    ? new SiteError(v.refused, { site: id, refused: true, code: "terms", details: { checkedOn: meta?.terms?.checked_on || "" } })
    : new SiteError(v.refused, { site: id, refused: true });
}

// For a site already loaded: its site.json and the person's choice read again, so a new reading of
// the terms, or a choice taken back, counts at once. Null while the site may still be used,
// otherwise the SiteError to throw.
export function termsStop(id, dir, { mcDir } = {}) {
  const meta = readJson(path.join(dir, "site.json"));
  const v = validateSite(meta, { dirName: id, chosenOn: riskChoices(mcDir)[id] || null });
  return v.refused ? refusedError(id, v, meta) : null;
}

// One site, ready to use: { id, meta, dir, builtin, reminder, create }. Throws a SiteError with
// `refused` set and plain words when the site is unknown, broken or refused.
export async function loadSite(id, { mcDir, now = new Date(), trust } = {}) {
  const found = listSites({ mcDir, now, trust }).find((s) => s.id === id && !s.shadowed);
  if (!found) throw new SiteError(`The Wingman knows no site called "${id}".`, { site: id, refused: true });
  if (found.refused) throw refusedError(id, found, found.meta);
  // Before anything of the person's own code is imported.
  if (found.untrusted) throw new SiteError(found.untrusted, { site: id, refused: true, code: "untrusted" });
  if (found.problems.length) throw new SiteError(`The site ${found.name} cannot be used as it is: ${found.problems.join("; ")}.`, { site: id, refused: true });
  let mod;
  try { mod = await import(pathToFileURL(path.join(found.dir, "adapter.mjs")).href); }
  catch (e) { throw new SiteError(`The adapter of ${found.name} does not load: ${e.message}`, { site: id, refused: true }); }
  const create = mod.default || mod.create;
  if (typeof create !== "function") throw new SiteError(`The adapter of ${found.name} exports no create function.`, { site: id, refused: true });
  return { id, meta: found.meta, dir: found.dir, builtin: found.builtin, reminder: found.reminder, create };
}

// The methods every adapter must have, and the ones a site.json "can" entry promises.
export const REQUIRED = ["session", "queue", "profile", "like", "pass"];
export const PROMISED = { inbox: ["conversations"], send: ["send"], picture: ["open", "picture"], skip: ["skip"], "liked-you": ["likedYou"] };

// What an adapter object lacks, measured against the contract and its own site.json.
export function adapterGaps(adapter, meta) {
  const want = [...REQUIRED, ...(meta?.can || []).flatMap((c) => PROMISED[c] || [])];
  return [...new Set(want)].filter((m) => typeof adapter?.[m] !== "function");
}
