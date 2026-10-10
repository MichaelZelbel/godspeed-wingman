// The person's own sites: making a new one from the template, recording what its terms say, and
// switching a site on and off. Every refusal is one plain sentence (an Error whose message is meant
// for the person).
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_DIR, KINDS, VERDICTS, listSites } from "./index.mjs";
import { PACKAGE } from "../android/sdk.mjs";
import { SITE_ID, defaults } from "../core/settings.mjs";
import { readJson } from "../core/store.mjs";
import { siteState } from "../core/state.mjs";

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

function writeSites(settingsFile, sites) {
  const mine = readJson(settingsFile, {}) || {};
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ ...mine, sites }, null, 2) + "\n");
}

// Why a site cannot be switched on, as one sentence, or null.
export function cannotUse(site) {
  if (!site) return null;
  if (site.refused) {
    if (!site.meta?.terms || !VERDICTS.includes(site.meta.terms.verdict)) return `Nobody has checked yet whether the terms of ${site.name} allow a helper like the Wingman, so it cannot be switched on. Read them and record what they say: godspeed-wingman site terms ${site.id} --verdict ... --url ... --quote ...`;
    return `${site.refused} It cannot be switched on.`;
  }
  if (site.shadowed) return `A built-in site has the id ${site.id}, so your own folder of that name is not used.`;
  if (site.problems.length) return `${site.name} cannot be switched on as it is: ${site.problems.join("; ")}.`;
  return null;
}

export function useSite({ mcDir, routine, id }) {
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed);
  if (!site) throw new Error(`The Wingman knows no site called ${id}. \`godspeed-wingman site list\` shows the ones it knows.`);
  const why = cannotUse(site);
  if (why) throw new Error(why);
  const sites = enabledSites(routine.settings);
  if (sites.includes(id)) return { changed: false, site, sites };
  const next = [...sites, id];
  writeSites(routine.settings, next);
  return { changed: true, site, sites: next };
}

export function offSite({ mcDir, routine, id }) {
  const sites = enabledSites(routine.settings);
  const site = listSites({ mcDir }).find((s) => s.id === id && !s.shadowed) || null;
  if (!sites.includes(id)) return { changed: false, site, sites };
  const next = sites.filter((s) => s !== id);
  writeSites(routine.settings, next);
  return { changed: true, site, sites: next };
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
      blocked: cannotUse(s), reminder: s.reminder, untrusted: s.untrusted,
    };
  });
}
