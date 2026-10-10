import test from "node:test";
import assert from "node:assert/strict";
import { normalize, digest, groupAttributes, htmlToText } from "../lib/sites/flirtual/profile.mjs";
import { matchWatch } from "../lib/core/watch.mjs";
import { parseVerdict, buildPrompt, systemFor } from "../lib/core/judge.mjs";
import { parseOptions, howYouWrite, needs } from "../lib/core/replies.mjs";
import { readAnswer } from "../lib/core/training.mjs";
import { firstJson } from "../lib/core/model.mjs";
import { normQueue } from "../lib/sites/flirtual/api.mjs";
import { plainDigest } from "../lib/core/worker.mjs";
import { IDS, user } from "./helpers.mjs";

test("a profile reads like the page: pronouns apart from gender, bio as text, the common shape", () => {
  const p = normalize(user("a1", "Mara"), new Date("2026-10-03T00:00:00Z"));
  assert.equal(p.gender, "Cis Woman");
  assert.equal(p.pronouns, "She/Her");
  assert.equal(p.fields.Sexuality, "Straight");
  assert.equal(p.fields.Games, "VRChat");
  assert.equal(p.fields["VR setup"], "Meta Quest, Full-body tracking");
  assert.equal(p.age, 26);
  assert.equal(p.bio, "Hi, I am Mara.");
  assert.equal(p.url, "https://flirtu.al/a1");
  assert.equal(p.site, "flirtual");
  assert.deepEqual(p.handles, { "VRChat name": "MaraVR", "page name": "mara" });
  assert.ok(p.raw, "the site's own data travels along for the archive");
  const d = digest(p);
  assert.match(d, /Gender they ticked: Cis Woman/);
  assert.match(d, /Dominant\/submissive: submissive/);
  assert.doesNotMatch(d, /\b(she|her|he|his|him)\b/, "the labels assume nobody");
});

test("attributes arrive grouped, as a flat list, or as objects", () => {
  assert.deepEqual(groupAttributes([IDS.woman, IDS.heHim]).gender, ["Woman", "He/Him"]);
  assert.deepEqual(groupAttributes([{ id: IDS.lesbian, type: "sexuality" }]).sexuality, ["Lesbian"]);
  assert.deepEqual(groupAttributes({ platform: [IDS.fbt] }).platform, ["Full-body tracking"]);
  assert.deepEqual(groupAttributes({ gender: ["unknown-id"] }).gender, []);
});

test("bio html becomes plain text", () => {
  assert.equal(htmlToText("<p>Hi&nbsp;there</p><p>line<br>two &amp; more</p>"), "Hi there\nline\ntwo & more");
});

test("watch names match whole words in names, other names, Discord and bio, not parts of other names", () => {
  const p = { name: "Lady Tamsin", handles: { "VRChat name": null }, contact: { discord: "x" }, bio: "" };
  assert.deepEqual(matchWatch(["Tamsin"], p), { name: "Tamsin", field: "name" });
  assert.equal(matchWatch(["Sin"], p), null);
  assert.deepEqual(matchWatch(["tamsin"], { name: "A", contact: { discord: "tamsin_vr" }, bio: "" }), { name: "tamsin", field: "Discord" });
  assert.deepEqual(matchWatch(["Tamsin"], { name: "A", bio: "my friend Tamsin says hi" }), { name: "Tamsin", field: "bio" });
  assert.deepEqual(matchWatch(["tamsinvr"], { name: "A", handles: { "VRChat name": "TamsinVR" } }), { name: "tamsinvr", field: "VRChat name" });
});

test("verdicts are read from prose-wrapped JSON and lose their em dashes", () => {
  const v = parseVerdict('Here you go:\n```json\n{"weighing":"a","verdict":"PASS","sure":"low","reason":"Only looking for friends — not a match."}\n```');
  assert.deepEqual({ verdict: v.verdict, sure: v.sure, reason: v.reason }, { verdict: "pass", sure: "low", reason: "Only looking for friends, not a match." });
  assert.equal(parseVerdict('{"verdict":"maybe"}'), null);
  assert.equal(parseVerdict("no json"), null);
});

