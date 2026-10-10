// The Wingman's adapter for __NAME__, an Android app (__PACKAGE__), made from the Android template
// by `godspeed-wingman site new`. EXPERIMENTAL, like everything Android in the Wingman.
//
// The app runs in an Android emulator on this machine; the person installed it there from the
// Play Store and logged in once. The adapter works the app the way a finger does, through the
// Wingman's Android driver: it reads what is on the screen (a list of nodes with text, description
// and resource id), taps, scrolls and types.
//
// EVERYTHING BELOW IS AN EXAMPLE FOR AN IMAGINED APP. Replace the resource ids in IDS with what
// __NAME__ really shows. To see them, open the screen in the emulator and run
//     godspeed-wingman android dump
// which lists every node on the screen (it only reads). A website is always the better way when
// the service has one: use the browser template then.
//
// RULES THE WINGMAN RELIES ON
//
// - like(), pass() and send() tap exactly once and never retry. Before a like or a pass, the card
//   in front is read again: if it is not the person the Wingman decided about, nothing is tapped.
// - session, queue, profile, open, picture and conversations only read: they open, scroll and go
//   back, and never tap a button that changes something. `site check` runs them on the real app,
//   with a guard that refuses taps on anything labelled like, pass, send and the like.
// - A lost login: session() says { loggedIn: false }; every other method throws loggedOut(...).
// - Never like, pass or write to a real person while building: use `site check` and the tests in
//   adapter.test.mjs, which use invented people only.
import crypto from "node:crypto";

const SITE = "__ID__";
export const PACKAGE = "__PACKAGE__";

// What is on the app's screens, by resource id (the part after ":id/"). Examples: replace each one.
export const IDS = {
  login: "login_button",         // only on the logged-out start screen
  tabDiscover: "tab_discover",   // the tab with the cards
  tabMessages: "tab_messages",   // the tab with matches and messages
  cardName: "card_name",         // "Mara, 27" on the card in front
  cardBio: "card_bio",
  empty: "empty_title",          // "No more people for today"
  like: "like_button",           // CHANGES something: only like() taps it
  pass: "pass_button",           // CHANGES something: only pass() taps it
  outOfLikes: "out_of_likes",    // the app's notice that no likes are left today
  match: "match_title",          // "It's a match!"
  profileName: "profile_name",   // the opened profile
  profileBio: "profile_bio",
  fieldLabel: "field_label",     // the profile's details, label and value in pairs
  fieldValue: "field_value",
  rowName: "conversation_name",  // one per conversation on the messages tab
  rowLast: "conversation_last",  // its newest message ("You: ..." when the owner wrote it)
  input: "message_input",
  send: "send_button",           // CHANGES something: only send() taps it
};

export function loggedOut(why) {
  const e = new Error(why);
  e.loggedOut = true;
  e.site = SITE;
  return e;
}

// "Mara, 27" -> { name: "Mara", age: 27 }.
export function nameAge(text) {
  const m = String(text || "").match(/^(.*?)(?:,\s*(\d{2}))?\s*$/);
  return { name: (m?.[1] || "").trim(), age: m?.[2] ? Number(m[2]) : null };
}

// Apps rarely show a profile's id, so the card is known by what it shows: the same name, age and
// start of the bio give the same key.
export function cardKey(name, age, bio) {
  return `card_${crypto.createHash("sha1").update(`${name}|${age ?? ""}|${String(bio || "").slice(0, 80)}`).digest("hex").slice(0, 16)}`;
}

