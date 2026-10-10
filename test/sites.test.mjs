// The site registry and the adapter contract (lib/sites/contract.md): every built-in site keeps
// it, a site whose terms forbid the Wingman (or were never read) is refused in plain words, the
// person's own sites are found in their mission control, and old terms are a reminder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listSites, loadSite, validateSite, termsReminder, adapterGaps, REQUIRED, BUILTIN_DIR } from "../lib/sites/index.mjs";
import { SiteError, isLoggedOut } from "../lib/sites/errors.mjs";
import { FlirtualError } from "../lib/sites/flirtual/api.mjs";
import { tempMc, makeWorker, user } from "./helpers.mjs";

const GOOD = {
  id: "kindmeet", name: "Kind Meet", kind: "browser", home: "https://kindmeet.example", login_url: "https://kindmeet.example/login",
  profile_url: "https://kindmeet.example/u/{id}", about: "Kind Meet, a dating site for testing",
  terms: { checked_on: "2026-10-01", urls: ["https://kindmeet.example/terms"], verdict: "allowed", quotes: ["Helpers that act for a member are welcome."], note: "Allowed." },
  can: ["queue", "like", "pass"],
};
const ADAPTER = `export default function create() {
  return { session: async () => ({ loggedIn: true, me: { id: "me", name: "me" } }), queue: async () => ({ next: [], limits: null, done: true }), profile: async (id) => ({ id, name: "x" }), like: async () => ({ match: false, limitReached: false }), pass: async () => ({ match: false, limitReached: false }) };
}
`;

function ownSite(mc, id, meta, adapter = ADAPTER) {
  const dir = path.join(mc, "routines", "wingman", "sites", id);
  fs.mkdirSync(dir, { recursive: true });
  if (meta !== null) fs.writeFileSync(path.join(dir, "site.json"), JSON.stringify(meta, null, 2));
  if (adapter !== null) fs.writeFileSync(path.join(dir, "adapter.mjs"), adapter);
  return dir;
}

test("every built-in site keeps the contract: a valid site.json, terms read, an adapter with every method it promises", async () => {
  const builtins = listSites().filter((s) => s.builtin);
  assert.ok(builtins.length >= 1);
  assert.ok(builtins.some((s) => s.id === "flirtual"));
  for (const s of builtins) {
    assert.deepEqual(s.problems, [], `${s.id}: ${s.problems.join("; ")}`);
    assert.equal(s.refused, null, s.id);
    assert.ok(["allowed", "silent"].includes(s.meta.terms.verdict), s.id);
    assert.ok(s.meta.terms.quotes?.length, `${s.id} keeps the sentences its verdict rests on`);
    assert.ok(s.meta.about, `${s.id} says in half a sentence what it is`);
    const site = await loadSite(s.id);
    const driver = new Proxy({}, { get: () => async () => null });
    const adapter = site.create({ driver, settings: {}, log: () => {}, wait: async () => {} });
    assert.deepEqual(adapterGaps(adapter, site.meta), [], `${s.id} lacks methods`);
    for (const m of REQUIRED) assert.equal(typeof adapter[m], "function", `${s.id}.${m}`);
  }
  assert.ok(fs.existsSync(path.join(BUILTIN_DIR, "contract.md")));
});

test("a site whose terms forbid bots, automation or AI is refused, in plain words, by the registry and the loader", async () => {
  const { mc } = tempMc();
  ownSite(mc, "nobots", { ...GOOD, id: "nobots", name: "No Bots Dating", terms: { ...GOOD.terms, verdict: "forbidden", checked_on: "2026-10-02" } });
  const s = listSites({ mcDir: mc }).find((x) => x.id === "nobots");
  assert.equal(s.ok, false);
  assert.equal(s.refused, "The terms of No Bots Dating forbid bots, automation or AI use (read on 2026-10-02), so the Wingman does not work there.");
  await assert.rejects(loadSite("nobots", { mcDir: mc }), (e) => e instanceof SiteError && e.refused && /forbid bots, automation or AI use/.test(e.message));
});

