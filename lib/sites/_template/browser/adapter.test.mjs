// Tests for the __NAME__ adapter. Run them with: node --test <this folder>
//
// Invented people only. Never paste a real profile, a real message or a recording of the real
// site into a test: anything real stays in the folder private/ (git never sees it) and is deleted
// when the work is done.
//
// How it works: the pretend driver runs the adapter's real page scripts (the same text the browser
// would run) with a pretend fetch that answers like the imagined site. When you change ROUTES or
// toProfile() for the real site, change the pretend answers below to the real shape, with invented
// names and ids.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import create, { ROUTES, PAGE, PROFILE_PAGE } from "./adapter.mjs";

const SITE = JSON.parse(fs.readFileSync(new URL("./site.json", import.meta.url), "utf8"));
const ORIGIN = new URL(SITE.home).origin;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// Three invented people, as the imagined site sends them.
const PEOPLE = {
  u_test_001: {
    id: "u_test_001", display_name: "Mara", age: 27, gender: "Woman", pronouns: "", city: "Lisbon", country: "PT",
    about: "<p>Board games &amp; long walks.</p><p>Ask me about my plants.</p>",
    details: { Languages: ["English", "Portuguese"], "Looking for": "Something serious" },
    questions: [{ question: "A perfect Sunday", answer: "Coffee, then a lake." }],
    photos: [{ url: "https://cdn.example.test/u_test_001/1.jpg" }, { url: "http://insecure.example.test/2.jpg" }],
  },
  u_test_002: { id: "u_test_002", display_name: "Juno", age: 31, gender: "Non-binary", pronouns: "they/them", about: "Climbing and bad puns.", photos: [] },
};

// The imagined site: its requests, a login that can be lost, a number of likes left.
function fakeSite({ loggedIn = true, likesLeft = 5 } = {}) {
  const site = { loggedIn, likesLeft, changes: [], queue: ["u_test_001", "u_test_002"] };
  site.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = String(init.method || "GET").toUpperCase();
    const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (u.origin !== ORIGIN) return reply(404, { error: "elsewhere" });
    if (!site.loggedIn) return reply(401, { error: "login_required" });
    const route = u.pathname;
    if (method !== "GET") site.changes.push({ method, route, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === "GET" && route === ROUTES.session) return reply(200, { id: "me_test", display_name: "You" });
    if (method === "GET" && route === ROUTES.queue) return reply(200, { people: site.queue.map((id) => ({ id })), likes_left: site.likesLeft, resets_at: "2030-01-01T00:00:00Z" });
    if (method === "GET" && route === ROUTES.conversations) {
      return reply(200, { conversations: [
        { id: "c_test_1", other: { id: "u_test_002", name: "Juno" }, messages: [{ id: "m1", from: "me_test", text: "Hi Juno" }, { id: "m2", from: "u_test_002", text: "Hey <b>you</b>", sent_at: "2030-01-01T10:00:00Z" }] },
      ] });
    }
    if (method === "POST" && route === ROUTES.send("c_test_1")) return reply(200, { ok: true });
    for (const id of Object.keys(PEOPLE)) {
      if (method === "GET" && route === ROUTES.profile(id)) return reply(200, PEOPLE[id]);
      if (method === "POST" && route === ROUTES.like(id)) {
        if (site.likesLeft <= 0) { site.changes.pop(); return reply(429, { error: "out_of_likes" }); }
        site.likesLeft--;
        return reply(200, { match: id === "u_test_002" });
      }
      if (method === "POST" && (route === ROUTES.pass(id) || route === ROUTES.skip(id))) return reply(200, {});
    }
    return reply(404, { error: "not_found" });
  };
  return site;
}

// The page the fallback reads: selector -> text, or a list of elements.
const field = (label, value) => ({ querySelector: (s) => ({ innerText: s === "dt" ? label : value }) });
const PAGE_OF_KIRI = {
  [PAGE.profile]: "the whole profile",
  [PAGE.name]: "Kiri", [PAGE.age]: "29", [PAGE.bio]: "Paints murals. Hates mornings.",
  [PAGE.field]: [field("Height", "170 cm"), field("Smokes", "No"), field("", "no label")],
  [PAGE.photo]: [{ currentSrc: "https://cdn.example.test/kiri/1.jpg" }, { src: "data:image/png;base64,AAAA" }],
};

function fakeDocument(page) {
  const el = (v) => (typeof v === "string" ? { innerText: v } : v);
  return {
    querySelector: (sel) => (page[sel] === undefined ? null : Array.isArray(page[sel]) ? el(page[sel][0]) ?? null : el(page[sel])),
    querySelectorAll: (sel) => (page[sel] === undefined ? [] : Array.isArray(page[sel]) ? page[sel].map(el) : [el(page[sel])]),
  };
}

// The pretend browser: runs every page script for real, with the pretend fetch and page.
function fakeDriver(site, page = {}) {
  const d = {
    location: { origin: "null", href: "about:blank" },
    visited: [], scripts: [],
    async goto(url) { d.visited.push(url); d.location = { origin: new URL(url).origin, href: url }; },
    async evaluate(js, opts = {}) {
      d.scripts.push({ js, attempts: opts.attempts });
      return new Function("fetch", "location", "document", `return (${js});`)(site.fetch, d.location, fakeDocument(page));
    },
    async capture({ selector } = {}) {
      if (selector && page[selector] === undefined) throw new Error(`nothing on the page matches ${selector}`);
      return { data: PNG, capture: selector ? "element" : "full" };
    },
    async content() { return "<html></html>"; },
  };
  return d;
}