export default function create({ driver, settings = {}, log = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let current = null;
  const find = (nodes, id) => driver.find({ id }, nodes);
  const text = (nodes, id) => find(nodes, id)?.text || "";

  // The app in front, started when it is not; then the screen, once it shows the app.
  async function screen() {
    const now = await driver.current();
    if (now.package !== PACKAGE) await driver.launch(PACKAGE);
    for (let i = 0; i < 20; i++) {
      const nodes = await driver.dump();
      if (nodes.some((n) => n.package === PACKAGE)) return nodes;
      await wait(1000);
    }
    throw new Error(`__NAME__ did not come to the front`);
  }

  // The discover tab, with the card in front: { nodes, card: { key, name, age, bio } | null, empty }.
  async function discover() {
    let nodes = await screen();
    if (find(nodes, IDS.login)) throw loggedOut("__NAME__ shows its login screen");
    if (!find(nodes, IDS.cardName) && !find(nodes, IDS.empty)) {
      const tab = find(nodes, IDS.tabDiscover);
      if (tab) { await driver.tapNode(tab); await wait(1500); nodes = await driver.dump(); }
    }
    const nameNode = find(nodes, IDS.cardName);
    if (!nameNode) return { nodes, card: null, empty: !!find(nodes, IDS.empty) };
    const { name, age } = nameAge(nameNode.text);
    const bio = text(nodes, IDS.cardBio);
    return { nodes, card: { key: cardKey(name, age, bio), name, age, bio, node: nameNode }, empty: false };
  }

  // The card in front must still be `id` before anything is tapped.
  async function sameCard(id) {
    const d = await discover();
    if (!d.card || d.card.key !== id) throw new Error(`the card in front is no longer ${id}, so nothing was tapped`);
    return d;
  }

  // A like or a pass: exactly one tap, then a look at what the app shows.
  async function respond(button, id) {
    const d = await sameCard(id);
    const b = find(d.nodes, button);
    if (!b) throw new Error(`the ${button === IDS.like ? "like" : "pass"} button is not on the screen`);
    await driver.tapNode(b);
    await wait(1500);
    const after = await driver.dump();
    if (find(after, IDS.outOfLikes)) { await driver.back(); return { match: false, limitReached: true, why: "likes" }; }
    if (find(after, IDS.match)) { await driver.back(); return { match: true, limitReached: false }; }
    return { match: false, limitReached: false };
  }

  async function messagesTab() {
    const nodes = await screen();
    if (find(nodes, IDS.login)) throw loggedOut("__NAME__ shows its login screen");
    const tab = find(nodes, IDS.tabMessages);
    if (!tab) throw new Error("the messages tab is not on the screen");
    await driver.tapNode(tab);
    await wait(1500);
    return driver.dump();
  }

  return {
    async session() {
      const nodes = await screen();
      if (find(nodes, IDS.login)) return { loggedIn: false, me: null };
      return { loggedIn: true, me: { id: "me", name: null } };
    },

    // The card in front is the queue: one at a time, the way the app shows them.
    async queue() {
      const d = await discover();
      if (d.empty) return { next: [], limits: null, done: true };
      return { next: d.card ? [d.card.key] : [], limits: null, done: false };
    },

    // Opens the card, reads it to the end (a few scrolls), and goes back to the card. A match from
    // the messages tab (its id is the name the list shows) is not on a card: the template keeps
    // only what the list shows, without tapping anything. If the app makes their profile easy to
    // reach from the conversation, read it there instead.
    async profile(id) {
      if (!String(id).startsWith("card_")) {
        return { id: String(id), site: SITE, name: String(id), age: null, gender: "", pronouns: "", location: "", country: "", bio: "", fields: {}, prompts: [], texts: [], handles: {}, photos: [], url: "", contact: {}, raw: { from: "the messages tab" } };
      }
      const d = await sameCard(id);
      await driver.tapNode(d.card.node);
      await driver.waitFor({ id: IDS.profileName }, { timeoutMs: 15000 });
      const fields = {};
      let bio = "";
      for (let i = 0; i < 4; i++) {
        const nodes = await driver.dump();
        bio = bio || text(nodes, IDS.profileBio);
        const labels = driver.findAll({ id: IDS.fieldLabel }, nodes), values = driver.findAll({ id: IDS.fieldValue }, nodes);
        labels.forEach((l, k) => { if (l.text && values[k]?.text) fields[l.text] = values[k].text; });
        if (i < 3) await driver.scroll("down");
      }
      await driver.back();
      await wait(1000);
      current = { id, site: SITE, name: d.card.name, age: d.card.age, gender: fields.Gender || "", pronouns: fields.Pronouns || "", location: fields.Location || "", country: "", bio: bio || d.card.bio, fields, prompts: [], texts: [], handles: {}, photos: [], url: "", contact: {}, raw: { card: { name: d.card.name, age: d.card.age, bio: d.card.bio }, fields } };
      return current;
    },

    // The card is already in front; nothing to open.
    async open(profile) { current = profile; },

    // A picture of the screen, only while this person's card is in front. Anyone else (an old
    // card, a match) gets no picture rather than a picture of someone else.
    async picture(profile = current) {
      const none = { data: null, ext: "png", capture: "viewport", meta: { kind: "card", ready: false, shown: false, pictures: 0, morePending: false, loggedIn: true } };
      if (!profile?.id || !String(profile.id).startsWith("card_")) return none;
      const d = await discover();
      if (d.card?.key !== profile.id) return none;
      const shot = await driver.capture();
      return { data: shot.data, ext: "png", capture: "viewport", meta: { ...none.meta, ready: true, shown: true } };
    },

    like: (id) => respond(IDS.like, id),
    pass: (id) => respond(IDS.pass, id),

    // The messages tab: each conversation's newest message, by the other person's name (the only
    // thing the list shows that stays the same).
    async conversations() {
      const nodes = await messagesTab();
      const names = driver.findAll({ id: IDS.rowName }, nodes), lasts = driver.findAll({ id: IDS.rowLast }, nodes);
      const list = names.map((n, k) => {
        const last = lasts[k]?.text || "";
        const fromMe = /^you:\s*/i.test(last);
        return { id: n.text, with: { id: n.text, name: n.text }, messages: last ? [{ id: null, fromMe, text: last.replace(/^you:\s*/i, ""), at: null, system: false }] : [] };
      });
      await driver.back();
      return list;
    },

    // Exactly once: open the conversation, type, one tap on send, back.
    async send(conversationId, message) {
      const nodes = await messagesTab();
      const row = driver.findAll({ id: IDS.rowName }, nodes).find((n) => n.text === conversationId);
      if (!row) throw new Error(`no conversation with ${conversationId} on the messages tab`);
      await driver.tapNode(row);
      const input = await driver.waitFor({ id: IDS.input }, { timeoutMs: 15000 });
      await driver.tapNode(input);
      await driver.type(message);
      const send = find(await driver.dump(), IDS.send);
      if (!send) throw new Error("the send button is not on the screen; nothing was sent");
      await driver.tapNode(send);
      await wait(1000);
      await driver.back();
      await driver.back();
    },
  };
}
