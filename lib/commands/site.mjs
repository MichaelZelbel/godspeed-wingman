// The dating sites: which ones the Wingman knows, making a new one, recording what its terms say,
// checking it (read only), and switching it on or off.
import { flagSpec } from "./index.mjs";
import { workerAlive, stateOf, heartbeat } from "./_common.mjs";
import { wallClock } from "../core/settings.mjs";

const USAGE = "site list | new <id> --kind browser|android [--name ..] [--home https://..] [--package com.example.app] | terms <id> --verdict allowed|silent|forbidden --url .. --quote \"..\" --note \"..\" | check <id> [--offline] [--show] [--profile <id>] | use <id> [--accept-terms-risk] | off <id> | login <id> | network <id> [--url ..]";

export const meta = {
  name: "site", summary: "the dating sites: list, new, terms, check (read only), use, off, login, network", usage: USAGE,
  flags: { value: ["kind", "home", "package", "verdict", "url", "profile", "seconds"], greedy: ["name", "quote", "note"], bool: ["offline", "show", "accept-terms-risk"] },
};

// Every value of a flag that may be given more than once (--url, --quote).
export function every(argv, name, spec) {
  const known = (a) => typeof a === "string" && a.startsWith("--") && (spec.value.has(a.slice(2)) || spec.greedy.has(a.slice(2)) || spec.bool.has(a.slice(2)));
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== `--${name}`) continue;
    if (spec.greedy.has(name)) {
      const words = [];
      while (i + 1 < argv.length && !known(argv[i + 1])) words.push(argv[++i]);
      if (words.length) out.push(words.join(" "));
    } else if (i + 1 < argv.length && !known(argv[i + 1])) out.push(argv[++i]);
  }
  return out;
}

const printer = (ctx) => ({
  ok: (t) => ctx.print(`  ok   ${t}`),
  fail: (t) => ctx.print(`  FAIL ${t}`),
  note: (t) => ctx.print(`  NOTE ${t}`),
  info: (t) => ctx.print(t),
});

async function sync(ctx, message) {
  const { syncInBackground } = await import("../core/sync.mjs");
  syncInBackground(ctx.mcDir, message, ctx.settings.sync);
}

// The drivers a live check uses: while the worker runs, a browser tab of its own.
function liveDeps(ctx) {
  return {
    browser: async (settings) => {
      const { createDriver } = await import("../drivers/index.mjs");
      return createDriver(settings, { paths: ctx.paths, tab: workerAlive(ctx.paths) ? "new" : "shared", keepOpen: true });
    },
    android: async (settings) => {
      const { createDriver } = await import("../drivers/android.mjs");
      return createDriver({ settings, paths: ctx.paths });
    },
  };
}

