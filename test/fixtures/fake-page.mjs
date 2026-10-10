// A pretend web page for the tests, in its own JavaScript world (node:vm): the scripts an adapter
// sends to "the browser" really run here, with a pretend fetch that answers like an imagined dating
// site. So the read-only guard (lib/sites/guard.mjs) is installed and tested in the page exactly as
// in a real browser. Everyone here is invented.
import vm from "node:vm";

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// routes: (method, url, body) -> { status, body } | undefined (404); elements: selector -> element.
// Every request is kept in `requests`, every one that is not a read in `changes`.
export function fakePage({ origin = "https://kindmeet.example", routes = () => undefined, resources = [], elements = {} } = {}) {
  const page = { requests: [], changes: [], visited: [], scripts: [], closed: false };
  const respond = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const abs = new URL(String(url), page.ctx.location.href).href;
    page.requests.push({ method, url: abs });
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) page.changes.push({ method, url: abs, body: init.body });
    const r = routes(method, abs, init.body) || { status: 404, body: { error: "not_found" } };
    return { status: r.status, ok: r.status < 400, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)), json: async () => r.body };
  };
  const newWorld = (href) => {
    class XMLHttpRequest { open(method, url) { this.m = method; this.u = url; } send(body) { page.changes.push({ method: this.m, url: this.u, body, xhr: true }); } }
    class WebSocket { send(x) { page.changes.push({ method: "WS", body: x }); } }
    class HTMLFormElement { submit() { page.changes.push({ method: "FORM" }); } requestSubmit() { page.changes.push({ method: "FORM" }); } }
    class Request { constructor(url, init = {}) { this.url = url; this.method = init.method || "GET"; } }
    const ctx = {
      fetch: respond, URL, Promise, Error, JSON, Array, String, Object, Set, Map, Number, Math,
      location: { href, origin: new URL(href).origin },
      navigator: { sendBeacon: (u) => { page.changes.push({ method: "BEACON", url: u }); return true; } },
      document: { addEventListener() {}, querySelector: (sel) => elements[sel] ?? null, querySelectorAll: (sel) => (elements[sel] ? [elements[sel]] : []), documentElement: { outerHTML: "<html></html>" } },
      performance: { getEntriesByType: (t) => (t === "resource" ? resources : []) },
      XMLHttpRequest, WebSocket, HTMLFormElement, Request,
    };
    ctx.window = ctx;
    return vm.createContext(ctx);
  };
  page.ctx = newWorld(`${origin}/`);
  page.driver = {
    kind: "local",
    async health() { return { status: "ok" }; },
    async goto(url) { page.visited.push(url); page.ctx = newWorld(url); return { ok: true }; },
    async evaluate(js, opts = {}) {
      page.scripts.push({ js, attempts: opts.attempts });
      try { return await vm.runInContext(js, page.ctx); } catch (e) { throw new Error(`the page script failed: ${e?.message || e}`); }
    },
    async capture({ selector } = {}) { return { data: PNG, capture: selector ? "element" : "full" }; },
    async screenshot() { return PNG; },
    async content() { return "<html></html>"; },
    async close() { page.closed = true; },
  };
  return page;
}
