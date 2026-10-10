// Where the Wingman talks: every chosen channel gets each message, "delivered" means at least one
// took it, a broken or missing channel never stops the others.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { tell, readiness } from "../lib/channels/index.mjs";
import * as desk from "../lib/channels/desk.mjs";
import * as telegram from "../lib/channels/telegram.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { readJsonl } from "../lib/core/store.mjs";
import { makeWorker, user } from "./helpers.mjs";

const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("one message fans out to every chosen channel; delivered when at least one took it", async () => {
  const got = { a: [], b: [] };
  const settings = { talk: ["desk", "telegram"] };
  const impls = {
    desk: async ({ text }) => { got.a.push(text); return true; },
    telegram: async ({ text }) => { got.b.push(text); return true; },
  };
  let r = await tell("hello", null, { settings, impls });
  assert.equal(r.delivered, true);
  assert.deepEqual(r.results, { desk: "ok", telegram: "ok" });
  assert.deepEqual([got.a, got.b], [["hello"], ["hello"]], "both got it");
  impls.telegram = async () => { throw new Error("Telegram sendMessage refused: Unauthorized"); };
  const lines = [];
  r = await tell("again", null, { settings, impls, log: (l) => lines.push(l) });
  assert.equal(r.delivered, true, "the desk took it");
  assert.match(r.results.telegram, /Unauthorized/);
  assert.match(lines.join("\n"), /talk: telegram did not take the message/);
  impls.desk = async () => false;
  r = await tell("nobody", null, { settings, impls });
  assert.equal(r.delivered, false, "no channel took it: the worker tries again later");
});

test("a channel this version does not have is said once and skipped; the others still get every message", async () => {
  const lines = [];
  const settings = { talk: ["desktop", "desk"] };
  const paths = statePaths(temp("wingman-ch-"));
  const desktopFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "lib", "channels", "desktop.mjs");
  const hasDesktop = fs.existsSync(desktopFile);
  const impls = hasDesktop ? { desktop: async () => true } : {};
  const r1 = await tell("first", null, { settings, paths, log: (l) => lines.push(l), impls });
  const r2 = await tell("second", null, { settings, paths, log: (l) => lines.push(l), impls });
  assert.equal(r1.delivered && r2.delivered, true);
  if (!hasDesktop) {
    assert.equal(r1.results.desktop, "not available");
    assert.equal(lines.filter((l) => /desktop.*not part of this version/.test(l)).length, 1, "said once");
  }
  assert.deepEqual(readJsonl(desk.inboxFile(paths)).map((m) => m.text), ["first", "second"]);
});

test("the desk keeps each message in its inbox in the private folder, with the picture's place", async () => {
  const paths = statePaths(temp("wingman-desk-"));
  assert.equal(await desk.send({ text: "From your Wingman: hi", picture: "C:/x.jpg", paths, now: new Date("2026-10-03T10:00:00Z") }), true);
  const [m] = readJsonl(desk.inboxFile(paths));
  assert.equal(m.text, "From your Wingman: hi");
  assert.equal(m.picture, "C:/x.jpg");
  assert.equal(m.at, "2026-10-03T10:00:00.000Z");
  assert.match(m.id, /^\d+-[0-9a-f]{6}$/);
  assert.deepEqual(desk.ready({ paths, settings: { desk_port: 47860 } }), { ok: true, why: "messages wait on the desk page (http://127.0.0.1:47860/)" });
});

test("Telegram's token and chat come from a Hermes .env; the home channel first, else the one allowed user", () => {
  const dir = temp("wingman-tg-");
  const f = path.join(dir, ".hermes", ".env");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_ALLOWED_USERS=4242\n");
  assert.deepEqual(telegram.credentials(f), { token: "123:abc", chat: "4242" });
  fs.writeFileSync(f, "export TELEGRAM_BOT_TOKEN=\"123:abc\"\nTELEGRAM_HOME_CHANNEL=-100777\nTELEGRAM_ALLOWED_USERS=1,2\n");
  assert.deepEqual(telegram.credentials(f), { token: "123:abc", chat: "-100777" });
  fs.writeFileSync(f, "TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_ALLOWED_USERS=1,2\n");
  assert.equal(telegram.credentials(f), null, "two allowed users and no home channel: unknown where to send");
});

