// The blank preferences page the installer writes is not a page of the person's own: both setup
// wizards then start from the starters, and saving simply replaces it. A page with one real line is
// the person's own and is kept unless they say otherwise. Everyone here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PREFERENCES_TEMPLATE, isBlankPreferences, isOwnPreferences, readOwnPreferences } from "../lib/core/preferences.mjs";
import { PREFERENCES_TEMPLATE as FROM_SETUP, plan, stepRoutine } from "../lib/setup/index.mjs";
import { apply, renderPreferences, cleanAnswers } from "../lib/onboarding/index.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { tempMc } from "./helpers.mjs";

const SYS = { env: {}, platform: "linux", root: false };
const quietly = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

test("the installer's blank page, in any wrapping, counts as no page yet", () => {
  assert.equal(FROM_SETUP, PREFERENCES_TEMPLATE, "the setup writes the very page the test knows");
  for (const [why, text] of Object.entries({
    "the template itself": PREFERENCES_TEMPLATE,
    "with Windows line ends": PREFERENCES_TEMPLATE.replace(/\n/g, "\r\n"),
    "the hint wrapped differently": PREFERENCES_TEMPLATE.replace("The Wingman goes by this page and by your practice\nanswers", "The Wingman goes by this page\nand by your practice answers"),
    "extra blank lines and spaces": PREFERENCES_TEMPLATE.replace(/\n\n/g, "\n\n\n  \n"),
    "an empty file": "",
    "only spaces": "  \n\n ",
    "no file at all": null,
    "an empty Added later heading": `${PREFERENCES_TEMPLATE}\n## Added later\n`,
  })) {
    assert.equal(isBlankPreferences(text), true, why);
    assert.equal(isOwnPreferences(text), false, why);
  }
});

test("a page with one real line is the person's own", () => {
  const one = PREFERENCES_TEMPLATE.replace("## Who fits\n", "## Who fits\n\n- Someone kind.\n");
  const pages = {
    "one real line under a heading": one,
    "a line added with prefs add": `${PREFERENCES_TEMPLATE}\n## Added later\n\n- 2026-10-10: no smokers.\n`,
    "the hint changed by hand": PREFERENCES_TEMPLATE.replace("Plain sentences work best.", "Plain sentences work best. I like people who build worlds."),
    "a heading of their own": `${PREFERENCES_TEMPLATE}\n## Dealbreakers\n`,
    "a page written in a test mission control": "# Who I am looking for\n\nPeople who play VRChat.\n\n## How I write\nShort and playful.\n",
    "a starter written by an earlier setup": renderPreferences("just-exploring", cleanAnswers({ sites: ["flirtual"] })),
  };
  for (const [why, text] of Object.entries(pages)) {
    assert.equal(isOwnPreferences(text), true, why);
    assert.equal(isBlankPreferences(text), false, why);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-prefs-"));
  const file = path.join(dir, "preferences.md");
  assert.equal(readOwnPreferences(file), null, "no file");
  fs.writeFileSync(file, PREFERENCES_TEMPLATE);
  assert.equal(readOwnPreferences(file), null, "the blank page");
  fs.writeFileSync(file, one);
  assert.equal(readOwnPreferences(file), one, "a page of their own, word for word");
});

test("a new install: saving the setup replaces the blank page with the starter, whatever the mode, and keeps no copy", async () => {
  for (const mode of ["keep", "starter", undefined]) {
    const { mc, state } = tempMc({ onboarded: false });
    const file = path.join(mc, "routines", "wingman", "preferences.md");
    fs.rmSync(file);
    quietly(() => stepRoutine(plan({ godspeed: mc, state }, SYS), {}));
    assert.equal(fs.readFileSync(file, "utf8"), PREFERENCES_TEMPLATE, "the installer wrote its blank page");
    const answers = { sites: ["flirtual"], me: "a person in my thirties", looking_for: ["anyone"], starter: "looking-for-a-partner", talk: ["desk"] };
    const r = await apply({ mcDir: mc, stateDir: state, answers, ...(mode ? { mode } : {}), sys: SYS });
    assert.equal(r.prefs, "written", String(mode));
    assert.equal(r.backup, null, "nothing of the person's was in it, so no copy");
    const now = fs.readFileSync(file, "utf8");
    assert.equal(now, renderPreferences("looking-for-a-partner", cleanAnswers(answers)));
    assert.match(now, /I am a person in my thirties, and I am looking for anyone who fits/);
    assert.ok(r.written.includes(file), "and it is saved in mission control's history");
    const desk = statePaths(state).desk;
    assert.ok(!fs.existsSync(desk) || !fs.readdirSync(desk).some((n) => n.startsWith("preferences-before-")), "no copy of the blank page");
  }
});

test("the blank page with the text the person saw in the last look: that text is written", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const file = path.join(mc, "routines", "wingman", "preferences.md");
  fs.writeFileSync(file, PREFERENCES_TEMPLATE);
  const r = await apply({ mcDir: mc, stateDir: state, answers: { sites: ["flirtual"], talk: ["desk"] }, mode: "keep", text: "# Mine\n\n- Someone who builds worlds.\n", sys: SYS });
  assert.equal(r.prefs, "written");
  assert.equal(r.backup, null);
  assert.equal(fs.readFileSync(file, "utf8"), "# Mine\n\n- Someone who builds worlds.\n");
});

test("a page with one real line keeps today's behaviour: kept unless the person picks a starter", async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const file = path.join(mc, "routines", "wingman", "preferences.md");
  const one = PREFERENCES_TEMPLATE.replace("## Who fits\n", "## Who fits\n\n- Someone kind.\n");
  fs.writeFileSync(file, one);
  const answers = { sites: ["flirtual"], starter: "friends-first", talk: ["desk"] };
  let r = await apply({ mcDir: mc, stateDir: state, answers, mode: "keep", sys: SYS });
  assert.equal(r.prefs, "kept");
  assert.equal(fs.readFileSync(file, "utf8"), one, "not one byte changed");
  r = await apply({ mcDir: mc, stateDir: state, answers, mode: "starter", sys: SYS });
  assert.equal(r.prefs, "replaced");
  assert.equal(fs.readFileSync(r.backup, "utf8"), one, "their line waits in the private folder");
});
