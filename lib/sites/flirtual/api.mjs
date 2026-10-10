// Flirtual, through the logged-in browser. Every call is the same fetch the Flirtual web app makes
// itself (routes read from its open-source code, github.com/flirtual/flirtual, apps/api router.ex
// and apps/frontend/src/api), run inside a flirtu.al page so the browser's own login cookie and the
// site's bot checks apply as they do for a person.
import { randomUUID } from "node:crypto";
import { SiteError } from "../errors.mjs";

export const SITE = "https://flirtu.al";
export const API = "https://api.flirtu.al/v1";

export class FlirtualError extends SiteError {
  constructor(status, code, details, route) {
    super(`Flirtual ${route} answered ${status}${code ? ` (${code})` : ""}`, { site: "flirtual", loggedOut: status === 401, code: code || "", status, details: details || {} });
    this.route = route;
  }
}

export class FlirtualApi {
  constructor(driver) { this.driver = driver; }

  async ensureOrigin() {
    let origin = "";
    try { origin = await this.driver.evaluate("location.origin"); } catch { origin = ""; }
    if (origin !== SITE) await this.driver.goto(`${SITE}/en`);
  }

  // A read may be repeated after an error; a change (like, pass, message) runs exactly once, with
  // one idempotency key made here, so Flirtual can recognise a repeat as the same request.
  async api(method, route, body) {
    await this.ensureOrigin();
    const key = randomUUID();
    const js = `(async () => {
      const r = await fetch(${JSON.stringify(API + route)}, {
        method: ${JSON.stringify(method)}, credentials: "include",
        headers: { "content-type": "application/json", "idempotency-key": ${JSON.stringify(key)} },
        body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))}
      });
      return { status: r.status, text: await r.text() };
    })()`;
    const res = await this.driver.evaluate(js, { attempts: method === "GET" ? 3 : 1 });
    if (!res || typeof res.status !== "number") throw new FlirtualError(0, "no_answer", {}, route);
    let json = null;
    try { json = res.text ? JSON.parse(res.text) : null; } catch { json = { raw: res.text }; }
    if (res.status >= 400) throw new FlirtualError(res.status, json?.error, json?.details, route);
    return json;
  }

  async session() {
    try { return await this.api("GET", "/session"); }
    catch (e) { if (e instanceof FlirtualError && e.status === 401) return null; throw e; }
  }

  async queue(mode = "love") { return normQueue(await this.api("GET", `/queue?mode=${encodeURIComponent(mode)}`)); }
  user(id) { return this.api("GET", `/users/${encodeURIComponent(id)}`); }

  async respond(type, userId, mode = "love") {
    const r = await this.api("POST", "/queue", { type, mode, user_id: userId, source: mode });
    return { match: !!r?.match, matchKind: r?.match_kind ?? r?.matchKind ?? null, queue: normQueue(r?.queue) };
  }

  likes(mode = "love", cursor) {
    const q = new URLSearchParams({ kind: mode });
    if (cursor) q.set("cursor", cursor);
    return this.api("GET", `/likes?${q}`);
  }

  // Takes a profile out of today's queue without a like or a pass (the web app's skipProspect),
  // for a profile that cannot be read or judged.
  skip(userId) { return this.api("DELETE", `/queue/prospect?user_id=${encodeURIComponent(userId)}`); }

  conversations(cursor) { return this.api("GET", `/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); }
  sendMessage(conversationId, text) { return this.api("POST", `/conversations/${encodeURIComponent(conversationId)}/messages`, { text }); }
}

// A profile page by the account id, which never changes. The username (slug) works too, but it can
// be renamed and an old link would then break. Flirtual adds the language part itself (/en/...),
// and a logged-out browser goes to the login and then straight back to the profile.
export function profileUrl(user) {
  return `${SITE}/${encodeURIComponent(user?.id || user?.slug || "")}`;
}

// The API answers in snake_case; the web app converts. Accept both, so a change of style on their
// side does not break the run.
export function normQueue(q) {
  if (!q) return { previous: null, next: [], pending: false, fallback: false, limits: null };
  const limits = q.limits ? {
    likes: q.limits.likes || null,
    browses: q.limits.browses || null,
    resetAt: q.limits.reset_at ?? q.limits.resetAt ?? null,
  } : null;
  return {
    previous: q.previous ?? null,
    next: Array.isArray(q.next) ? q.next : [],
    pending: !!q.pending,
    fallback: !!q.fallback,
    canUndo: !!(q.can_undo ?? q.canUndo),
    limits,
  };
}
