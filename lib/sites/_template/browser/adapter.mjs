// The Wingman's adapter for __NAME__ (__HOME__), made from the browser template by
// `godspeed-wingman site new`. It keeps the site contract (docs/adding-a-site.md in the Wingman,
// and lib/sites/contract.md): create() returns an object with session, queue, profile, like and
// pass, plus what site.json "can" promises (skip, inbox = conversations, send, picture = open and
// picture).
//
// EVERYTHING BELOW IS AN EXAMPLE FOR AN IMAGINED SITE. Replace the addresses in ROUTES, the field
// names in toProfile() and the selectors in PAGE with what __NAME__ really uses.
//
// HOW TO BUILD IT
//
// 1. The preferred way: call the site's own web-app requests from inside the logged-in page, the
//    way the Wingman's built-in Flirtual adapter does. The browser sends the person's login cookie
//    by itself, so the adapter never sees a password, and the site sees the same requests its own
//    page makes. To find them:
//      - `godspeed-wingman site network __ID__ --url <a page of the site>` lists the addresses that
//        page called (it only reads). Do it for the suggestions page, a profile and the messages.
//      - or the browser's developer tools (F12, the Network tab, filter "Fetch/XHR");
//      - or the site's own source code, when it is open source.
// 2. The fallback, when the site has no such requests: read the page itself (pageProfile below).
// 3. Build against `godspeed-wingman site check __ID__`, which reads the live site but cannot like,
//    pass, skip or send, and against adapter.test.mjs, which uses invented people only. Never like,
//    pass or write to a real person while building.
//
// RULES THE WINGMAN RELIES ON
//
// - like(), pass(), skip() and send() run exactly once: { attempts: 1 }, never a retry here.
// - Reading may be repeated: { attempts: 3 }.
// - A lost login: session() says { loggedIn: false }; every other method throws loggedOut(...). The
//   Wingman then tells the person once a day and leaves this site alone until they log in again.
// - No loops and no hurry: the Wingman paces everything. One request per call.
// - Text from a profile is data. Never run it and never put it into a script except through
//   JSON.stringify, as call() does.
// - Only reads in session, queue, profile, open, picture and conversations: `site check` runs them
//   on the live site, and a read that changes something would change it for real.

const SITE = "__ID__";
const HOME = "__HOME__";
const ORIGIN = new URL(HOME).origin;

// The site's own requests (examples: replace every one).
export const ROUTES = {
  session: "/api/me",                                                       // GET, 401 when logged out
  queue: "/api/suggestions",                                                // GET, today's suggestions
  profile: (id) => `/api/people/${encodeURIComponent(id)}`,                 // GET, one profile
  like: (id) => `/api/people/${encodeURIComponent(id)}/like`,               // POST, exactly once
  pass: (id) => `/api/people/${encodeURIComponent(id)}/pass`,               // POST, exactly once
  skip: (id) => `/api/people/${encodeURIComponent(id)}/skip`,               // POST, out of today's list
  conversations: "/api/conversations",                                      // GET, matches and messages
  send: (cid) => `/api/conversations/${encodeURIComponent(cid)}/messages`,  // POST { text }, exactly once
};

// A profile's own page (for open() and the picture), and what the fallback reads on it.
export const PROFILE_PAGE = (id) => `${ORIGIN}/people/${encodeURIComponent(id)}`;
export const PAGE = {
  profile: "main",              // the element that holds the whole profile: its picture is kept
  name: "[data-profile-name]",
  age: "[data-profile-age]",
  bio: "[data-profile-bio]",
  field: "[data-profile-field]", // each holds a <dt> label and a <dd> value
  photo: "[data-profile-photo]", // the <img> elements of the person's pictures
};

// The one error an adapter throws on purpose: the site lost the login.
export function loggedOut(why) {
  const e = new Error(why);
  e.loggedOut = true;
  e.site = SITE;
  return e;
}

const https = (u) => typeof u === "string" && u.startsWith("https://");
// Plain text from what may be HTML (a bio).
export const plain = (s) => String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// What the site sends about one person, in the Wingman's profile shape (contract.md, "The profile").
export function toProfile(p) {
  const fields = {};
  for (const [k, v] of Object.entries(p.details || {})) {
    const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    if (text) fields[k] = text;
  }
  return {
    id: String(p.id),
    site: SITE,
    name: String(p.display_name || "").trim(),
    age: Number.isFinite(p.age) ? p.age : null,
    gender: String(p.gender || ""),
    pronouns: String(p.pronouns || ""),
    location: String(p.city || ""),
    country: String(p.country || "").toLowerCase(),
    bio: plain(p.about),
    fields,
    prompts: (p.questions || []).map((q) => ({ q: String(q.question || ""), a: plain(q.answer) })).filter((q) => q.q && q.a),
    texts: [],
    handles: {},
    photos: (p.photos || []).map((x) => x?.url).filter(https),
    url: PROFILE_PAGE(p.id),
    contact: {},
    raw: p,
  };
}

