// The read-only guard of `site check`. A check reads a live site with the person's own login, so it
// must never like, pass, skip or send. Three layers make sure of that:
//
//   1. readOnlyAdapter: the check only ever holds a copy of the adapter whose like, pass, skip and
//      send throw. The real methods are never reachable from the check.
//   2. readOnlyBrowser: before every script the adapter runs in the page, the page gets a guard
//      that refuses every request that could change something (any method but GET, HEAD and
//      OPTIONS; a POST only to an address the site.json lists in post_reads, and never a GraphQL
//      mutation), every form, beacon and WebSocket message. So an adapter that changes something
//      from inside a read (a bug) is stopped there too.
//   3. readOnlyAndroid: no typing, no keys except Back, no sideways swipe (in many apps a like or a
//      pass), and no tap on anything labelled like, pass, skip, send and the like.
//
// What no guard can know: what a click on a web page does, or what an unlabelled button in an app
// does. An adapter's reading methods therefore never click or tap something that changes anything.

export const CHANGES = ["like", "pass", "skip", "send"];

export class ReadOnlyError extends Error {
  constructor(what) {
    super(`The check is read-only, so it refused ${what}.`);
    this.name = "ReadOnlyError";
    this.readOnly = true;
  }
}

// Layer 1: the adapter, without any way to change something.
export function readOnlyAdapter(adapter) {
  const blocked = Object.fromEntries(CHANGES.map((k) => [k, () => { throw new ReadOnlyError(`${k}()`); }]));
  return new Proxy(adapter, {
    get(target, k) {
      if (CHANGES.includes(k)) return typeof target[k] === "function" ? blocked[k] : undefined;
      const v = target[k];
      return typeof v === "function" ? v.bind(target) : v;
    },
    set() { return false; },
    defineProperty() { return false; },
  });
}

// Layer 2: the script that guards a page. Safe to run again (it marks the page). Refusals are
// kept in window.__wingmanRefused, so the check reports them even when an adapter swallowed the
// error.
export function pageGuard(postReads = []) {
  return `(() => {
  if (window.__wingmanReadOnly) return true;
  const allowPost = ${JSON.stringify(postReads.filter((u) => typeof u === "string" && u.startsWith("https://")))};
  const refused = (window.__wingmanRefused = window.__wingmanRefused || []);
  const safe = (method, url, body) => {
    const m = String(method || "GET").toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
    if (m !== "POST") return false;
    let abs = "";
    try { abs = new URL(String(url), location.href).href; } catch (e) { return false; }
    if (!allowPost.some((p) => abs.startsWith(p))) return false;
    return typeof body === "string" && !/\\bmutation\\b/i.test(body);
  };
  const refuse = (what) => {
    refused.push(what);
    const e = new Error("The check is read-only, so it refused " + what + ".");
    e.wingmanReadOnly = true;
    return e;
  };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const isReq = typeof Request !== "undefined" && input instanceof Request;
    const url = isReq ? input.url : String(input);
    const method = (init && init.method) || (isReq ? input.method : "GET");
    const body = init && init.body;
    if (isReq && String(method).toUpperCase() === "POST" && body === undefined) return Promise.reject(refuse("POST " + url));
    if (!safe(method, url, body)) return Promise.reject(refuse(String(method).toUpperCase() + " " + url));
    return realFetch.apply(this, arguments);
  };
  const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    const open = X.open, send = X.send;
    X.open = function (method, url) { this.__wingman = { method, url }; return open.apply(this, arguments); };
    X.send = function (body) {
      const r = this.__wingman || {};
      if (!safe(r.method, r.url, body)) throw refuse(String(r.method).toUpperCase() + " " + r.url);
      return send.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) navigator.sendBeacon = function (url) { refuse("a beacon to " + url); return false; };
  const F = window.HTMLFormElement && window.HTMLFormElement.prototype;
  if (F) {
    F.submit = function () { throw refuse("a form"); };
    F.requestSubmit = function () { throw refuse("a form"); };
    document.addEventListener("submit", (ev) => {
      if (String(ev.target && ev.target.method || "get").toLowerCase() !== "get") { ev.preventDefault(); ev.stopImmediatePropagation(); refuse("a form"); }
    }, true);
  }
  if (window.WebSocket) window.WebSocket.prototype.send = function () { throw refuse("a WebSocket message"); };
  window.__wingmanReadOnly = true;
  return true;
})()`;
}

export const REFUSED_SCRIPT = "(window.__wingmanRefused || []).slice()";

