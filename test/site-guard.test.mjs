// The read-only guard of `site check`: the check holds an adapter whose like, pass, skip and send
// throw, every page script runs in a page that refuses changes, and an Android driver that refuses
// taps on like or pass buttons, typing and sideways swipes (the last is in android-driver.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOnlyAdapter, readOnlyBrowser, pageGuard, ReadOnlyError, actionWord, offlineDriver, REFUSED_SCRIPT, CHANGES } from "../lib/sites/guard.mjs";
import { ChromeDriver, findBrowser } from "../lib/drivers/chrome.mjs";
import { fakePage } from "./fixtures/fake-page.mjs";

test("the check's copy of an adapter cannot like, pass, skip or send; reading works as before", async () => {
  const done = [];
  const real = {
    session: async () => ({ loggedIn: true }), queue: async () => ({ next: ["u_test_001"], done: false }),
    like: async (id) => done.push(["like", id]), pass: async (id) => done.push(["pass", id]),
    skip: async (id) => done.push(["skip", id]), send: async (c, t) => done.push(["send", c, t]),
    count: 1,
  };
  const a = readOnlyAdapter(real);
  assert.deepEqual(CHANGES, ["like", "pass", "skip", "send"]);
  for (const m of CHANGES) assert.throws(() => a[m]("u_test_001", "hi"), (e) => e instanceof ReadOnlyError && e.readOnly && new RegExp(`refused ${m}\\(\\)`).test(e.message));
  assert.deepEqual(done, []);
  assert.deepEqual(await a.queue(), { next: ["u_test_001"], done: false });
  assert.equal(a.count, 1);
  assert.throws(() => { "use strict"; a.like = real.like; }, TypeError, "the methods cannot be put back");
  assert.equal(readOnlyAdapter({ session() {} }).like, undefined, "a method the adapter lacks stays missing");
});

test("in a guarded page every request that could change something is refused before it leaves", async () => {
  const page = fakePage({ routes: (m, u) => (m === "GET" || u.startsWith("https://kindmeet.example/graphql") ? { status: 200, body: { ok: true } } : { status: 200, body: { liked: true } }) });
  const d = readOnlyBrowser(page.driver, { postReads: ["https://kindmeet.example/graphql"] });
  const run = (js) => d.evaluate(js);
  assert.deepEqual(await run(`fetch("/api/people/u_test_001").then((r) => r.json())`), { ok: true }, "a read goes through");
  await assert.rejects(run(`fetch("/api/people/u_test_001/like", { method: "POST", body: "{}" })`), /The check is read-only, so it refused POST https:\/\/kindmeet\.example\/api\/people\/u_test_001\/like\./);
  await assert.rejects(run(`fetch("/api/people/u_test_001", { method: "delete" })`), /refused DELETE/);
  await assert.rejects(run(`fetch(new Request("/api/like", { method: "POST" }))`), /refused POST/);
  assert.deepEqual(await run(`fetch("/graphql", { method: "POST", body: JSON.stringify({ query: "query Profile { person { name } }" }) }).then((r) => r.json())`), { ok: true }, "a GraphQL read the site.json lists goes through");
  await assert.rejects(run(`fetch("/graphql", { method: "POST", body: JSON.stringify({ query: "mutation Like { like(id: 1) }" }) })`), /refused POST/, "never a mutation");
  await assert.rejects(run(`fetch("/graphql-other", { method: "POST", body: "query { x }" })`), /refused POST/, "only the listed addresses");
  await assert.rejects(run(`(() => { const x = new XMLHttpRequest(); x.open("POST", "/api/send"); x.send("hi"); })()`), /refused POST https:\/\/kindmeet\.example\/api\/send/);
  await assert.rejects(run(`new WebSocket("wss://x").send("hello")`), /refused a WebSocket message/);
  await assert.rejects(run(`new HTMLFormElement().submit()`), /refused a form/);
  assert.equal(await run(`navigator.sendBeacon("/track", "x")`), false);
  assert.deepEqual(page.changes.map((c) => `${c.method} ${c.url} ${c.body}`), ['POST https://kindmeet.example/graphql {"query":"query Profile { person { name } }"}'], "only the listed GraphQL read went out");
  const refused = await page.driver.evaluate(REFUSED_SCRIPT);
  assert.ok(refused.length >= 8, refused.join("; "));
  assert.ok(page.scripts.filter((s) => s.js === pageGuard(["https://kindmeet.example/graphql"])).every((s) => s.attempts === 1));
});

test("the guard comes back after every new page", async () => {
  const page = fakePage({ routes: () => ({ status: 200, body: {} }) });
  const d = readOnlyBrowser(page.driver);
  await d.goto("https://kindmeet.example/people/u_test_002");
  await assert.rejects(d.evaluate(`fetch("/api/like", { method: "POST" })`), /read-only/);
  assert.deepEqual(page.changes, []);
});

test("an offline check has no browser: an adapter that reaches for it while being made is found out", () => {
  const d = offlineDriver("browser");
  assert.throws(() => d.goto("https://kindmeet.example"), /an offline check has no browser \(the adapter called goto\(\)\)/);
  assert.throws(() => offlineDriver("android").dump(), /no emulator/);
  assert.equal(d.then, undefined, "it is not mistaken for a promise");
});

test("labels that mark a button that changes something", () => {
  assert.equal(actionWord("Like"), "like");
  assert.equal(actionWord("", "Super Like"), "super like");
  assert.equal(actionWord("com.example.dating:id/pass_button"), "pass");
  assert.equal(actionWord("Send message"), "send");
  assert.equal(actionWord("Nope"), "nope");
  assert.equal(actionWord("Likes"), null, "the tab of people who liked you is a read");
  assert.equal(actionWord("Messages"), null);
  assert.equal(actionWord("Mara, 27", "com.example.dating:id/card_name"), null);
  assert.equal(actionWord("com.example.likeapp:id/card_name"), null, "the app's own name does not count");
});

const exe = findBrowser();
test("in a real browser, the guarded page refuses a change and lets a read through", { skip: exe ? false : "no Chrome or Edge on this machine" }, async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-guard-"));
  const raw = new ChromeDriver({ profileDir, headless: true, keepOpen: false });
  try {
    const d = readOnlyBrowser(raw);
    await d.goto("data:text/html,<p>Kind Meet test page</p>");
    assert.equal(await d.evaluate(`fetch("data:text/plain,hello").then((r) => r.text())`), "hello");
    await assert.rejects(d.evaluate(`fetch("https://kindmeet.example/api/like", { method: "POST", body: "{}" })`), /The check is read-only, so it refused POST https:\/\/kindmeet\.example\/api\/like\./);
    assert.deepEqual(await raw.evaluate(REFUSED_SCRIPT), ["POST https://kindmeet.example/api/like"]);
  } finally {
    await raw.close();
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