export async function run(ctx) {
  const sub = ctx.rest[0] || "list";
  const id = ctx.rest[1];
  const m = await import("../sites/manage.mjs");
  const say = (t) => ctx.print(t);
  const needId = () => { if (!id) { ctx.fail(`Say which site: godspeed-wingman site ${sub} <id>`); return false; } return true; };

  if (sub === "list") {
    const rows = m.siteRows({ mcDir: ctx.mcDir, routine: ctx.routine, state: stateOf(ctx.paths) });
    say("The sites the Wingman knows:");
    for (const r of rows) {
      const terms = r.verdict ? `terms ${r.verdict}, read ${r.checkedOn}` : "terms NOT CHECKED yet";
      const state = r.on ? `ON, ${r.mode}` : "off";
      say(`  ${r.id.padEnd(16)} ${String(r.name).padEnd(18)} ${(r.kind === "android" ? "Android app" : "website").padEnd(12)} ${(r.builtin ? "built in" : "your own").padEnd(9)} ${terms.padEnd(34)} ${state}`);
      if (r.shadowed) say("      not used: a built-in site has this id");
      else if (r.blocked) say(`      ${r.blocked}`);
      else if (r.chosen) say(`      ${r.chosen}`);
      if (r.untrusted) say(`      ${r.untrusted}`);
      if (r.reminder) say(`      ${r.reminder}`);
    }
    return 0;
  }

  if (sub === "new") {
    if (!needId()) return 1;
    try {
      const r = m.newSite({ mcDir: ctx.mcDir, id, kind: ctx.flags.kind || "browser", name: ctx.flags.name, home: ctx.flags.home, pkg: ctx.flags.package });
      say(`Made ${r.meta.name} from the ${r.meta.kind} template: ${r.dir}`);
      say("It cannot be switched on yet: first read its terms and record what they say:");
      say(`  godspeed-wingman site terms ${id} --verdict allowed|silent|forbidden --url https://... --quote "..." --note "..."`);
      say(`Then build adapter.mjs (its README.md says how), and check it: godspeed-wingman site check ${id}`);
      await sync(ctx, `wingman: a new site, ${id}`);
      return 0;
    } catch (e) { ctx.fail(e.message); return 1; }
  }

  if (sub === "terms") {
    if (!needId()) return 1;
    const spec = flagSpec(ctx.commands);
    try {
      const day = wallClock(new Date(), ctx.settings.timezone).day;
      const r = m.recordTerms({ mcDir: ctx.mcDir, id, verdict: ctx.flags.verdict, urls: every(ctx.argv, "url", spec), quotes: every(ctx.argv, "quote", spec), note: ctx.flags.note || "", day });
      say(`Recorded for ${r.name}: the terms are ${r.meta.terms.verdict} (read ${day}).`);
      if (r.meta.terms.verdict === "forbidden") {
        // Information for the person, never a decision for them: a site that is on is not switched
        // off behind their back, and it is not used there again before they answer.
        const on = m.enabledSites(ctx.routine.settings).includes(id);
        const chosen = m.riskChoice(ctx.routine.settings, id);
        if (on && chosen) say(`You chose on ${chosen} to use ${r.name} although its terms forbid automated use, so it stays on. To stop: godspeed-wingman site off ${id}`);
        else if (on) say(`${r.name} is switched on, and its terms now forbid automated use, so the Wingman pauses there until you decide. Keep it on anyway: godspeed-wingman site use ${id} --accept-terms-risk. Switch it off: godspeed-wingman site off ${id}`);
        else say(`The site may suspend or close an account that uses a helper like the Wingman. If you want it anyway, that is your choice: build it as usual (godspeed-wingman site check ${id}), then switch it on with godspeed-wingman site use ${id} --accept-terms-risk`);
      } else {
        // Terms that no longer forbid it need no choice; a later reading that forbids it asks again.
        m.forgetRiskChoice(ctx.routine.settings, id);
        if (r.meta.terms.verdict === "silent" && !r.meta.terms.quotes.length) say("  NOTE no sentence was quoted; quoting the closest one (on misuse, or automated access) helps the next person who reads them.");
        say(`Next: godspeed-wingman site check ${id}`);
      }
      await sync(ctx, `wingman: the terms of ${id} recorded`);
      return 0;
    } catch (e) { ctx.fail(e.message); return 1; }
  }

  if (sub === "use") {
    if (!needId()) return 1;
    try {
      const day = wallClock(new Date(), ctx.settings.timezone).day;
      const r = m.useSite({ mcDir: ctx.mcDir, routine: ctx.routine, id, acceptRisk: !!ctx.flags["accept-terms-risk"], day });
      const { siteState } = await import("../core/state.mjs");
      const mode = siteState(stateOf(ctx.paths), id).mode;
      const pu = ctx.settings.practice_until;
      const choice = r.chosenOn ? `, by your choice (recorded ${r.chosenOn}), although its terms forbid automated use` : "";
      if (!r.changed) {
        say(r.chosenOn ? `${r.site.name} stays on${choice}.` : `${r.site.name} is already switched on.`);
        if (r.chosenOn) await sync(ctx, `wingman: ${id} kept on by the owner's choice`);
      } else {
        const { listSites } = await import("../sites/index.mjs");
        const names = Object.fromEntries(listSites({ mcDir: ctx.mcDir }).map((s) => [s.id, s.name]));
        const before = r.sites.filter((s) => s !== id).map((s) => names[s] || s);
        say(`${r.site.name} is switched on${choice}. The Wingman works there in the daily session${before.length ? `, after ${before.join(", ")}` : ""}.`);
        say(mode === "auto"
          ? `It is on autopilot there, as it was before.`
          : `It starts in practice, whatever the other sites do: every like or pass there waits for your answer until you agree with ${pu.agree} of its last ${pu.of}. Your first practice round is how it learns this site: say "practice" (godspeed-wingman train --site ${id}).`);
        if (r.site.kind === "android") say("It needs the Android emulator running with the app logged in: godspeed-wingman android status");
        await sync(ctx, `wingman: ${id} switched on`);
      }
      return 0;
    } catch (e) { ctx.fail(e.message); return 1; }
  }

  if (sub === "off") {
    if (!needId()) return 1;
    const r = m.offSite({ mcDir: ctx.mcDir, routine: ctx.routine, id });
    const name = r.site?.name || id;
    if (!r.changed) {
      say(`${name} was not switched on.`);
      if (r.forgot) await sync(ctx, `wingman: the owner's choice for ${id} taken back`);
      return 0;
    }
    say(`${name} is switched off. Its folder, and everything the Wingman learned there, stay.${r.forgot ? " Your choice to use it although its terms forbid automated use is taken back; switching it on again asks again." : ""}`);
    if (!r.sites.length) say("No site is switched on now; the Wingman does nothing until you switch one on.");
    await sync(ctx, `wingman: ${id} switched off`);
    return 0;
  }

  if (sub === "check") {
    if (!needId()) return 1;
    const { checkSite } = await import("../sites/check.mjs");
    const hb = heartbeat(ctx.paths);
    if (!ctx.flags.offline && hb?.run && hb.site === id && workerAlive(ctx.paths)) {
      ctx.fail(`The daily session is working on ${id} right now; check it after the session, or pause first (godspeed-wingman pause).`);
      return 1;
    }
    const r = await checkSite({ id, mcDir: ctx.mcDir, settings: ctx.settings, paths: ctx.paths, offline: !!ctx.flags.offline, show: !!ctx.flags.show, profileId: ctx.flags.profile || null, out: printer(ctx), deps: liveDeps(ctx) });
    return r.failed ? 1 : 0;
  }

  if (sub === "login") {
    if (!needId()) return 1;
    const { siteLogin } = await import("../sites/check.mjs");
    return siteLogin({ id, mcDir: ctx.mcDir, settings: ctx.settings, out: printer(ctx), deps: liveDeps(ctx) });
  }

  if (sub === "network") {
    if (!needId()) return 1;
    const { siteNetwork } = await import("../sites/check.mjs");
    return siteNetwork({ id, mcDir: ctx.mcDir, settings: ctx.settings, url: ctx.flags.url, seconds: ctx.flags.seconds, out: printer(ctx), deps: liveDeps(ctx) });
  }

  ctx.fail(`Say: godspeed-wingman ${USAGE}`);
  return 1;
}

