// The setup questions in a terminal, for a machine without a screen (a server reached over SSH).
// The same questions as the desk's wizard, one at a time; Enter keeps the value in brackets. At the
// end it writes the person's files through apply() and, when Telegram is set up, asks the worker
// to send one welcome message there.
import readline from "node:readline";
import { routinePaths, statePaths } from "../core/paths.mjs";
import { loadSettings, LANE_MODEL } from "../core/settings.mjs";
import * as requests from "../core/requests.mjs";
import { questions, loadOptions, listStarters, startingAnswers, cleanAnswers, renderPreferences, apply, detect, readOwnPreferences, modelHelp } from "./index.mjs";

// A line reader that keeps lines typed (or piped) ahead of the question.
export function lineReader(input, output) {
  const rl = readline.createInterface({ input, terminal: false, crlfDelay: Infinity });
  const it = rl[Symbol.asyncIterator]();
  let ended = false;
  return {
    async ask(q, def = "") {
      output.write(`${q}${def !== "" ? ` [${def}]` : ""}: `);
      if (ended) { output.write("\n"); return def; }
      const { value, done } = await it.next();
      if (done) { ended = true; output.write("\n"); return def; }
      const v = String(value).trim();
      return v === "" ? def : v;
    },
    // True once the input has no more lines: nobody is there to answer a question again.
    get ended() { return ended; },
    close() { rl.close(); },
  };
}

// "1, 3" or "1 3" -> the chosen ids from a numbered list.
export function pickNumbers(text, list) {
  const out = [];
  for (const n of String(text || "").split(/[\s,;]+/).filter(Boolean)) {
    const i = Number(n) - 1;
    if (Number.isInteger(i) && list[i] && !out.includes(list[i])) out.push(list[i]);
  }
  return out;
}

const numbered = (items, label) => items.map((c, i) => `  ${i + 1}. ${label(c)}`).join("\n");
const numbersOf = (ids, list) => ids.map((id) => list.findIndex((c) => c.id === id) + 1).filter((n) => n > 0).join(",");
const yes = (s) => /^y(es)?$/i.test(String(s).trim());

