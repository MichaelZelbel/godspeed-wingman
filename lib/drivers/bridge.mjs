// A browser on another machine, reached through a Chrome Agent Bridge gateway
// (https://github.com/MichaelZelbel/chrome-agent-bridge). Used when the Wingman runs on a server:
// the real browser sits on a home connection, holds the site's login and passes the site's bot
// checks; this module only asks it to open a page, run a script inside it, or take a picture.
// The token, when the bridge wants one, comes from the environment (GODSPEED_WINGMAN_BRIDGE_TOKEN
// or BRIDGE_TOKEN), never from the settings file.
//
// Only reads are repeated after an error. A script that changes something (a like, a message) runs
// once: if its answer is lost on the way back, repeating it could send the same message twice.
export class Bridge {
  constructor(base, { token = process.env.GODSPEED_WINGMAN_BRIDGE_TOKEN || process.env.BRIDGE_TOKEN || "", fetchImpl = fetch, timeoutMs = 45000 } = {}) {
    this.base = String(base || "").replace(/\/+$/, "");
    this.token = token;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get kind() { return "bridge"; }
  get where() { return this.base || "(no bridge address)"; }

  async #call(method, route, body, { binary = false, attempts = 3, headers: wantHeaders = false } = {}) {
    if (!this.base) throw new Error("no bridge address in the settings (bridge)");
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        const headers = { "content-type": "application/json" };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        const r = await this.fetch(this.base + route, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (binary) {
          if (!r.ok) throw new Error(`bridge ${route.split("?")[0]} answered ${r.status}`);
          const data = Buffer.from(await r.arrayBuffer());
          return wantHeaders ? { data, headers: r.headers } : data;
        }
        const text = await r.text();
        let json;
        try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (!r.ok) throw new Error(`bridge ${route} answered ${r.status}: ${(json.error || text).toString().slice(0, 200)}`);
        return json;
      } catch (e) {
        last = e;
        if (i < attempts - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
    }
    throw last;
  }

  health() { return this.#call("GET", "/health", undefined, { attempts: 1 }); }
  goto(url) { return this.#call("POST", "/goto", { url }); }
  async evaluate(js, { attempts = 3 } = {}) { return (await this.#call("POST", "/eval", { js }, { attempts })).result; }
  screenshot() { return this.#call("GET", "/screenshot", undefined, { binary: true }); }

  // A picture of one whole element or the whole page, also below the window (bridge 0.5.0:
  // ?selector, ?full, pad, format, quality). Tried once: a selector that matches nothing is a 404
  // that no repeat changes. An older bridge ignores the options and answers with the window; the
  // answer's `capture` says which it was ("element", "full" or "viewport").
  async capture({ selector, full, pad, format, quality, max } = {}) {
    const q = new URLSearchParams();
    if (selector) q.set("selector", selector);
    if (full) q.set("full", "1");
    for (const [k, v] of Object.entries({ pad, format, quality, max })) if (v !== undefined && v !== null) q.set(k, String(v));
    const r = await this.#call("GET", `/screenshot?${q}`, undefined, { binary: true, attempts: 1, headers: true });
    return { data: r.data, capture: r.headers.get("x-capture") || "viewport", cut: r.headers.get("x-capture-truncated") === "1", size: r.headers.get("x-capture-size") || null };
  }

  async content() {
    if (!this.base) throw new Error("no bridge address in the settings (bridge)");
    const r = await this.fetch(this.base + "/content", { signal: AbortSignal.timeout(this.timeoutMs), headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
    if (!r.ok) throw new Error(`bridge /content answered ${r.status}`);
    return r.text();
  }

  async close() { /* the bridge's browser belongs to its own machine */ }
}
