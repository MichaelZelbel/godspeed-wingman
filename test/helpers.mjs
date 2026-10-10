// A pretend Flirtual API, a pretend model and a pretend channel, so the whole worker runs in a test
// without a browser, a login or a network. The Flirtual adapter itself is the real one; only the
// API calls it makes inside the browser are played here.
//
// Everyone here is invented: names, ids, Discord names. Flirtual shows a Discord field only after
// a match, so a test user has none unless the test gives one (user(id, name, { discord: "x" })).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FlirtualError } from "../lib/sites/flirtual/api.mjs";
import createFlirtual from "../lib/sites/flirtual/adapter.mjs";
import { Worker } from "../lib/core/worker.mjs";

// Attribute ids from Flirtual's public word list (lib/sites/flirtual/names.json).
export const IDS = {
  woman: "tpkW7r8PZ2RUuYGUSYi82N", cisWoman: "2ETbJJJ3shADLphvncUwSL", transWoman: "HWte4cB6TUzzXZoJeuxJuf",
  sheHer: "mosDhQUt8JGumiup4yQWbZ", heHim: "hv43aTXJZjMHfXRXvTcYiH", straight: "t5hhQahW7HQVKnhQX7xRqn", lesbian: "gkKfqSoBJ7dUHtaKJ5Cfmk",
  vrchat: "3nzcXDoMySRrPn6jHC8n3o", fbt: "MLWTjDZEuacyr2qwbXEw4K", quest: "RNaigbGdB7H4ZMw5c8ysbi",
};

export function user(id, name, extra = {}) {
  return {
    id, slug: name.toLowerCase().replace(/\s+/g, ""), born_at: "2000-05-01",
    profile: {
      display_name: name, biography: `<p>Hi, I am ${name}.</p>`, relationships: ["serious", "vr"], domsub: "submissive",
      attributes: { gender: [IDS.cisWoman, IDS.sheHer], sexuality: [IDS.straight], game: [IDS.vrchat], platform: [IDS.quest, IDS.fbt] },
      languages: ["en"], custom_interests: [], prompts: [], images: [], vrchat_name: `${name.replace(/\s+/g, "")}VR`,
      ...extra,
    },
  };
}

export class FakeFlirtual {
  constructor(users = []) {
    this.users = new Map(users.map((u) => [u.id, u]));
    this.queueIds = users.map((u) => u.id);
    this.responses = [];
    this.sent = [];
    this.convs = [];
    this.likesYou = [];
    this.likesLeft = Infinity;
    this.loggedIn = true;
    this.me = "me123";
  }
  check() { if (!this.loggedIn) throw new FlirtualError(401, "invalid_credentials", {}, "/x"); }
  async session() { return this.loggedIn ? { user: { id: this.me, slug: "you_test" } } : null; }
  async queue() { this.check(); return { previous: null, next: this.queueIds.slice(0, 2), pending: false, limits: null }; }
  async user(id) { this.check(); const u = this.users.get(id); if (!u) throw new FlirtualError(404, "user_not_found", {}, "/users"); return structuredClone(u); }
  async respond(type, userId) {
    this.check();
    if (type === "like") { if (this.likesLeft <= 0) throw new FlirtualError(400, "out_of_likes", { reset_at: "x" }, "/queue"); this.likesLeft--; }
    this.responses.push({ type, userId });
    this.queueIds = this.queueIds.filter((x) => x !== userId);
    return { match: false, matchKind: null, queue: null };
  }
  async likes() { this.check(); return { data: this.likesYou.map((id) => ({ profile_id: id, target_id: this.me, type: "like", kind: "love" })) }; }
  async conversations() { this.check(); return { data: this.convs, metadata: {} }; }
  async sendMessage(conversationId, text) { this.check(); this.sent.push({ conversationId, text }); return { ok: true }; }
  async skip(userId) { this.check(); this.skipped = [...(this.skipped || []), userId]; this.queueIds = this.queueIds.filter((x) => x !== userId); return { success: true }; }
}

// The judge passes anyone whose bio mentions beer; the reply writer returns three numbered lines.
// `discordOf(profileText)` plays the model's reading of a Discord name: { discord, discord_note }.
export function fakeAsk(calls = [], { discordOf = () => ({}) } = {}) {
  return async ({ system, prompt }) => {
    calls.push({ system, prompt });
    if (system.includes("Write three different messages")) return JSON.stringify({ options: ["one — hi", "two", "three"] });
    if (system.includes("find the Discord username")) return JSON.stringify({ discord: null, discord_note: null, ...discordOf(prompt) });
    const profile = prompt.split("THE PROFILE TO JUDGE")[1] || "";
    const pass = /beer/i.test(profile);
    return `Sure.\n${JSON.stringify({ weighing: "x", verdict: pass ? "pass" : "like", sure: "medium", reason: pass ? "They drink a lot — not your thing." : "VRChat with full-body tracking.", ...discordOf(profile) })}`;
  };
}

