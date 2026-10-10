// The person's own sites: making a new one from the template, recording what its terms say, and
// switching a site on and off. Every refusal is one plain sentence (an Error whose message is meant
// for the person). A site whose terms forbid automated use is switched on only by the person's own
// choice (`site use <id> --accept-terms-risk`), kept with the day in settings.json.
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_DIR, KINDS, VERDICTS, listSites, forbidsText, choiceLine } from "./index.mjs";
import { PACKAGE } from "../android/sdk.mjs";
import { SITE_ID, defaults, acceptedRisks } from "../core/settings.mjs";
import { readJson } from "../core/store.mjs";
import { siteState } from "../core/state.mjs";
import { clean } from "../core/text.mjs";

export const TEMPLATE_DIR = path.join(BUILTIN_DIR, "_template");
// A site's name as people read it: letters, digits, spaces and a little punctuation.
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&!+-]{0,59}$/u;

const https = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
const cleanUrl = (u) => new URL(u).href.replace(/\/+$/, "");
const plainName = (id) => id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function ownSitesDir(mcDir) { return path.join(mcDir, "routines", "wingman", "sites"); }

// Makes routines/wingman/sites/<id>/ from the template of its kind. Its site.json has no terms
// yet, so the site cannot be switched on before someone reads them and records what they say.
export function newSite({ mcDir, id, kind = "browser", name, home, pkg }) {
  if (!SITE_ID.test(String(id || ""))) throw new Error("A site's id is lower-case letters, digits and dashes, like kind-meet.");
  if (!KINDS.includes(kind)) throw new Error("A site is either --kind browser (a website) or --kind android (an app in the Android emulator).");
  const known = listSites({ mcDir }).find((s) => s.id === id);
  if (known?.builtin) throw new Error(`The Wingman already has a built-in site called ${id}.`);
  const dir = path.join(ownSitesDir(mcDir), id);
  if (fs.existsSync(dir)) throw new Error(`There is already a folder for ${id} (${dir}); work on that one, or pick another id.`);
  const shown = name === undefined || name === "" ? plainName(id) : String(name).trim();
  if (!NAME.test(shown)) throw new Error("A site's name is letters, digits, spaces and simple punctuation, at most 60 characters.");
  let homeUrl = "";
  if (home !== undefined && home !== "") {
    if (!https(home)) throw new Error("The site's address must start with https://.");
    homeUrl = cleanUrl(home);
  }
  if (kind === "browser" && !homeUrl) throw new Error("Say where the website is: --home https://...");
  if (kind === "android" && !PACKAGE.test(String(pkg || ""))) throw new Error("Say which app it is: --package com.example.app (the id in its Play Store address).");

  const src = path.join(TEMPLATE_DIR, kind);
  const meta = JSON.parse(fs.readFileSync(path.join(src, "site.json"), "utf8"));
  meta.id = id;
  meta.name = shown;
  meta.about = `${shown}, a dating ${kind === "android" ? "app" : "site"}`;
  if (kind === "browser") { meta.home = homeUrl; meta.login_url = homeUrl; }
  else {
    if (homeUrl) meta.home = homeUrl; else delete meta.home;
    meta.android = { package: pkg };
  }
  const fill = (text) => text.replaceAll("__ID__", id).replaceAll("__NAME__", shown).replaceAll("__HOME__", homeUrl || "(no website)").replaceAll("__PACKAGE__", pkg || "");
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const f of fs.readdirSync(src)) {
    const to = path.join(dir, f === "gitignore" ? ".gitignore" : f);
    if (f === "site.json") fs.writeFileSync(to, JSON.stringify(meta, null, 2) + "\n");
    else fs.writeFileSync(to, fill(fs.readFileSync(path.join(src, f), "utf8")));
    files.push(to);
  }
  return { dir, files, meta };
}

// Writes what the terms say into the site's site.json, dated today. `day` is "YYYY-MM-DD".
export function recordTerms({ mcDir, id, verdict, urls = [], quotes = [], note = "", day }) {
  const known = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed);
  if (!known) throw new Error(`The Wingman knows no site called ${id}; make it first with: godspeed-wingman site new ${id}`);
  if (known.builtin) throw new Error(`${known.name} is built into the Wingman; its terms are checked by the Wingman's makers and come with each version.`);
  if (!VERDICTS.includes(verdict)) throw new Error("The verdict is allowed (the terms explicitly permit automated or AI help), silent (nothing in them is against it) or forbidden.");
  const list = urls.map((u) => String(u).trim()).filter(Boolean);
  if (!list.length || !list.every(https)) throw new Error("Name the https address of every page of terms you read: --url https://... (once per page).");
  const q = quotes.map((x) => String(x).trim()).filter(Boolean);
  if (verdict !== "silent" && !q.length) throw new Error(`A verdict of ${verdict} rests on sentences in the terms; quote them word for word: --quote "..." (once per sentence).`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error("internal: the day is missing");
  const file = path.join(known.dir, "site.json");
  const meta = readJson(file, null);
  if (!meta) throw new Error(`${file} is not valid JSON; repair it first.`);
  const terms = { checked_on: day, urls: list, verdict, quotes: q, note: String(note || "").trim() };
  // terms goes right before "can", where a person reading the file expects it.
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "terms") continue;
    if (k === "can") out.terms = terms;
    out[k] = v;
  }
  if (!out.terms) out.terms = terms;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return { file, meta: out, name: known.name };
}

