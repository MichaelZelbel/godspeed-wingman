// Tests for the __NAME__ adapter. Run them from your mission control folder with
//     node --test "routines/wingman/sites/__ID__/*.test.mjs"
// (`godspeed-wingman site check __ID__` runs them too).
//
// Invented people only. Never put a real profile, a real message or a screen dump of the real app
// into a test: anything real stays in the folder private/ (git never sees it) and is deleted when
// the work is done.
//
// How it works: a pretend app with a few screens (login, the cards, an open profile, the messages,
// one conversation), driven through the same driver methods the Wingman's Android driver has. When
// you change IDS for the real app, change the pretend screens below to match, with invented people.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import create, { IDS, PACKAGE, cardKey, nameAge } from "./adapter.mjs";

const SITE = JSON.parse(fs.readFileSync(new URL("./site.json", import.meta.url), "utf8"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const PEOPLE = [
  { name: "Mara", age: 27, bio: "Board games and long walks.", fields: { Height: "168 cm", Languages: "English, Portuguese", Smokes: "No", Pets: "A cat" } },
  { name: "Juno", age: 31, bio: "Climbing and bad puns.", fields: { Height: "175 cm" }, match: true },
];

// The pretend app. Each screen is a list of nodes, the way the driver's dump() gives them.
function fakeApp({ loggedIn = true, likesLeft = 5 } = {}) {
  const app = { loggedIn, likesLeft, front: false, screen: loggedIn ? "cards" : "login", at: 0, scrolled: 0, chatWith: null, typed: "", focused: false, notice: null, likes: [], passes: [], sent: [], taps: [] };
  let seq = 0;
  const node = (o) => ({ index: seq++, parent: -1, depth: 1, text: "", desc: "", id: "", class: "android.view.View", package: PACKAGE, bounds: [0, 0, 100, 100], clickable: false, scrollable: false, ...o, id: o.id ? `${PACKAGE}:id/${o.id}` : "" });
  const tabs = () => [node({ id: IDS.tabDiscover, text: "Discover", clickable: true }), node({ id: IDS.tabMessages, text: "Messages", clickable: true })];
  app.nodes = () => {
    seq = 0;
    if (!app.front) return [node({ package: "com.android.launcher3", text: "Home" })];
    const p = PEOPLE[app.at];
    switch (app.screen) {
      case "login": return [node({ id: IDS.login, text: "Log in", clickable: true })];
      case "cards":
        if (app.notice) return [node({ id: app.notice, text: app.notice === IDS.match ? "It's a match!" : "No likes left today" })];
        if (!p) return [...tabs(), node({ id: IDS.empty, text: "No more people for today" })];
        return [...tabs(), node({ id: IDS.cardName, text: `${p.name}, ${p.age}`, clickable: true }), node({ id: IDS.cardBio, text: p.bio }), node({ id: IDS.pass, desc: "Pass", clickable: true }), node({ id: IDS.like, desc: "Like", clickable: true })];
      case "profile": {
        const pairs = Object.entries(p.fields).slice(app.scrolled * 2, app.scrolled * 2 + 2);
        return [node({ id: IDS.profileName, text: `${p.name}, ${p.age}` }), ...(app.scrolled ? [] : [node({ id: IDS.profileBio, text: p.bio })]), ...pairs.flatMap(([l, v]) => [node({ id: IDS.fieldLabel, text: l }), node({ id: IDS.fieldValue, text: v })])];
      }
      case "messages": return [...tabs(), node({ id: IDS.rowName, text: "Juno", clickable: true }), node({ id: IDS.rowLast, text: "Want to climb on Sunday?" }), node({ id: IDS.rowName, text: "Sam", clickable: true }), node({ id: IDS.rowLast, text: "You: See you then" })];
      case "chat": return [node({ id: IDS.input, text: app.typed, clickable: true }), node({ id: IDS.send, desc: "Send", clickable: true })];
      default: return [];
    }
  };
  const idOf = (n) => n.id.replace(/^.*:id\//, "");
  const matches = (n, q) => (q.id === undefined || n.id === q.id || n.id.endsWith(`:id/${q.id}`)) && (q.text === undefined || n.text === q.text);
  app.driver = {
    kind: "android",
    async current() { return { package: app.front ? PACKAGE : "com.android.launcher3", activity: null }; },
    async launch(pkg) { assert.equal(pkg, PACKAGE); app.front = true; },
    async dump() { return app.nodes(); },
    find: (q, nodes) => (nodes || []).find((n) => matches(n, q)) || null,
    findAll: (q, nodes) => (nodes || []).filter((n) => matches(n, q)),
    async waitFor(q) { const n = app.driver.find(q, app.nodes()); if (!n) throw new Error(`waited for ${JSON.stringify(q)}`); return n; },
    async tapNode(n) {
      const id = idOf(n);
      app.taps.push(id);
      if (id === IDS.cardName) { app.screen = "profile"; app.scrolled = 0; }
      else if (id === IDS.like) {
        if (app.likesLeft <= 0) { app.notice = IDS.outOfLikes; return; }
        app.likesLeft--; app.likes.push(PEOPLE[app.at].name);
        if (PEOPLE[app.at].match) app.notice = IDS.match;
        app.at++;
      } else if (id === IDS.pass) { app.passes.push(PEOPLE[app.at].name); app.at++; }
      else if (id === IDS.tabMessages) app.screen = "messages";
      else if (id === IDS.tabDiscover) app.screen = "cards";
      else if (id === IDS.rowName) { app.screen = "chat"; app.chatWith = n.text; app.typed = ""; }
      else if (id === IDS.input) app.focused = true;
      else if (id === IDS.send) { app.sent.push({ to: app.chatWith, text: app.typed }); app.typed = ""; }
    },
    async type(t) { assert.ok(app.focused, "typing goes into the message field"); app.typed += t; },
    async scroll(dir) { assert.equal(dir, "down"); app.scrolled++; },
    async back() {
      if (app.notice) app.notice = null;
      else if (app.screen === "profile") app.screen = "cards";
      else if (app.screen === "chat") { app.screen = "messages"; app.focused = false; }
      else if (app.screen === "messages") app.screen = "cards";
    },
    async capture() { return { data: PNG, capture: "viewport" }; },
  };
  return app;
}

const make = (opts) => { const app = fakeApp(opts); return { app, a: create({ driver: app.driver, settings: {}, log: () => {}, wait: async () => {} }) }; };
const keyOf = (p) => cardKey(p.name, p.age, p.bio);

test("site.json names the app and promises only what the adapter has", () => {
  assert.equal(SITE.android.package, PACKAGE);
  const { a } = make();
  const need = { inbox: ["conversations"], send: ["send"], picture: ["open", "picture"], skip: ["skip"], "liked-you": ["likedYou"] };
  for (const m of ["session", "queue", "profile", "like", "pass", ...SITE.can.flatMap((c) => need[c] || [])]) assert.equal(typeof a[m], "function", m);
});

test("session starts the app; a login screen means logged out", async () => {
  const { a, app } = make();
  assert.deepEqual(await a.session(), { loggedIn: true, me: { id: "me", name: null } });
  assert.equal(app.front, true);
  assert.deepEqual(await make({ loggedIn: false }).a.session(), { loggedIn: false, me: null });
  await assert.rejects(make({ loggedIn: false }).a.queue(), (e) => e.loggedOut === true);
});

test("the card in front is the queue; an empty deck is done for today", async () => {
  const { a, app } = make();
  assert.deepEqual(await a.queue(), { next: [keyOf(PEOPLE[0])], limits: null, done: false });
  app.at = PEOPLE.length;
  assert.deepEqual(await a.queue(), { next: [], limits: null, done: true });
  assert.deepEqual(app.likes, []);
});

test("profile opens the card, reads it to the end, and goes back, without liking or passing", async () => {
  const { a, app } = make();
  const id = (await a.queue()).next[0];
  const p = await a.profile(id);
  assert.equal(p.name, "Mara");
  assert.equal(p.age, 27);
  assert.equal(p.bio, "Board games and long walks.");
  assert.deepEqual(p.fields, PEOPLE[0].fields);
  assert.equal(app.screen, "cards");
  assert.deepEqual([app.likes, app.passes], [[], []]);
  assert.ok(!app.taps.includes(IDS.like) && !app.taps.includes(IDS.pass));
});

test("like and pass tap once, and only on the person decided about", async () => {
  const { a, app } = make();
  const mara = (await a.queue()).next[0];
  await assert.rejects(a.like(keyOf(PEOPLE[1])), /no longer/, "never the wrong person");
  assert.deepEqual(app.likes, []);
  assert.deepEqual(await a.pass(mara), { match: false, limitReached: false });
  const juno = (await a.queue()).next[0];
  assert.deepEqual(await a.like(juno), { match: true, limitReached: false });
  assert.equal(app.notice, null, "the match screen was closed");
  assert.deepEqual([app.passes, app.likes], [["Mara"], ["Juno"]]);
});

test("no likes left: limitReached, and nobody was liked", async () => {
  const { a, app } = make({ likesLeft: 0 });
  const id = (await a.queue()).next[0];
  assert.deepEqual(await a.like(id), { match: false, limitReached: true, why: "likes" });
  assert.deepEqual(app.likes, []);
});

test("conversations: who wrote last, by name; send types once and taps send once", async () => {
  const { a, app } = make();
  const list = await a.conversations();
  assert.deepEqual(list.map((c) => [c.id, c.messages[0].fromMe, c.messages[0].text]), [["Juno", false, "Want to climb on Sunday?"], ["Sam", true, "See you then"]]);
  assert.equal(app.screen, "cards");
  await a.send("Juno", "Sunday works, 10am?");
  assert.deepEqual(app.sent, [{ to: "Juno", text: "Sunday works, 10am?" }]);
  assert.equal(app.taps.filter((t) => t === IDS.send).length, 1);
  await assert.rejects(a.send("Robin", "hi"), /no conversation with Robin/);
});

test("picture is the screen with this person's card in front, and nobody else's", async () => {
  const { a, app } = make();
  const p = await a.profile((await a.queue()).next[0]);
  await a.open(p);
  const pic = await a.picture(p);
  assert.equal(pic.ext, "png");
  assert.ok(pic.data.length > 0);
  assert.equal(pic.meta.shown, true);
  app.at = 1;
  assert.equal((await a.picture(p)).data, null, "the card moved on: no picture of someone else");
  assert.equal((await a.picture({ id: "Juno" })).data, null);
});

test("a match from the messages tab is kept by name, without a tap", async () => {
  const { a, app } = make();
  const p = await a.profile("Juno");
  assert.deepEqual([p.id, p.name, p.url, p.photos], ["Juno", "Juno", "", []]);
  assert.deepEqual(app.taps, []);
});

test("a name with an age, and a key that only changes with the card", () => {
  assert.deepEqual(nameAge("Kiri, 29"), { name: "Kiri", age: 29 });
  assert.deepEqual(nameAge("Robin"), { name: "Robin", age: null });
  assert.equal(cardKey("Kiri", 29, "hi"), cardKey("Kiri", 29, "hi"));
  assert.notEqual(cardKey("Kiri", 29, "hi"), cardKey("Kiri", 30, "hi"));
});