// A pretend notebook that answers the way the real one does: ids and versions (hashes) on every
// record, an update with an old version refused (409), the whole data object replaced on update.
export class FakeNotebook {
  constructor() { this.collections = new Map(); this.itemsById = new Map(); this.seq = 0; this.calls = []; this.down = false; }
  stamp(r) { r._hash = `h${++this.seq}`; r.updated_at = new Date(Date.now() + this.seq).toISOString(); return structuredClone(r); }
  check() { if (this.down) { const e = new Error("connect ECONNREFUSED"); throw e; } }
  async collection(id) { this.check(); const c = this.collections.get(id); return c ? structuredClone(c) : null; }
  async collectionsBy(app) { this.check(); return [...this.collections.values()].filter((c) => c.source_app === app).map((c) => structuredClone(c)); }
  async createCollection(values) { this.check(); this.calls.push(["createCollection", values]); const c = { ...structuredClone(values), id: `coll-${++this.seq}`, slug: "wingman-likes-and-passes" }; this.collections.set(c.id, c); return this.stamp(c); }
  async items(cid) { this.check(); return [...this.itemsById.values()].filter((i) => i.collection_id === cid).map((i) => structuredClone(i)); }
  async insertItem(values) { this.check(); this.calls.push(["insertItem", values]); const i = { ...structuredClone(values), id: `item-${++this.seq}` }; this.itemsById.set(i.id, i); return this.stamp(i); }
  async updateItem(id, data, hash) {
    this.check();
    this.calls.push(["updateItem", id, data, hash]);
    const i = this.itemsById.get(id);
    if (hash && i._hash !== hash) { const e = new Error("notebook answered 409: This record changed."); e.status = 409; e.code = "CONFLICT"; throw e; }
    i.data = structuredClone(data);
    return this.stamp(i);
  }
  // What the person does on their screen: their comment, saved like the notebook saves it.
  comment(itemId, text) { const i = this.itemsById.get(itemId); i.data = { ...i.data, comment: text }; this.stamp(i); }
  list() { return [...this.itemsById.values()]; }
}

export const settingsFile = (mc) => path.join(mc, "routines", "wingman", "settings.json");
export const watchFile = (mc) => path.join(mc, "routines", "wingman", "watch.md");

export function tempMc(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-mc-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "routines", "wingman"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "wingman", "preferences.md"), "# Who I am looking for\n\nPeople who play VRChat.\n\n## How I write\nShort and playful.\n");
  fs.writeFileSync(settingsFile(dir), JSON.stringify({ sync: "off", timezone: "UTC", daily_start: "18:30", talk: ["desk"], ...settings }));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-state-"));
  return { mc: dir, state };
}

export function setMode(w, mode, site = "flirtual") { w.updateSite(site, (ss) => { ss.mode = mode; }); }

export function makeWorker(users, { at = "2026-10-03T18:31:00Z", telegramUp = () => true, discordOf, screenshotsUrl = "", settings = {} } = {}) {
  const { mc, state } = tempMc(settings);
  const fl = new FakeFlirtual(users);
  const nb = new FakeNotebook();
  const told = [];
  const calls = [];
  let now = new Date(at);
  const w = new Worker({
    mcDir: mc, stateDir: state,
    deps: {
      makeAdapter: (id, ctx) => createFlirtual({ ...ctx, api: fl }),
      ask: fakeAsk(calls, { discordOf }), tell: async (text, picture) => { if (!telegramUp()) return null; told.push({ text, picture }); return 1; },
      now: () => now, rand: () => 0.5, sleep: async () => {}, noBrowserPage: true, fetch: async () => ({ ok: false }),
      notebook: nb, screenshotsUrl,
    },
  });
  return { w, fl, nb, told, calls, mc, state, advance: (ms) => { now = new Date(now.getTime() + ms); }, setNow: (d) => { now = new Date(d); } };
}

// The result the worker wrote for a request.
export const result = (w, id) => JSON.parse(fs.readFileSync(path.join(w.paths.requestsDone, `${id}.json`), "utf8")).result;