export async function terminalWizard({ mcDir, stateDir, input = process.stdin, output = process.stdout, sys = {}, deps = {}, now = new Date() }) {
  const say = (s = "") => output.write(`${s}\n`);
  const r = lineReader(input, output);
  const env = sys.env || process.env;
  const platform = sys.platform || process.platform;
  const rp = routinePaths(mcDir);
  const set = loadSettings(rp.settings, { platform, env });
  const options = loadOptions();
  const starters = listStarters();
  const found = await (deps.detect || detect)({ mcDir, stateDir, settings: set, env, platform, home: sys.home });
  const a = startingAnswers(set, { options, starters });
  try {
    say("\nThe Wingman: the setup questions\n");
    say("I look through the profiles your dating site suggests, learn your taste from your answers, and bring");
    say("you the matches with three reply ideas. You still do the talking.");
    say("I never send a message you did not pick, never write to anyone outside the dating site, never post");
    say("anything about your dating, and never work on a site whose terms forbid bots unless you choose that.");
    say("Enter keeps the answer in brackets.\n");

    const usable = found.sites.filter((s) => s.ok);
    if (!usable.length) { say("No site can be used right now. `godspeed-wingman check` says why."); return { done: false }; }
    say("Which sites? (numbers, separated by commas)");
    say(numbered(usable, (s) => `${s.name}${s.builtin ? "" : " (added by you)"}`));
    a.sites = pickNumbers(await r.ask("Sites", numbersOf(set.sites, usable) || "1"), usable.map((s) => s.id));
    if (!a.sites.length) a.sites = [usable[0].id];
    say("Another site? Tell your mission control \"Add <the site's name> to my Wingman\". It reads the site's terms first, tells you what they say about bots and the risk, and you decide.\n");

    // Only a page of the person's own is offered to keep; the installer's blank page is not one.
    let mode = "starter";
    if (readOwnPreferences(rp.preferences) !== null) {
      const k = await r.ask("You already have a preferences page. Keep it (k), or start from a starter (s)?", "k");
      mode = /^s/i.test(k) ? "starter" : "keep";
    }
    const q = questions({ sites: a.sites, options });
    if (mode === "starter") {
      say(`\n${q.me.question}\n  ${q.me.hint}`);
      a.me = await r.ask("You", q.me.examples?.[0] || "");
      say(`\n${q.looking_for.question} (numbers, separated by commas)`);
      say(numbered(q.looking_for.choices, (c) => c.label));
      a.looking_for = pickNumbers(await r.ask("Looking for", ""), q.looking_for.choices.map((c) => c.id));
      a.looking_for_text = await r.ask(`${q.looking_for.free_text}, optional`, "");
      const ages = (await r.ask(`\n${q.age_range.question}`, `${a.age_range[0]}-${a.age_range[1]}`)).split(/[^0-9]+/).filter(Boolean).map(Number);
      if (ages.length === 2) a.age_range = ages;
      say(`\n${q.where.question}`);
      say(numbered(q.where.choices, (c) => c.label));
      a.where = pickNumbers(await r.ask("Where", "1"), q.where.choices.map((c) => c.id))[0] || "";
      a.where_text = await r.ask(`${q.where.free_text}, optional`, "");

      say("\nPick a starting point, so you never face a blank page:");
      say(numbered(starters, (s) => `${s.title}: ${s.pitch}`));
      a.starter = pickNumbers(await r.ask("Starter", "1"), starters.map((s) => s.id))[0] || starters[0].id;

      say(`\n${q.green_flags.question} (numbers, separated by commas)`);
      say(numbered(q.green_flags.choices, (c) => c.label));
      a.green_flags = pickNumbers(await r.ask("Green flags", ""), q.green_flags.choices.map((c) => c.id));
      if (a.green_flags.includes("interests")) a.interests = await r.ask("Which interests", "");
      a.green_text = (await r.ask("Your own, separated by ; (optional)", "")).split(";");
      say(`\n${q.deal_breakers.question} (numbers, separated by commas)`);
      say(numbered(q.deal_breakers.choices, (c) => c.label));
      a.deal_breakers = pickNumbers(await r.ask("Deal-breakers", ""), q.deal_breakers.choices.map((c) => c.id));
      a.deal_text = (await r.ask("Your own, separated by ; (optional)", "")).split(";");

      say(`\n${q.tone.question}`);
      say(numbered(q.tone.choices, (c) => `${c.label}: ${c.line}`));
      a.tone = pickNumbers(await r.ask("Tone", "1"), q.tone.choices.map((c) => c.id))[0] || "";
      a.sample = await r.ask("A message you sent and liked, optional (I copy how it sounds)", "");
      a.language = await r.ask(q.language.question, a.language);
    }

    say("\nWhen should I look? Once a day, at a person's pace.");
    a.daily_start = await r.ask("Daily session at (HH:MM)", a.daily_start);
    a.timezone = await r.ask("Your time zone", a.timezone);
    a.retention_days = Number(await r.ask("How many days I remember the people I saw", String(a.retention_days)));
    // One opt-in, only when the notebook answers here. Off unless the person says yes.
    if (found.notebook?.found) {
      const nc = options.notebook_collection || {};
      if (nc.hint) say(`  ${nc.hint}`);
      a.notebook_collection = yes(await r.ask(`${nc.label || "Also keep a list of every like and pass in my Godspeed notebook (it stays until I delete it)"}? (y/n)`, a.notebook_collection ? "y" : "n"));
    }

    const channels = [
      { id: "telegram", label: "Telegram, through your assistant's bot", ok: found.telegram.found },
      { id: "desk", label: "The Wingman's desk page on this machine (http://127.0.0.1)", ok: true },
      { id: "desktop", label: "Notifications on this machine", ok: found.notifications.ok },
    ].filter((c) => c.ok);
    say("\nWhere should I talk to you? (numbers, separated by commas)");
    say(numbered(channels, (c) => c.label));
    const talkDefault = found.telegram.found ? "1" : numbersOf(set.talk.filter((t) => channels.some((c) => c.id === t)), channels) || "1";
    a.talk = pickNumbers(await r.ask("Talk through", talkDefault), channels.map((c) => c.id));
    if (!a.talk.length) a.talk = [channels[0].id];
    if (!found.telegram.found) say("  (Telegram is not set up for your assistant on this machine, so it is not offered.)");

    if (!found.desktop) {
      say("\nThis machine has no screen, so I use a browser on a computer that has one, through a Chrome Agent Bridge.");
      a.browser = "bridge";
      a.bridge = await r.ask("The bridge's address", set.bridge || "");
    } else a.browser = set.browser;

    let lanes = found.lanes;
    say("\nWho does the thinking? The model reads each profile next to your preferences and your answers.");
    // Neither Claude Code nor Codex here: how to get Codex, then Enter looks again, as often as the
    // person likes, so a program installed a minute ago is found without starting over.
    for (let help = modelHelp({ lanes, platform, terminal: true }); help; help = modelHelp({ lanes, platform, terminal: true })) {
      say(`\n${help.text}\n\n    ${help.line}\n`);
      const k = await r.ask("Press Enter to look again, or type n to go on without them", "");
      if (/^n/i.test(k) || r.ended) break;
      lanes = (await (deps.detect || detect)({ mcDir, stateDir, settings: set, env, platform, home: sys.home })).lanes;
      const got = lanes.filter((l) => l.found && l.lane !== "openai").map((l) => l.label);
      say(got.length ? `  Found: ${got.join(" and ")}.` : "  Not found yet.");
    }
    say(numbered(lanes, (l) => `${l.label}: ${l.found ? `found (${l.where})` : l.lane === "openai" ? l.where : "not found"}`));
    // The lane the settings name, unless it is missing here and Claude Code or Codex is not.
    const named = lanes.findIndex((l) => l.lane === set.model.lane);
    const firstFound = lanes.findIndex((l) => l.found && l.lane !== "openai");
    const laneDefault = String(Math.max(1, (named >= 0 && !lanes[named].found && firstFound >= 0 ? firstFound : named) + 1));
    const lane = lanes[Number(await r.ask("Model", laneDefault)) - 1] || lanes[0];
    const name = await r.ask("The model's name (Enter for its default)", lane.lane === set.model.lane ? set.model.name : LANE_MODEL[lane.lane]);
    a.model = { lane: lane.lane, name };
    if (yes(await r.ask("Test it now? This makes one small call. (y/n)", "n"))) {
      const ask = deps.ask || (await import("../core/model.mjs")).ask;
      try { say(`  It answered: ${String(await ask({ system: "You check that a connection works. Answer with one word only.", prompt: "Answer with the one word: ready" }, a.model, { timeoutMs: 120000 })).trim().slice(0, 60)}`); }
      catch (e) { say(`  No answer: ${e.message}`); }
    }

    a.watch = (await r.ask("\nNames to watch, separated by commas (optional; I stop and ask before liking or passing them)", "")).split(",");

    const clean = cleanAnswers(a, { options, knownSites: found.sites.map((s) => s.id) });
    const text = mode === "starter" ? renderPreferences(clean.starter, clean, { options, starters }) : null;
    if (text) {
      say("\nYour preferences page, as I will read it:\n");
      say(text.split("\n").map((l) => `  ${l}`).join("\n"));
      say("You can change any line later: the file is routines/wingman/preferences.md, or tell your mission control.");
    }
    if (!yes(await r.ask("\nSave all this? (y/n)", "y"))) { say("Nothing was saved."); return { done: false }; }
    const result = await (deps.apply || apply)({ mcDir, stateDir, answers: clean, mode, text, sys, now });
    say(`\nSaved. ${result.prefs === "replaced" ? `Your old preferences are kept at ${result.backup}.` : result.prefs === "kept" ? "Your own preferences stay as they were." : "Your preferences are written."}`);
    let welcome = false;
    if (clean.talk.includes("telegram") && found.telegram.found) {
      requests.submit(statePaths(stateDir), "welcome", {});
      welcome = true;
      say("Your Wingman sends you a welcome on Telegram. Answer \"practice\" there to start your first round.");
    } else {
      say("Start your first practice round any time: tell your mission control \"practice\", or run `godspeed-wingman train`.");
    }
    return { done: true, answers: clean, result, welcome };
  } finally {
    r.close();
  }
}