const make = (site = fakeSite(), page) => {
  const driver = fakeDriver(site, page);
  return { site, driver, a: create({ driver, settings: {}, log: () => {}, wait: async () => {} }) };
};

test("site.json promises only what the adapter has", () => {
  const { a } = make();
  const need = { inbox: ["conversations"], send: ["send"], picture: ["open", "picture"], skip: ["skip"], "liked-you": ["likedYou"] };
  for (const m of ["session", "queue", "profile", "like", "pass", ...SITE.can.flatMap((c) => need[c] || [])]) assert.equal(typeof a[m], "function", m);
});

test("session: logged in, and logged out without an error", async () => {
  assert.deepEqual(await make().a.session(), { loggedIn: true, me: { id: "me_test", name: "You" } });
  assert.deepEqual(await make(fakeSite({ loggedIn: false })).a.session(), { loggedIn: false, me: null });
});

test("queue: today's suggestions and the likes left", async () => {
  const { a, driver } = make();
  const q = await a.queue();
  assert.deepEqual(q, { next: ["u_test_001", "u_test_002"], limits: { likes: 5, browses: null, resetAt: "2030-01-01T00:00:00Z" }, done: false });
  assert.equal(driver.visited[0], SITE.home, "the requests run inside the site's own page");
});

test("profile: the site's answer in the Wingman's shape, as plain text, only https pictures", async () => {
  const p = await make().a.profile("u_test_001");
  assert.equal(p.id, "u_test_001");
  assert.equal(p.site, SITE.id);
  assert.equal(p.name, "Mara");
  assert.equal(p.age, 27);
  assert.equal(p.bio, "Board games & long walks.\n\nAsk me about my plants.");
  assert.deepEqual(p.fields, { Languages: "English, Portuguese", "Looking for": "Something serious" });
  assert.deepEqual(p.prompts, [{ q: "A perfect Sunday", a: "Coffee, then a lake." }]);
  assert.deepEqual(p.photos, ["https://cdn.example.test/u_test_001/1.jpg"]);
  assert.equal(p.url, PROFILE_PAGE("u_test_001"));
  assert.equal(p.country, "pt");
});

test("like and pass: one request each, never repeated; no likes left changes nothing", async () => {
  const { a, site, driver } = make(fakeSite({ likesLeft: 1 }));
  assert.deepEqual(await a.like("u_test_002"), { match: true, limitReached: false });
  assert.deepEqual(await a.pass("u_test_001"), { match: false, limitReached: false });
  assert.deepEqual(await a.like("u_test_001"), { match: false, limitReached: true, why: "likes" });
  assert.deepEqual(site.changes.map((c) => `${c.method} ${c.route}`), [`POST ${ROUTES.like("u_test_002")}`, `POST ${ROUTES.pass("u_test_001")}`]);
  for (const s of driver.scripts.filter((x) => x.js.includes('"POST"'))) assert.equal(s.attempts, 1, "a change is tried once");
});

test("skip takes a profile out of today's list with one request", async () => {
  const { a, site } = make();
  await a.skip("u_test_002");
  assert.deepEqual(site.changes.map((c) => c.route), [ROUTES.skip("u_test_002")]);
});

test("a lost login is an error with loggedOut, so the Wingman asks the person to log in again", async () => {
  await assert.rejects(make(fakeSite({ loggedIn: false })).a.profile("u_test_001"), (e) => e.loggedOut === true);
});

test("conversations: who wrote last; send writes exactly one message", async () => {
  const { a, site } = make();
  const list = await a.conversations();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].with, { id: "u_test_002", name: "Juno" });
  assert.deepEqual(list[0].messages.map((m) => [m.fromMe, m.text]), [[true, "Hi Juno"], [false, "Hey you"]]);
  await a.send("c_test_1", 'See you at 8 "sharp"?');
  assert.deepEqual(site.changes, [{ method: "POST", route: ROUTES.send("c_test_1"), body: { text: 'See you at 8 "sharp"?' } }]);
});

test("picture: the profile's page, pictured whole", async () => {
  const { a, driver } = make(fakeSite(), PAGE_OF_KIRI);
  const p = await a.profile("u_test_001");
  await a.open(p);
  const pic = await a.picture(p);
  assert.equal(driver.visited.at(-1), p.url);
  assert.equal(pic.ext, "png");
  assert.equal(pic.capture, "element");
  assert.ok(pic.data.length > 0);
});

test("the fallback reads a profile from its page", async () => {
  const { a } = make(fakeSite(), PAGE_OF_KIRI);
  const p = await a.pageProfile("u_test_003");
  assert.equal(p.name, "Kiri");
  assert.equal(p.age, 29);
  assert.deepEqual(p.fields, { Height: "170 cm", Smokes: "No" });
  assert.deepEqual(p.photos, ["https://cdn.example.test/kiri/1.jpg"]);
});

test("an odd id stays data: it is never run as part of a script", async () => {
  const { a, site } = make();
  await assert.rejects(a.profile('x");globalThis.ran=1;("'), /answered 404/);
  assert.equal(globalThis.ran, undefined);
  assert.deepEqual(site.changes, []);
});
