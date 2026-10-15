// A session that five errors in a row end is never silent (0.5.4, after 2026-10-15: a crashed
// bridge tab ended the daily session, nothing was liked or passed, and nobody was told). The first
// time on a day the worker tries once more about an hour later; when that one ends the same way,
// or no time is left today, the person hears it once that day, and status and the assistant's
// block show it. Everyone here is invented; the site is the pretend Flirtual from helpers.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorker, user, setMode, settingsFile } from "./helpers.mjs";
import * as requests from "../lib/core/requests.mjs";
import { render } from "../lib/core/context.mjs";
import { loadSettings } from "../lib/core/settings.mjs";
import { plainCause, RETRY_AFTER_MINUTES } from "../lib/core/worker.mjs";
import { nextSession } from "../lib/desk/view.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-wingman.mjs");
const MIN = 60000;
const CRASH = 'bridge /goto answered 500: page.goto: Page crashed\nCall log:\n  - navigating to "https://flirtu.al/en"';

// The tab behind the site crashed: every read of the queue fails. `fix` undoes it.
function crash(fl) {
  const queue = fl.queue.bind(fl);
  fl.queue = async () => { throw new Error(CRASH); };
  return () => { fl.queue = queue; };
}

// Ticks two minutes apart (the worker waits two minutes after an error) until no session runs.
async function untilEnded(h, max = 20) {
  for (let i = 0; i < max; i++) {
    await h.w.tick();
    if (!h.w.state.run) return;
    h.advance(2 * MIN);
  }
  throw new Error("the session did not end");
}

const notices = (told) => told.filter((t) => /session stopped/.test(t.text));
const setup = (users = [user("a1", "Mara"), user("b2", "Juno")], opts = {}) => {
  const h = makeWorker(users, { settings: { browser: "local", ...(opts.settings || {}) }, ...opts });
  setMode(h.w, "auto");
  return h;
};

test("five errors in a row: no message yet, and exactly one fresh session about an hour later", async () => {
  const h = setup();
  crash(h.fl);
  await untilEnded(h);
  const s = h.w.state;
  assert.equal(s.run, null);
  assert.match(s.lastRun.why, /^five errors in a row, the last: bridge \/goto answered 500: page\.goto: Page crashed/);
  assert.equal(s.failure.final, false);
  assert.equal(s.failure.cause, "the browser tab crashed");
  assert.deepEqual(s.failure.retrySites, ["flirtual"]);
  assert.equal(new Date(s.failure.retryAt).getTime() - new Date(s.failure.at).getTime(), RETRY_AFTER_MINUTES * MIN);
  assert.equal(h.told.length, 0, "the first stop of the day is not told: the fresh try may fix it");
  assert.equal(nextSession(s, loadSettings(settingsFile(h.mc)), new Date(s.failure.at)).text, "today at 19:39, once more after errors stopped the last one", "the desk says when");
  h.advance(30 * MIN);
  await h.w.tick();
  assert.equal(h.w.state.run, null, "not before its time");
  h.setNow(s.failure.retryAt);
  await h.w.tick();
  assert.equal(h.w.state.run?.why, "once more, after five errors in a row");
  assert.equal(h.w.state.run.endsAt, s.lastRun.endsAt, "inside the time limit of the session it replaces");
  assert.ok(h.w.state.failure.retryStartedAt);
});

test("when the cause is gone, the fresh session likes and passes and nobody is bothered", async () => {
  const h = setup();
  const fix = crash(h.fl);
  await untilEnded(h);
  fix();
  h.setNow(h.w.state.failure.retryAt);
  await h.w.tick();
  assert.deepEqual(h.fl.responses, [{ type: "like", userId: "a1" }]);
  assert.equal(h.told.length, 0);
});

test("the fresh session ends the same way: the person is told once, in plain words, with the next step", async () => {
  const h = setup([user("a1", "Mara"), user("b2", "Juno"), user("c3", "Kiri")]);
  await h.w.tick(); // 18:31, autopilot likes Mara
  assert.equal(h.fl.responses.length, 1);
  crash(h.fl);
  h.advance(3 * MIN);
  await untilEnded(h);
  h.setNow(h.w.state.failure.retryAt);
  await untilEnded(h);
  const s = h.w.state;
  assert.equal(s.failure.final, true);
  const n = notices(h.told);
  assert.equal(n.length, 1);
  const again = new Date(s.failure.retriedAt).toISOString().slice(11, 16);
  assert.equal(n[0].text, `From your Wingman: Today's session stopped because the browser tab crashed, so nothing was liked or passed after 18:31. A second try at ${again} stopped too. Please ask your assistant to check the Wingman (godspeed-wingman check).`);
  assert.doesNotMatch(n[0].text, /Call log|500|goto|Mara|Juno|Kiri/, "no stack, no route, no name");
  assert.equal(s.failedNoticeDay, "2026-10-03");

  // Another session the same day ends the same way: nothing new reaches the person.
  requests.submit(h.w.paths, "run", {});
  h.advance(10 * MIN);
  await untilEnded(h);
  assert.equal(h.w.state.run, null);
  assert.equal(notices(h.told).length, 1, "never twice the same day");
});