// After `setup`: the wizard, if the person has not been through it. On a desktop the desk opens at
// the wizard (served by the worker, or here when no worker answers); without a screen the terminal
// asks. Never blocks a run that nobody watches (no terminal attached).
export async function afterSetup(flags = {}, sys = {}, deps = {}) {
  const { plan } = await import("../setup/index.mjs");
  const p = plan(flags, sys);
  const set = loadSettings(p.routine.settings, { platform: p.platform, env: p.env });
  if (set.onboarded !== false && !flags.wizard) return 0;
  const interactive = deps.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY);
  if (p.desktop && !flags.terminal) {
    const { deskUrl, deskUp, openInBrowser } = await import("../desk/secret.mjs");
    const url = deskUrl(set, p.paths, "setup");
    const up = deps.deskUp || deskUp;
    if (p.service !== "none") for (let i = 0; i < 20 && !(await up(set.desk_port)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (await up(set.desk_port)) {
      (deps.open || openInBrowser)(url);
      console.log(`\nThe setup continues in your browser: ${url}`);
      return 0;
    }
    if (!interactive) { console.log("\nOpen the setup page with: godspeed-wingman desk --setup"); return 0; }
    const { startDesk } = await import("../desk/server.mjs");
    const d = await startDesk({ mcDir: p.mcDir, stateDir: p.stateDir, port: set.desk_port });
    (deps.open || openInBrowser)(url);
    console.log(`\nThe setup continues in your browser: ${url}\nKeep this window open until you are done, then close it or press Ctrl+C.`);
    await new Promise((resolve) => { for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) { try { process.on(sig, resolve); } catch { /* not here */ } } });
    await d.close();
    return 0;
  }
  if (!interactive) { console.log("\nAnswer the setup questions in a terminal: godspeed-wingman setup --wizard"); return 0; }
  await terminalWizard({ mcDir: p.mcDir, stateDir: p.stateDir, sys });
  return 0;
}