// The sites switched on, as the settings file has them (the default when it names none).
export function enabledSites(settingsFile) {
  const mine = readJson(settingsFile, {}) || {};
  return Array.isArray(mine.sites) ? mine.sites.filter((s) => typeof s === "string" && SITE_ID.test(s)) : defaults().sites;
}

// Changes settings.json as the person wrote it: every other key stays.
function editSettings(settingsFile, fn) {
  const mine = readJson(settingsFile, {}) || {};
  fn(mine);
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(mine, null, 2) + "\n");
}

// The day the person chose a site although its terms forbid automated use, or null.
export function riskChoice(settingsFile, id) {
  return acceptedRisks((readJson(settingsFile, {}) || {}).terms_risk_accepted)[id] || null;
}

// Takes the person's choice back (site off, or terms that no longer forbid it). True when there was one.
export function forgetRiskChoice(settingsFile, id) {
  if (!riskChoice(settingsFile, id)) return false;
  editSettings(settingsFile, (mine) => {
    const left = acceptedRisks(mine.terms_risk_accepted);
    delete left[id];
    mine.terms_risk_accepted = left;
  });
  return true;
}

// What the terms say and how to go ahead, in two plain sentences: for a site whose terms forbid
// automated use and that the person has not chosen.
export function riskQuestion(site) {
  const t = site.meta?.terms || {};
  const q = (Array.isArray(t.quotes) ? t.quotes : []).map((x) => String(x).trim()).find(Boolean);
  const said = q ? `${clean(q, 240)}${q.length > 240 ? "..." : ""}` : "";
  const end = said && /[.!?]$/.test(said) ? "" : ".";
  return `${forbidsText(site.name, t)}${said ? `: "${said}"` : ""}${end} The site may suspend or close an account that uses a helper like the Wingman; if you want it anyway, that is your choice: godspeed-wingman site use ${site.id} --accept-terms-risk`;
}

// Why a site cannot be switched on, as one or two plain sentences, or null.
export function cannotUse(site) {
  if (!site) return null;
  if (site.refused) {
    if (site.needsChoice) return riskQuestion(site);
    return `Nobody has checked yet whether the terms of ${site.name} allow a helper like the Wingman, so it cannot be switched on. Read them and record what they say: godspeed-wingman site terms ${site.id} --verdict ... --url ... --quote ...`;
  }
  if (site.shadowed) return `A built-in site has the id ${site.id}, so your own folder of that name is not used.`;
  if (site.problems.length) return `${site.name} cannot be switched on as it is: ${site.problems.join("; ")}.`;
  return null;
}

// Switches a site on. `acceptRisk` is the person's own choice for a site whose terms forbid
// automated use; it is kept with `day` ("YYYY-MM-DD") in settings.json, and only for such a site.
// The result says whether the list of sites changed, and the day of a choice made now (`chosenOn`).
export function useSite({ mcDir, routine, id, acceptRisk = false, day = null }) {
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed);
  if (!site) throw new Error(`The Wingman knows no site called ${id}. \`godspeed-wingman site list\` shows the ones it knows.`);
  const choose = !!(site.needsChoice && acceptRisk);
  if (choose && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error("internal: the day is missing");
  const why = cannotUse(choose ? { ...site, refused: null, needsChoice: false } : site);
  if (why) throw new Error(why);
  const sites = enabledSites(routine.settings);
  const changed = !sites.includes(id);
  const next = changed ? [...sites, id] : sites;
  if (changed || choose) {
    editSettings(routine.settings, (mine) => {
      mine.sites = next;
      if (choose) mine.terms_risk_accepted = { ...acceptedRisks(mine.terms_risk_accepted), [id]: day };
    });
  }
  return { changed, site, sites: next, chosenOn: choose ? day : null };
}

// Switches a site off, and takes back a choice to use it although its terms forbid automated use,
// so switching it on again asks again.
export function offSite({ mcDir, routine, id }) {
  const sites = enabledSites(routine.settings);
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed) || null;
  const forgot = forgetRiskChoice(routine.settings, id);
  if (!sites.includes(id)) return { changed: false, site, sites, forgot };
  const next = sites.filter((s) => s !== id);
  editSettings(routine.settings, (mine) => { mine.sites = next; });
  return { changed: true, site, sites: next, forgot };
}

// One row per site, for `site list`.
export function siteRows({ mcDir, routine, state, now = new Date() }) {
  const on = new Set(enabledSites(routine.settings));
  return listSites({ mcDir, now }).map((s) => {
    const t = s.meta?.terms;
    const verdict = t && VERDICTS.includes(t.verdict) ? t.verdict : null;
    return {
      id: s.id, name: s.name, kind: s.kind, builtin: s.builtin, shadowed: s.shadowed,
      verdict, checkedOn: verdict ? t.checked_on || null : null,
      on: on.has(s.id) && !s.shadowed,
      mode: siteState(state, s.id).mode === "auto" ? "autopilot" : "practice",
      blocked: cannotUse(s), chosen: s.chosenOn ? choiceLine(s.chosenOn) : null, reminder: s.reminder, untrusted: s.untrusted,
    };
  });
}