test("no time left today for a fresh session: told at once, and nothing liked today is said so", async () => {
  const h = setup(undefined, { at: "2026-10-03T23:20:00Z" });
  crash(h.fl);
  await untilEnded(h);
  const s = h.w.state;
  assert.equal(s.failure.final, true);
  assert.equal(s.failure.retryStartedAt ?? null, null);
  const n = notices(h.told);
  assert.equal(n.length, 1);
  assert.equal(n[0].text, "From your Wingman: Today's session stopped because the browser tab crashed, so nothing was liked or passed today. Please ask your assistant to check the Wingman (godspeed-wingman check).");
  h.advance(2 * 3600000);
  await h.w.tick();
  assert.equal(h.w.state.run, null, "no fresh session the next morning: the daily one comes at its own time");
});

test("a message no channel took is sent again later the same day, and only once", async () => {
  let up = false;
  const h = setup(undefined, { at: "2026-10-03T23:20:00Z", telegramUp: () => up });
  crash(h.fl);
  await untilEnded(h);
  assert.equal(notices(h.told).length, 0);
  assert.equal(h.w.state.failedNoticeDay, null);
  up = true;
  h.advance(6 * MIN);
  await h.w.tick();
  assert.equal(notices(h.told).length, 1);
  h.advance(6 * MIN);
  await h.w.tick();
  assert.equal(notices(h.told).length, 1);
});

test("paused: no fresh session, and none the next day either", async () => {
  const h = setup();
  crash(h.fl);
  await untilEnded(h);
  requests.submit(h.w.paths, "pause", {});
  await h.w.tick();
  h.setNow(new Date(new Date(h.w.state.failure.retryAt).getTime() + MIN));
  await h.w.tick();
  assert.equal(h.w.state.run, null);
  assert.equal(h.told.length, 0);
  h.setNow("2026-10-04T10:00:00Z");
  requests.submit(h.w.paths, "resume", {});
  await h.w.tick();
  assert.equal(h.w.state.run, null, "the try was for the day it was planned");
});

test("a lost login keeps its own message: no fresh session and no second message about it", async () => {
  const h = setup(undefined, { at: "2026-10-03T10:00:00Z" });
  await h.w.tick();
  assert.equal(h.w.state.sites.flirtual.me, "me123");
  h.fl.loggedIn = false;
  h.setNow("2026-10-03T18:31:00Z");
  await untilEnded(h);
  h.advance(2 * 3600000);
  await h.w.tick();
  assert.equal(h.w.state.failure, null);
  assert.equal(h.told.filter((t) => /logged me out/.test(t.text)).length, 1);
  assert.equal(notices(h.told).length, 0);
});

test("the assistant's block and status show the stop in one short line, without names", async () => {
  const h = setup(undefined, { settings: { browser: "bridge", bridge: "http://127.0.0.1:9" } });
  crash(h.fl);
  await untilEnded(h);
  const set = loadSettings(settingsFile(h.mc));
  const at = new Date(h.w.state.failure.at);
  let out = render(h.w.paths, set, at);
  assert.match(out, /^\[godspeed-wingman\]/);
  assert.match(out, /- SESSION STOPPED at 2026-10-03 18:39 after five errors in a row \(the browser tab behind the bridge crashed\); the Wingman tries once more by itself at 19:39\.$/m);
  h.setNow(h.w.state.failure.retryAt);
  await h.w.tick();
  assert.equal(render(h.w.paths, set, new Date(h.w.state.failure.retryAt)), "", "while the fresh session runs there is nothing to say");
  await untilEnded(h);
  out = render(h.w.paths, set, new Date(h.w.state.failure.at));
  assert.match(out, /- SESSION STOPPED at 2026-10-03 19:47 after five errors in a row \(the browser tab behind the bridge crashed\); a second try at 19:39 stopped too; the person was told\. When they bring it up, run `godspeed-wingman check` and fix what it names\.$/m);
  assert.doesNotMatch(out, /Mara|Juno|Call log|goto/);
  assert.equal(render(h.w.paths, set, new Date(at.getTime() + 2 * 86400000)), "", "old news after a day and a half");

  const st = await new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, "status", "--godspeed", h.mc, "--state", h.state], { env: { ...process.env, GODSPEED_WINGMAN_DIR: "" } });
    let o = "";
    c.stdout.on("data", (d) => { o += d; });
    c.on("close", () => resolve(o.replace(/\r/g, "")));
  });
  assert.match(st, /^Stopped at 2026-10-03 19:47 after five errors in a row: the browser tab behind the bridge crashed\. A second try at 19:39 stopped too\. You were told\. `godspeed-wingman check` shows what failed\.$/m);
});

test("the cause in plain words, never the raw error", () => {
  assert.equal(plainCause(CRASH, { bridge: true }), "the browser tab behind the bridge crashed");
  assert.equal(plainCause("Runtime.evaluate took longer than 45 s"), "the browser stopped answering in time");
  assert.equal(plainCause("the model took longer than 120 s"), "the model that reads the profiles did not answer");
  assert.equal(plainCause("the judge did not answer with a verdict"), "the model that reads the profiles did not answer");
  assert.equal(plainCause("fetch failed", { bridge: true }), "the bridge could not be reached");
  assert.equal(plainCause("bridge /eval answered 500: Cannot connect to Chrome at http://127.0.0.1:9222", { bridge: true }), "the browser behind the bridge kept failing");
  assert.equal(plainCause("the browser is not connected"), "the Wingman's browser could not be reached");
  assert.equal(plainCause("Flirtual /queue answered 503", { site: "Flirtual" }), "Flirtual had trouble on its side");
  assert.equal(plainCause("Flirtual /users/u_test_001 answered 429", { site: "Flirtual" }), "Flirtual asked the Wingman to slow down");
  assert.equal(plainCause("something odd"), "an error kept coming back");
});