test("a site whose terms were never read is refused too", async () => {
  const { mc } = tempMc();
  const { terms, ...noTerms } = GOOD;
  ownSite(mc, "unread", { ...noTerms, id: "unread", name: "Unread" });
  ownSite(mc, "maybe", { ...GOOD, id: "maybe", name: "Maybe", terms: { ...terms, verdict: "probably fine" } });
  for (const id of ["unread", "maybe"]) {
    const s = listSites({ mcDir: mc }).find((x) => x.id === id);
    assert.match(s.refused, /Nobody has checked whether the terms of .* allow a helper like the Wingman/);
    await assert.rejects(loadSite(id, { mcDir: mc }), /Nobody has checked/);
  }
});

test("the person's own site is found and loaded; a broken one says what is wrong; a built-in id cannot be taken over", async () => {
  const { mc } = tempMc();
  ownSite(mc, "kindmeet", GOOD);
  const site = await loadSite("kindmeet", { mcDir: mc });
  assert.equal(site.builtin, false);
  assert.equal(site.meta.name, "Kind Meet");
  assert.equal(typeof site.create({}).queue, "function");
  ownSite(mc, "broken", { ...GOOD, id: "other-name", home: "http://broken.example" });
  const b = listSites({ mcDir: mc }).find((x) => x.id === "broken");
  assert.ok(b.problems.some((p) => /must match its folder name/.test(p)), b.problems.join("; "));
  assert.ok(b.problems.some((p) => /home must be an https address/.test(p)));
  ownSite(mc, "noadapter", { ...GOOD, id: "noadapter" }, null);
  assert.ok(listSites({ mcDir: mc }).find((x) => x.id === "noadapter").problems.includes("adapter.mjs is missing"));
  ownSite(mc, "flirtual", { ...GOOD, id: "flirtual" });
  const shadow = listSites({ mcDir: mc }).filter((x) => x.id === "flirtual");
  assert.deepEqual(shadow.map((x) => [x.builtin, x.shadowed]), [[true, false], [false, true]]);
  assert.equal((await loadSite("flirtual", { mcDir: mc })).builtin, true);
  await assert.rejects(loadSite("nowhere", { mcDir: mc }), /knows no site called "nowhere"/);
});

test("terms read more than 180 days ago are a reminder, never a refusal", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  assert.equal(termsReminder({ ...GOOD, terms: { ...GOOD.terms, checked_on: "2026-06-01" } }, now), null);
  assert.match(termsReminder({ ...GOOD, terms: { ...GOOD.terms, checked_on: "2026-01-01" } }, now), /The terms of Kind Meet were last read 282 days ago \(2026-01-01\)\. Read them again/);
  assert.deepEqual(validateSite({ ...GOOD, terms: { ...GOOD.terms, checked_on: "2026-01-01" } }, { dirName: "kindmeet" }), { problems: [], refused: null });
});

test("an adapter missing a method it promises is found out", () => {
  assert.deepEqual(adapterGaps({ session() {}, queue() {}, profile() {}, like() {}, pass() {} }, { can: ["queue", "like", "pass", "inbox", "send"] }), ["conversations", "send"]);
});

test("a lost login is a SiteError with loggedOut, also from Flirtual's own errors", () => {
  assert.equal(isLoggedOut(new SiteError("x", { loggedOut: true })), true);
  assert.equal(isLoggedOut(new FlirtualError(401, "invalid_credentials", {}, "/session")), true);
  assert.equal(isLoggedOut(new FlirtualError(400, "out_of_likes", {}, "/queue")), false);
  assert.ok(new FlirtualError(401, "", {}, "/x") instanceof SiteError);
});

test("the worker never touches a refused site and says why", async () => {
  const h = makeWorker([user("a1", "Mara")], { settings: { sites: ["nobots"] } });
  ownSite(h.mc, "nobots", { ...GOOD, id: "nobots", name: "No Bots Dating", terms: { ...GOOD.terms, verdict: "forbidden" } });
  let made = 0;
  h.w.deps.makeAdapter = () => { made++; return {}; };
  await h.w.tick();
  assert.equal(made, 0, "no adapter is ever made");
  assert.equal(h.w.state.run, null, "the session ended at once");
  assert.match(h.w.state.lastRun.why, /forbid bots, automation or AI use/);
  assert.match(h.w.state.lastError.text, /No Bots Dating forbid/);
  assert.equal(h.told.length, 0);
});
