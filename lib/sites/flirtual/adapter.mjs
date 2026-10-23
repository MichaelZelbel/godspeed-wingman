// The Flirtual adapter: the site contract (../contract.md) on top of Flirtual's own web API, run
// inside the logged-in browser page (api.mjs), and its profile page (page.mjs).
import { FlirtualApi, FlirtualError, profileUrl } from "./api.mjs";
import { normalize, digest } from "./profile.mjs";
import { takePicture } from "./page.mjs";
import { SiteError } from "../errors.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMITS = { out_of_likes: "likes", out_of_browses: "profiles" };

// `api` replaces Flirtual's API (the tests use a pretend one); everything else is the contract's.
export default function create({ driver, settings = {}, log = () => {}, wait = sleep, api, now = () => new Date() } = {}) {
  const fl = api || new FlirtualApi(driver);
  const mode = ["love", "friend"].includes(settings.queue) ? settings.queue : settings.kind === "friend" ? "friend" : "love";
  let me = null;
  let current = null;

  async function session() {
    const s = await fl.session();
    if (!s) { me = null; return { loggedIn: false, me: null }; }
    const u = s.user || {};
    me = u.id || s.user_id || null;
    return { loggedIn: true, me: { id: me, name: u.slug || u.profile?.display_name || null }, premium: (u.entitlements || []).length > 0 };
  }

  // A like or pass runs exactly once. No likes or profiles left today: nothing was done, and the
  // worker ends Flirtual's part of the session. Already answered, or blocked: done, as far as the
  // Wingman is concerned.
  async function respond(type, id) {
    try {
      const r = await fl.respond(type, id, mode);
      return { match: !!r.match, limitReached: false };
    } catch (e) {
      if (e instanceof FlirtualError && LIMITS[e.code]) return { match: false, limitReached: true, why: LIMITS[e.code] };
      if (e instanceof FlirtualError && ["already_responded", "blocked"].includes(e.code)) return { match: false, limitReached: false, already: e.code };
      throw e;
    }
  }

  return {
    session,

    async queue() {
      const q = await fl.queue(mode);
      return { next: q.next, limits: q.limits, done: !q.next.length && !q.pending };
    },

    async profile(id) { return normalize(await fl.user(id), now()); },

    async open(profile) {
      current = profile;
      await driver.goto(profileUrl(profile));
    },

    // The picture of the open profile, and the real picture addresses as the page shows them
    // (Flirtual sends only picture ids).
    async picture(profile = current) {
      const pic = await takePicture(driver, profile, { wait, log });
      const keys = JSON.stringify(profile?.photoKeys || []);
      const seen = await driver.evaluate(`(() => { const k = ${keys}; return [...document.images].map(i => i.currentSrc || i.src).filter(u => k.some(x => u.includes(x))); })()`).catch(() => []);
      if (profile && Array.isArray(seen) && seen.length) profile.photos = [...new Set(seen.filter((u) => /^https:\/\//.test(u)))];
      return { data: pic.data, ext: pic.data?.[0] === 0xff ? "jpg" : "png", capture: pic.capture, meta: pic.meta };
    },

    html() { return driver.content(); },

    like: (id) => respond("like", id),
    pass: (id) => respond("pass", id),
    skip: (id) => fl.skip(id),

    async conversations() {
      if (!me) {
        const s = await session();
        if (!s.loggedIn) throw new SiteError("Flirtual shows no login", { site: "flirtual", loggedOut: true });
      }
      const page = await fl.conversations();
      const list = page?.data || page?.entries || [];
      return list.map((c) => {
        const last = c.last_message || c.lastMessage || null;
        const sender = last ? last.sender_id || last.senderId : null;
        // A conversation is made with the match: its kind is "love" or "friend" (Homie Mode).
        return {
          id: c.id,
          with: { id: c.user_id || c.userId, name: null },
          friend: c.kind === "friend",
          matchedAt: c.created_at || c.createdAt || null,
          messages: last ? [{ id: last.id || null, fromMe: !!sender && sender === me, text: String(last.content || "").trim(), at: last.created_at || last.createdAt || null, system: !!last.system }] : [],
        };
      });
    },

    send: (conversationId, text) => fl.sendMessage(conversationId, text),

    // People who liked the owner (Flirtual shows them with Premium; without it Flirtual refuses,
    // and that is fine).
    async likedYou() {
      let page;
      try { page = await fl.likes(mode); } catch { return []; }
      return (page?.data || []).map((x) => x.profile_id || x.profileId).filter(Boolean);
    },

    digest,
  };
}
