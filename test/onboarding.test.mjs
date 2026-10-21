// The setup questions: the starters with every placeholder filled, choices that belong to one site
// left out on other sites, the settings the answers make, and the person's own preferences page
// never replaced unless they say so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { questions, loadOptions, listStarters, parseStarter, startingAnswers, cleanAnswers, renderPreferences, settingsFrom, apply, fills, notebookAnswers, modelHelp, CODEX_INSTALL, WELCOME } from "../lib/onboarding/index.mjs";
import { defaults, normalizeSettings } from "../lib/core/settings.mjs";
import { readWatch } from "../lib/core/watch.mjs";
import { tempMc, makeWorker, user, settingsFile } from "./helpers.mjs";
import { statePaths } from "../lib/core/paths.mjs";

const options = loadOptions();
const starters = listStarters();
const PLACEHOLDER = /\{[a-z_]+\}/;

const ANSWER_SETS = {
  "nothing answered": {},
  "a few chips": { me: "a woman in my twenties", looking_for: ["men", "nonbinary"], where: "near", green_flags: ["humour"], deal_breakers: ["smoking"], tone: "calm" },
  "everything": {
    me: "a nonbinary person in my forties", looking_for: ["women"], looking_for_text: "women and nonbinary people", age_range: [30, 50],
    where: "region", where_text: "Germany, Austria, Switzerland", green_flags: ["voice", "fbt", "vrchat", "humour", "playful", "kind", "active", "interests"], interests: "building worlds, horror films",
    green_text: ["someone who laughs at their own jokes", "- Plays the piano."], deal_breakers: ["drinking", "smoking", "mute", "jealous", "only_friends", "far", "drama", "thin", "pretend"],
    deal_text: ["Someone who only plays at 4 in the morning"], tone: "witty", sample: "Your bio made me laugh twice.\nWhich world should I visit first?", language: "English or German.",
  },
  "shared interests without saying which": { green_flags: ["interests"], where: "anywhere", looking_for: ["anyone", "women"] },
  "only own lines, no chips": { me: "a trans man in my twenties", green_text: ["kind to animals"], deal_text: ["rude to waiters"], where: "timezone" },
};

test("the four starters are there, each with the sections the judge reads and a title and pitch", () => {
  assert.deepEqual(starters.map((s) => s.id), ["looking-for-a-partner", "flirty-and-playful", "friends-first", "just-exploring"]);
  for (const s of starters) {
    assert.ok(s.title && s.pitch, s.id);
    for (const h of ["## Who fits", "## Who does not fit", "## How to judge", "## How I write", "## Added later"]) assert.ok(s.body.includes(h), `${s.id}: ${h}`);
    assert.doesNotMatch(s.body, /^---/m, "the front matter is not part of the page");
  }
  assert.deepEqual(parseStarter("---\nid: x\ntitle: X\npitch: p\n---\n# Body\n"), { id: "x", title: "X", pitch: "p", covers: [], body: "# Body\n" });
});