test("the Hermes .env is found by itself: HERMES_HOME, Godspeed's Windows Hermes, Hermes on Windows, ~/.hermes and its profiles", () => {
  const home = temp("wingman-home-");
  const local = path.join(home, "AppData", "Local");
  const make = (f, token = true) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, token ? "TELEGRAM_BOT_TOKEN=1:a\nTELEGRAM_HOME_CHANNEL=9\n" : "OTHER=1\n"); return f; };
  const profile = make(path.join(home, ".hermes", "profiles", "work", ".env"));
  make(path.join(home, ".hermes", ".env"), false);
  assert.equal(telegram.resolveEnvFile("", { env: {}, platform: "linux", home }), profile, "the first .env with a bot");
  const godspeed = make(path.join(local, "Godspeed Mission Control Full Alpha State", "hermes-profile", ".env"));
  assert.equal(telegram.resolveEnvFile("", { env: { LOCALAPPDATA: local }, platform: "win32", home }), godspeed);
  const chosen = make(path.join(home, "elsewhere", "hermes", ".env"));
  assert.equal(telegram.resolveEnvFile("", { env: { HERMES_HOME: path.dirname(chosen), LOCALAPPDATA: local }, platform: "win32", home }), chosen);
  assert.equal(telegram.resolveEnvFile(profile, { env: {}, platform: "linux", home }), profile, "the settings' choice wins");
  assert.equal(telegram.resolveEnvFile("", { env: {}, platform: "linux", home: temp("wingman-none-") }), null);
});

test("the Telegram channel sends to the chat through the bot (a pretend Telegram, in test mode only)", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => { seen.push({ url: req.url, body }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, result: { message_id: 7 } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = temp("wingman-tgs-");
  const f = path.join(dir, ".hermes", ".env");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "TELEGRAM_BOT_TOKEN=55:xyz\nTELEGRAM_HOME_CHANNEL=314\n");
  const before = { api: process.env.GODSPEED_WINGMAN_TELEGRAM_API, test: process.env.GODSPEED_WINGMAN_TEST };
  try {
    process.env.GODSPEED_WINGMAN_TELEGRAM_API = `http://127.0.0.1:${server.address().port}`;
    delete process.env.GODSPEED_WINGMAN_TEST;
    await assert.rejects(telegram.send({ text: "x", settings: { telegram_env: f } }), /only honoured in test mode/);
    process.env.GODSPEED_WINGMAN_TEST = "1";
    assert.equal(await telegram.send({ text: "From your Wingman: hello", settings: { telegram_env: f } }), true);
    assert.equal(seen[0].url, "/bot55:xyz/sendMessage");
    assert.deepEqual(JSON.parse(seen[0].body), { chat_id: "314", text: "From your Wingman: hello", disable_web_page_preview: true });
    assert.deepEqual(telegram.ready({ settings: { telegram_env: f } }).ok, true);
  } finally {
    for (const [k, v] of [["GODSPEED_WINGMAN_TELEGRAM_API", before.api], ["GODSPEED_WINGMAN_TEST", before.test]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    server.close();
  }
});

test("without a test stand-in, the worker talks through the chosen channels", async () => {
  const h = makeWorker([user("a1", "Mara")], { settings: { talk: ["desk"] } });
  delete h.w.deps.tell;
  await h.w.tick();
  const [m] = readJsonl(desk.inboxFile(h.w.paths));
  assert.match(m.text, /^From your Wingman: practice\. Mara/);
  assert.ok(h.w.state.waiting.notifiedAt, "the desk took it, so the question counts as delivered");
  const lines = await readiness({ talk: ["desk"], desk_port: 47860 }, h.w.paths);
  assert.equal(lines[0].ok, true);
});