test("the judge's prompts assume nothing about who the owner is or whom they like", () => {
  const sys = systemFor("Flirtual, a dating site for people who meet in virtual reality");
  assert.match(sys, /on Flirtual, a dating site for people who meet in virtual reality/);
  assert.match(sys, /Assume nothing about the owner or whom they like/);
  assert.doesNotMatch(sys, /\b(she|her|hers|he|him|his|man|woman|women|men|girl|boy)\b/i);
  const prompt = buildPrompt("x", [{ digest: "d", judge: "like", owner: "pass", agreed: false, reason: "too far" }], "profile");
  assert.match(prompt, /The owner said PASS \(a correction\) because: too far/);
  assert.doesNotMatch(prompt, /\b(she|her|he|him|his)\b/i);
});

test("reply options need exactly three, and the owner's style comes only from 'How I write'", () => {
  assert.deepEqual(parseOptions('{"options":["a","b","c","d"]}'), ["a", "b", "c"]);
  assert.equal(parseOptions('{"options":["a","b"]}'), null);
  assert.equal(howYouWrite("# x\n\n## Who fits\nVR people\n\n## How I write\nShort, playful.\n\n## Other\nno"), "Short, playful.");
  assert.equal(howYouWrite("# none"), "");
});

test("only unanswered messages and silent matches need the owner", () => {
  const conv = (id, userId, last) => ({ id, with: { id: userId, name: null }, messages: last ? [last] : [] });
  const n = needs([
    conv("c1", "a", { id: "m1", fromMe: false, text: "hi" }),
    conv("c2", "b", { id: "m2", fromMe: true, text: "yo" }),
    conv("c3", "c", null),
    conv("c4", "d", { id: "m4", fromMe: false, system: true }),
    conv("c5", "e", { id: "m5", fromMe: false, text: "old" }),
  ], { c5: "m5" });
  assert.deepEqual(n.map((x) => [x.conversationId, x.kind]), [["c1", "reply"], ["c3", "opener"], ["c4", "opener"]], "a system message alone is a match nobody wrote in");
  assert.equal(n[0].theirMessage, "hi");
});

test("short answers are understood in English and German", () => {
  for (const a of ["agree", "Yes", "ja", "stimmt", "genau", "👍"]) assert.equal(readAnswer(a), "agree", a);
  for (const a of ["no, they drink", "Nein", "disagree", "stimmt nicht", "👎"]) assert.equal(readAnswer(a), "disagree", a);
  assert.equal(readAnswer("what about tomorrow"), null);
  assert.equal(readAnswer("yesterday was fun"), null, "a word that only starts like yes");
});

test("first JSON block survives braces inside strings", () => {
  assert.deepEqual(firstJson('x {"a":"b } c","n":{"m":1}} y'), { a: "b } c", n: { m: 1 } });
});

test("the queue reads snake_case and camelCase alike", () => {
  assert.deepEqual(normQueue({ next: ["a"], can_undo: true, limits: { likes: { used: 1, max: 15 }, reset_at: "t" } }).limits.resetAt, "t");
  assert.equal(normQueue({ next: ["a"], canUndo: true }).canUndo, true);
  assert.deepEqual(normQueue(null).next, []);
});

test("a site without its own digest gets a plain one from the common shape", () => {
  const d = plainDigest({ name: "Kiri", age: 31, country: "nz", gender: "Non-binary", pronouns: "they/them", fields: { "Looking for": "something serious" }, bio: "Loves hiking.", prompts: [{ q: "Best day?", a: "Rain and books" }] });
  assert.equal(d, "Name: Kiri, 31, NZ\nGender: Non-binary\nPronouns: they/them\nLooking for: something serious\nBio:\nLoves hiking.\nBest day?: Rain and books");
});