test("every starter renders with no {placeholder} left, for every answer set", () => {
  for (const s of starters) {
    for (const [name, raw] of Object.entries(ANSWER_SETS)) {
      const a = cleanAnswers({ sites: ["flirtual"], ...raw }, { options });
      const text = renderPreferences(s.id, a, { options, starters });
      assert.doesNotMatch(text, PLACEHOLDER, `${s.id} / ${name}`);
      assert.doesNotMatch(text, /\n{3,}/, `${s.id} / ${name}: no gaps`);
      assert.doesNotMatch(text, /^ (?! )/m, `${s.id} / ${name}: no stray space`);
      assert.match(text, /^# What I am looking for/m);
      assert.match(text, /## Added later\n\n\(New lines land here/, "the Added later section stays");
      assert.ok(!text.includes("—"), "no em dash");
    }
  }
});

test("the answers become plain lines in the page", () => {
  const a = cleanAnswers({ sites: ["flirtual"], ...ANSWER_SETS.everything }, { options });
  const text = renderPreferences("looking-for-a-partner", a, { options, starters });
  assert.match(text, /- I am a nonbinary person in my forties, and I am looking for women and nonbinary people, aged 30 to 50\./, "more specific words win over the chips");
  assert.match(text, /^- They live in Germany, Austria, Switzerland\.$/m, "named places win");
  // Anywhere means distance matters less, so the line gives no reason about evenings online.
  assert.match(renderPreferences("looking-for-a-partner", cleanAnswers({ sites: ["flirtual"], where: "anywhere" }, { options }), { options, starters }), /^- They live anywhere; distance matters less than fit\.$/m);
  assert.match(text, /- Someone who shares at least one of my interests: building worlds, horror films\./);
  assert.match(text, /- Someone who laughs at their own jokes\.|- someone who laughs at their own jokes\./);
  assert.match(text, /- Plays the piano\./, "an own line keeps its words, written as one list line");
  assert.match(text, /- Someone who only plays at 4 in the morning\./);
  assert.match(text, /- A smoker\./);
  assert.match(text, /^Witty, with dry humour\..* English or German\.$/m, "tone and language on one line");
  assert.match(text, /A message I sent and liked, so you know how I sound: "Your bio made me laugh twice\. Which world should I visit first\?"/);
  const loose = cleanAnswers({ sites: ["flirtual"], ...ANSWER_SETS["shared interests without saying which"] }, { options });
  const t2 = renderPreferences("flirty-and-playful", loose, { options, starters });
  assert.match(t2, /- Someone who shares at least one of my interests\./, "no empty 'interests:'");
  assert.match(t2, /They live anywhere; distance matters less than fit\./, "never 'live in anywhere'");
  assert.match(t2, /looking for anyone who fits, whatever their gender/, "anyone wins over a narrower chip");
  const none = renderPreferences("just-exploring", cleanAnswers({}, { options }), { options, starters });
  assert.match(none, /## Who does not fit\n\n\(Nothing here yet\.\)\n\n## How to judge/, "an empty section says so");
  assert.match(none, /I am someone, and I am looking for anyone who fits/);
  assert.match(none, /^English, unless they write in another language I speak\.$/m, "no tone chosen: the language line alone");
});

test("choices that belong to one site are hidden when that site is not chosen", () => {
  const ids = (q, k) => q[k].choices.map((c) => c.id);
  const on = questions({ sites: ["flirtual"], options });
  const off = questions({ sites: ["kind-meet"], options });
  for (const id of ["voice", "fbt", "vrchat"]) { assert.ok(ids(on, "green_flags").includes(id)); assert.ok(!ids(off, "green_flags").includes(id), id); }
  assert.ok(ids(on, "deal_breakers").includes("mute"));
  assert.ok(!ids(off, "deal_breakers").includes("mute"));
  assert.ok(ids(off, "green_flags").includes("humour"), "the rest stays");
  assert.equal(on._about, undefined, "no notes for the file's editor");
  assert.equal(on.practice_examples._about, undefined);
  const a = cleanAnswers({ sites: ["kind-meet"], green_flags: ["vrchat", "humour"], deal_breakers: ["mute", "smoking"] }, { options });
  assert.deepEqual(a.green_flags, ["humour"], "a hidden choice cannot be smuggled in");
  assert.deepEqual(a.deal_breakers, ["smoking"]);
  const text = renderPreferences("friends-first", a, { options, starters });
  assert.doesNotMatch(text, /VRChat|mute player/);
});

test("the answers are checked: unknown ids, odd numbers, long words", () => {
  const a = cleanAnswers({ sites: ["flirtual", "../x", "Bad Id"], looking_for: ["women", "robots"], age_range: [60, 25], where: "mars", tone: ["calm", "witty"], daily_start: "7:05", timezone: "Nowhere/City", retention_days: -3, talk: ["telegram", "pigeon"], browser: "bridge", bridge: "http://10.0.0.5:3010/", model: { lane: "hermes", name: "x;rm" }, me: "x".repeat(500), watch: "Robin\n- Lena\n\n" }, { options });
  assert.deepEqual(a.sites, ["flirtual"]);
  assert.deepEqual(a.looking_for, ["women"]);
  assert.deepEqual(a.age_range, [25, 60]);
  assert.equal(a.where, "");
  assert.equal(a.tone, "calm");
  assert.equal(a.daily_start, "07:05");
  assert.equal(a.timezone, startingAnswers().timezone);
  assert.equal(a.retention_days, 42);
  assert.deepEqual(a.talk, ["telegram"]);
  assert.equal(a.bridge, "http://10.0.0.5:3010");
  assert.deepEqual(a.model, { lane: "godspeed", name: "" });
  assert.equal(a.me.length, 120);
  assert.deepEqual(a.watch, ["Robin", "Lena"]);
  assert.equal(fills(a, { options }).age_range, "25 to 60");
});

test("the settings the answers make, as the worker reads them", () => {
  const a = cleanAnswers({ sites: ["flirtual"], daily_start: "20:15", timezone: "Europe/Vienna", talk: ["telegram", "desk"], browser: "bridge", bridge: "http://10.0.0.5:3010", model: { lane: "codex", name: "" }, retention_days: 30 }, { options });
  const s = settingsFrom(a, { telegramEnv: "/home/sam/.hermes/.env", now: new Date("2026-10-10T12:00:00Z") });
  assert.deepEqual(s, { sites: ["flirtual"], daily_start: "20:15", timezone: "Europe/Vienna", talk: ["telegram", "desk"], browser: "bridge", model: { lane: "codex", name: "" }, retention_days: 30, onboarded: "2026-10-10", bridge: "http://10.0.0.5:3010", telegram_env: "/home/sam/.hermes/.env" });
  const n = normalizeSettings(s, defaults({ platform: "linux", env: {} }));
  assert.deepEqual([n.daily_start, n.timezone, n.talk, n.browser, n.bridge, n.model, n.retention_days, n.onboarded, n.telegram_env], ["20:15", "Europe/Vienna", ["telegram", "desk"], "bridge", "http://10.0.0.5:3010", { lane: "codex", name: "" }, 30, "2026-10-10", "/home/sam/.hermes/.env"]);
  assert.equal(normalizeSettings({ onboarded: false }).onboarded, false, "a new install waits for the questions");
  assert.equal(normalizeSettings({}).onboarded, true, "a file without it counts as done");
  assert.equal(normalizeSettings({ onboarded: "soon" }).onboarded, true);
});

test("the notebook list is one opt-in: unticked unless the settings say yes, written only as a yes or a no", () => {
  const q = questions({ sites: ["flirtual"], options });
  assert.equal(q.notebook_collection.label, "Also keep a list of every like and pass in my Godspeed notebook (it stays until I delete it)");
  assert.match(q.notebook_collection.hint, /not deleted after the days you chose/);
  assert.equal(startingAnswers(defaults()).notebook_collection, false, "unticked on a new install");
  assert.equal(startingAnswers({ ...defaults(), notebook_collection: true }).notebook_collection, true, "a yes already given stays ticked");
  const now = new Date("2026-10-10T12:00:00Z");
  assert.equal(settingsFrom(cleanAnswers({ notebook_collection: true }, { options }), { now }).notebook_collection, true);
  assert.equal(settingsFrom(cleanAnswers({ notebook_collection: false }, { options }), { now }).notebook_collection, false);
  for (const v of [undefined, "true", 1, null]) assert.ok(!("notebook_collection" in settingsFrom(cleanAnswers({ notebook_collection: v }, { options }), { now })), `${v}: not an answer, the setting stays as it is`);
});

test("apply writes the notebook choice; a run without the choice leaves it as it was", async () => {
  const { mc, state } = tempMc();
  const read = () => JSON.parse(fs.readFileSync(settingsFile(mc), "utf8"));
  const answers = { sites: ["flirtual"], talk: ["desk"] };
  const sys = { env: {}, platform: "win32", root: false };
  await apply({ mcDir: mc, stateDir: state, answers: { ...answers, notebook_collection: true }, sys });
  assert.equal(read().notebook_collection, true);
  await apply({ mcDir: mc, stateDir: state, answers, sys });
  assert.equal(read().notebook_collection, true, "not asked: left alone");
  await apply({ mcDir: mc, stateDir: state, answers: { ...answers, notebook_collection: false }, sys });
  assert.equal(read().notebook_collection, false);
});

test("whether the notebook answers: at the address in the worker's private file, with a short wait, never an error", async () => {
  const seen = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200 ? { data: [] } : { error: "no" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { state } = tempMc();
  try {
    fs.writeFileSync(statePaths(state).workerEnv, `GODSPEED_WINGMAN_NOTEBOOK=${base}\n`);
    assert.equal(await notebookAnswers({ env: {}, stateDir: state }), true);
    assert.deepEqual(seen[0], { method: "POST", url: "/api/query", body: { table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-wingman"]] } }, "one read, nothing written");
    assert.equal(await notebookAnswers({ env: { GODSPEED_WINGMAN_NOTEBOOK: base } }), true, "the environment's address");
    status = 500;
    assert.equal(await notebookAnswers({ env: { GODSPEED_WINGMAN_NOTEBOOK: base } }), false, "an error is not an answer");
  } finally { await new Promise((r) => server.close(r)); }
  assert.equal(await notebookAnswers({ env: { GODSPEED_WINGMAN_NOTEBOOK: base } }), false, "nobody there");
  assert.equal(await notebookAnswers({ notebook: { answers: async () => true } }), true);
  assert.equal(await notebookAnswers({ notebook: { answers: async () => { throw new Error("x"); } } }), false);
});

test("apply: a new install gets the starter page; an existing page is never replaced without the person saying so", async () => {
  const { mc, state } = tempMc();
  const rp = (f) => path.join(mc, "routines", "wingman", f);
  fs.rmSync(rp("preferences.md"));
  const answers = { sites: ["flirtual"], me: "a person in my thirties", starter: "friends-first", watch: ["Robin", "Lena"], talk: ["desk"] };
  let r = await apply({ mcDir: mc, stateDir: state, answers, sys: { env: {}, platform: "win32", root: false } });
  assert.equal(r.prefs, "written");
  const first = fs.readFileSync(rp("preferences.md"), "utf8");
  assert.match(first, /I am a person in my thirties/);
  assert.match(first, /long conversations, shared worlds/, "the friends-first starter");
  assert.deepEqual(readWatch(rp("watch.md")), ["Robin", "Lena"]);
  const set = JSON.parse(fs.readFileSync(settingsFile(mc), "utf8"));
  assert.match(set.onboarded, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(set.sync, "off", "keys the wizard does not ask about stay");

  // The person's own words since then.
  fs.writeFileSync(rp("preferences.md"), "# Mine\n\nOnly my words.\n");
  for (const how of [{}, { mode: "keep" }, { mode: "keep", text: "# Mine\n\nOnly my words.\n" }, { mode: "nonsense" }]) {
    r = await apply({ mcDir: mc, stateDir: state, answers: { ...answers, starter: "flirty-and-playful" }, ...how, sys: { env: {}, platform: "win32", root: false } });
    assert.equal(r.prefs, "kept", JSON.stringify(how));
    assert.equal(fs.readFileSync(rp("preferences.md"), "utf8"), "# Mine\n\nOnly my words.\n", JSON.stringify(how));
    assert.equal(r.backup, null);
  }
  r = await apply({ mcDir: mc, stateDir: state, answers, mode: "keep", text: "# Mine\n\nOnly my words, and one more.\n", sys: { env: {}, platform: "win32", root: false } });
  assert.equal(r.prefs, "replaced", "the person edited it in the last look: that is saying so");
  assert.equal(fs.readFileSync(r.backup, "utf8"), "# Mine\n\nOnly my words.\n");
  r = await apply({ mcDir: mc, stateDir: state, answers, mode: "starter", sys: { env: {}, platform: "win32", root: false } });
  assert.equal(r.prefs, "replaced");
  assert.match(fs.readFileSync(rp("preferences.md"), "utf8"), /## Who fits/);
  assert.ok(path.resolve(r.backup).startsWith(path.resolve(state)), "the old page waits in the private folder, never in git");
  assert.deepEqual(readWatch(rp("watch.md")), ["Robin", "Lena"], "names are added once");
});

test("no daily session before the setup questions; a practice round asked for still runs", async () => {
  const h = makeWorker([user("a1", "Mara")], { settings: { onboarded: false } });
  await h.w.tick();
  assert.equal(h.w.state.run, null, "18:31, but the person has not been through the questions");
  const s = JSON.parse(fs.readFileSync(settingsFile(h.mc), "utf8"));
  fs.writeFileSync(settingsFile(h.mc), JSON.stringify({ ...s, onboarded: "2026-10-03" }));
  await h.w.tick();
  assert.ok(h.w.state.run, "once done, the daily session starts");
});

test("the welcome is sent once, retried until a channel takes it, never twice", async () => {
  let up = false;
  const h = makeWorker([], { telegramUp: () => up });
  const { submit } = await import("../lib/core/requests.mjs");
  submit(h.w.paths, "welcome", {});
  await h.w.tick();
  assert.equal(h.told.length, 0, "no channel took it");
  assert.ok(h.w.state.welcome.triedAt && !h.w.state.welcome.sentAt);
  up = true;
  h.advance(60000);
  await h.w.tick();
  assert.equal(h.told.length, 0, "not again within five minutes");
  h.advance(5 * 60000);
  await h.w.tick();
  assert.equal(h.told.length, 1);
  assert.equal(h.told[0].text, WELCOME);
  assert.match(WELCOME, /^From your Wingman: .*Say "practice" to start your first round/s);
  assert.match(WELCOME, /"agree"\n"disagree, they only want friends"/, "two example answers");
  submit(h.w.paths, "welcome", {});
  h.advance(10 * 60000);
  await h.w.tick();
  await h.w.tick();
  assert.equal(h.told.length, 1, "sent once, ever");
  const done = fs.readdirSync(h.w.paths.requestsDone).map((f) => JSON.parse(fs.readFileSync(path.join(h.w.paths.requestsDone, f), "utf8")));
  assert.match(done.at(-1).result.text, /sent already/);
});

test("looking for anyone: the partner starter never says 'not looking for anyone who fits'", () => {
  for (const looking_for of [["anyone"], ["women"], ["men", "nonbinary"], []]) {
    const text = renderPreferences("looking-for-a-partner", cleanAnswers({ sites: ["flirtual"], looking_for }, { options }), { options, starters });
    assert.match(text, /^- Someone who says they only want friends, or who is clearly not looking for someone like me\. They\n  sometimes show up anyway because they did not filter\.$/m, looking_for.join());
    assert.doesNotMatch(text, /not looking for (anyone|women|men|nonbinary)/, looking_for.join());
  }
});

test("a deal-breaker the starter already says is not added a second time", () => {
  const a = cleanAnswers({ sites: ["flirtual"], deal_breakers: ["smoking", "only_friends"] }, { options });
  const partner = renderPreferences("looking-for-a-partner", a, { options, starters });
  assert.doesNotMatch(partner, /Someone who writes that they only want friends/);
  assert.match(partner, /## Who does not fit\n\n- A smoker\.\n- Someone who says they only want friends, or/, "the other ticks still land");
  const flirty = renderPreferences("flirty-and-playful", a, { options, starters });
  assert.doesNotMatch(flirty, /Someone who writes that they only want friends/);
  assert.match(flirty, /- Someone who is clearly only looking for friends\./);
  for (const id of ["friends-first", "just-exploring"]) {
    assert.match(renderPreferences(id, a, { options, starters }), /- A smoker\.\n- Someone who writes that they only want friends\./, `${id} does not say it, so the tick adds it`);
  }
  assert.deepEqual(starters.find((s) => s.id === "looking-for-a-partner").covers, ["only_friends"]);
  assert.deepEqual(starters.find((s) => s.id === "friends-first").covers, []);
  const known = new Set(options.deal_breakers.choices.map((c) => c.id));
  for (const s of starters) for (const id of s.covers) assert.ok(known.has(id), `${s.id} covers a deal-breaker that exists: ${id}`);
  assert.deepEqual(parseStarter("---\nid: x\ncovers: a, b\n---\nbody").covers, ["a", "b"]);
});

test("model setup uses the host connection and asks for no new provider login", () => {
  const missing = modelHelp({ lanes: [{ lane: "godspeed", found: false }] });
  assert.match(missing.text, /Update Godspeed/);
  assert.equal(missing.line, "");
  assert.equal(modelHelp({ lanes: [{ lane: "godspeed", found: true }] }), null);
});