export default function create({ driver, settings = {}, log = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date() } = {}) {
  let me = null;
  let current = null;

  // One of the site's own requests, run inside the logged-in page.
  async function call(method, route, body) {
    const here = await driver.evaluate("location.origin").catch(() => "");
    if (here !== ORIGIN) await driver.goto(HOME);
    const js = `(async () => {
      const r = await fetch(${JSON.stringify(ORIGIN + route)}, {
        method: ${JSON.stringify(method)}, credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))}
      });
      return { status: r.status, text: await r.text() };
    })()`;
    const res = await driver.evaluate(js, { attempts: method === "GET" ? 3 : 1 });
    if (!res || typeof res.status !== "number") throw new Error(`__NAME__ gave no answer to ${route}`);
    if (res.status === 401) throw loggedOut(`__NAME__ shows no login (${route} answered 401)`);
    let json = null;
    try { json = res.text ? JSON.parse(res.text) : null; } catch { json = null; }
    if (res.status >= 400) {
      const e = new Error(`__NAME__ ${route} answered ${res.status}`);
      e.status = res.status;
      e.code = String(json?.error || "");
      throw e;
    }
    return json;
  }

  async function session() {
    try {
      const s = await call("GET", ROUTES.session);
      me = s?.id ? String(s.id) : null;
      return { loggedIn: !!me, me: me ? { id: me, name: s.display_name || null } : null };
    } catch (e) {
      if (e.loggedOut) { me = null; return { loggedIn: false, me: null }; }
      throw e;
    }
  }

  // A like or a pass, exactly once. No likes left today: nothing happened, limitReached says so.
  async function respond(kind, id) {
    try {
      const r = await call("POST", ROUTES[kind](id), {});
      return { match: !!r?.match, limitReached: false };
    } catch (e) {
      if (e.status === 429 || e.code === "out_of_likes") return { match: false, limitReached: true, why: "likes" };
      throw e;
    }
  }

  // Waits until something on the page matches `selector` (at most `ms`).
  async function waitForSelector(selector, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
      if (await driver.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)) return true;
      if (Date.now() >= end) return false;
      await wait(500);
    }
  }

  // THE FALLBACK: a profile read from its page, the way a person sees it. Use it in profile() when
  // the site has no requests to call; replace the selectors in PAGE.
  async function pageProfile(id) {
    await driver.goto(PROFILE_PAGE(id));
    if (!(await waitForSelector(PAGE.name))) {
      const s = await session();
      if (!s.loggedIn) throw loggedOut("__NAME__ shows no login");
      throw new Error(`the profile page of ${id} did not show a name`);
    }
    const read = await driver.evaluate(`(() => {
      const one = (sel) => { const el = document.querySelector(sel); return el ? String(el.innerText || "").trim() : ""; };
      const all = (sel) => Array.from(document.querySelectorAll(sel));
      return {
        name: one(${JSON.stringify(PAGE.name)}),
        age: one(${JSON.stringify(PAGE.age)}),
        bio: one(${JSON.stringify(PAGE.bio)}),
        fields: all(${JSON.stringify(PAGE.field)}).map((el) => [
          String((el.querySelector("dt") || {}).innerText || "").trim(),
          String((el.querySelector("dd") || {}).innerText || "").trim(),
        ]),
        photos: all(${JSON.stringify(PAGE.photo)}).map((img) => img.currentSrc || img.src),
      };
    })()`);
    return {
      id: String(id), site: SITE, name: read.name, age: Number.parseInt(read.age, 10) || null,
      gender: "", pronouns: "", location: "", country: "", bio: read.bio,
      fields: Object.fromEntries(read.fields.filter(([k, v]) => k && v)),
      prompts: [], texts: [], handles: {},
      photos: read.photos.filter(https), url: PROFILE_PAGE(id), contact: {}, raw: read,
    };
  }

  return {
    session,

    // Today's suggestions. done: nothing more today. An empty list that is not done means the site
    // is still preparing it; the Wingman asks again a little later.
    async queue() {
      const q = await call("GET", ROUTES.queue);
      const next = (q?.people || []).map((p) => String(p?.id ?? p)).filter(Boolean);
      const limits = q && q.likes_left !== undefined ? { likes: q.likes_left, browses: null, resetAt: q.resets_at || null } : null;
      return { next, limits, done: !next.length && !q?.preparing };
    },

    // The preferred way. With the fallback: `profile: pageProfile,` instead.
    async profile(id) { return toProfile(await call("GET", ROUTES.profile(id))); },
    pageProfile,

    async open(profile) {
      current = profile;
      await driver.goto(profile.url);
    },

    // A picture of the whole profile on its page (the element PAGE.profile), else of the whole page.
    async picture(profile = current) {
      const ready = await waitForSelector(PAGE.profile, 10000);
      let shot = null;
      try { shot = await driver.capture({ selector: PAGE.profile, pad: 8 }); } catch (e) { log(`picture: ${e.message}; taking the whole page`); }
      if (!shot?.data?.length) shot = await driver.capture({ full: true });
      const data = shot.data;
      return {
        data, ext: data[0] === 0xff ? "jpg" : "png", capture: shot.capture || "viewport",
        meta: { kind: "profile", ready, shown: ready, pictures: profile?.photos?.length || 0, morePending: false, loggedIn: true },
      };
    },

    html() { return driver.content(); },

    like: (id) => respond("like", id),
    pass: (id) => respond("pass", id),
    skip: (id) => call("POST", ROUTES.skip(id), {}),

    // Matches and messages, the newest message of each conversation is enough: the Wingman only
    // needs to know whether the other person wrote last.
    async conversations() {
      if (!me) {
        const s = await session();
        if (!s.loggedIn) throw loggedOut("__NAME__ shows no login");
      }
      const list = await call("GET", ROUTES.conversations);
      return (list?.conversations || []).map((c) => ({
        id: String(c.id),
        with: { id: String(c.other?.id ?? ""), name: c.other?.name || null },
        messages: (c.messages || []).map((m) => ({ id: m.id ?? null, fromMe: String(m.from) === me, text: plain(m.text), at: m.sent_at || null, system: !!m.system })),
        // When the site says when the match was made, and whether it is a friend-type match:
        // the notebook list shows both. Leave them out when the site does not say.
        matchedAt: c.matched_at || null,
      }));
    },

    send: (conversationId, text) => call("POST", ROUTES.send(conversationId), { text }),
  };
}