// The browser, guarded: every script runs in a guarded page.
export function readOnlyBrowser(driver, { postReads = [] } = {}) {
  const guard = pageGuard(postReads);
  return new Proxy(driver, {
    get(target, k) {
      if (k === "evaluate") {
        return async (js, opts = {}) => {
          await target.evaluate(guard, { attempts: 1 });
          return target.evaluate(js, opts);
        };
      }
      if (k === "readOnly") return true;
      const v = target[k];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// Words that mark a button that changes something, in a label, a description or a resource id.
const ACTION = new Set(["like", "pass", "nope", "skip", "send", "superlike", "heart", "reject", "dislike", "undo", "rewind", "boost", "unmatch", "block", "report", "delete", "remove", "submit", "post", "swipe"]);
export function actionWord(...labels) {
  for (const l of labels) {
    const t = String(l || "").toLowerCase();
    if (/super\s*like/.test(t)) return "super like";
    // A resource id is "com.example.app:id/like_button": only the part after "/" names the button.
    const words = t.replace(/^[a-z0-9_.]+:id\//, "").split(/[^a-z]+/).filter(Boolean);
    const hit = words.find((w) => ACTION.has(w));
    if (hit) return hit;
  }
  return null;
}

// The labels of a node, the clickable node it belongs to, and everything inside that one.
export function labelsAround(nodes, node) {
  const byIndex = new Map(nodes.map((n) => [n.index, n]));
  let top = node;
  for (let p = node, i = 0; p && i < 6; p = byIndex.get(p.parent), i++) { if (p.clickable) { top = p; break; } }
  const inside = nodes.filter((n) => { for (let p = n, i = 0; p && i < 40; p = byIndex.get(p.parent), i++) if (p.index === top.index) return true; return false; });
  const all = [node, top, ...inside];
  return all.flatMap((n) => [n.text, n.desc, n.id]);
}

// Layer 3: the Android driver, guarded.
export function readOnlyAndroid(driver) {
  const refuseNode = (nodes, node, how) => {
    const w = actionWord(...labelsAround(nodes, node));
    if (w) throw new ReadOnlyError(`${how} on a button marked "${w}"`);
  };
  const guarded = {
    readOnly: true,
    async tap(x, y) {
      const nodes = await driver.dump();
      const node = driver.nodeAt(nodes, x, y);
      if (!node) throw new ReadOnlyError(`a tap at ${x},${y}, where it cannot tell what is there`);
      refuseNode(nodes, node, `a tap at ${x},${y}`);
      return driver.tap(x, y);
    },
    async tapNode(node) {
      const nodes = await driver.dump();
      const same = nodes.find((n) => n.bounds.join() === node.bounds.join() && n.text === node.text && n.id === node.id) || node;
      refuseNode(nodes, same, "a tap");
      return driver.tapNode(same);
    },
    async tapText(text, opts) { const nodes = await driver.dump(); const n = driver.find({ text, ...opts }, nodes); if (!n) throw new Error(`nothing on the screen says "${text}"`); refuseNode(nodes, n, "a tap"); return driver.tapNode(n); },
    async tapId(id) { const nodes = await driver.dump(); const n = driver.find({ id }, nodes); if (!n) throw new Error(`nothing on the screen has the id ${id}`); refuseNode(nodes, n, "a tap"); return driver.tapNode(n); },
    async tapDesc(desc, opts) { const nodes = await driver.dump(); const n = driver.find({ desc, ...opts }, nodes); if (!n) throw new Error(`nothing on the screen is described as "${desc}"`); refuseNode(nodes, n, "a tap"); return driver.tapNode(n); },
    async swipe(x1, y1, x2, y2, ms) {
      if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) throw new ReadOnlyError("a sideways swipe (in many apps a like or a pass)");
      return driver.swipe(x1, y1, x2, y2, ms);
    },
    async scroll(direction = "down", opts) {
      if (!["down", "up"].includes(direction)) throw new ReadOnlyError(`a sideways scroll (${direction})`);
      return driver.scroll(direction, opts);
    },
    async type() { throw new ReadOnlyError("typing"); },
    async key(code) {
      if (Number(code) === 4 || String(code).toUpperCase() === "KEYCODE_BACK") return driver.key(code);
      throw new ReadOnlyError(`the key ${code}`);
    },
  };
  return new Proxy(driver, {
    get(target, k) {
      if (Object.hasOwn(guarded, k)) return guarded[k];
      const v = target[k];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// An offline stand-in for a driver: any use throws, so creating an adapter that already reaches
// for the site is found out.
export function offlineDriver(kind = "browser") {
  return new Proxy({}, {
    get(_, k) {
      if (k === "then") return undefined;
      if (k === "kind") return kind === "android" ? "android" : "offline";
      if (k === "readOnly") return true;
      return () => { throw new Error(`an offline check has no ${kind === "android" ? "emulator" : "browser"} (the adapter called ${String(k)}())`); };
    },
  });
}
