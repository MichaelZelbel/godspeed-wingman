// The setup wizard on the desk page, in a real Chrome or Edge without a window: a new install (the
// installer's blank preferences page) goes straight to the starters, a page of one's own is offered
// to keep, and the model question explains how to get Codex when neither Claude Code nor Codex is
// found, then finds it with Look again. Skipped when no Chrome or Edge is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChromeDriver, findBrowser } from "../lib/drivers/chrome.mjs";
import { startDesk } from "../lib/desk/server.mjs";
import { deskSecret } from "../lib/desk/secret.mjs";
import { statePaths } from "../lib/core/paths.mjs";
import { PREFERENCES_TEMPLATE } from "../lib/core/preferences.mjs";
import { CODEX_INSTALL } from "../lib/onboarding/index.mjs";
import { tempMc } from "./helpers.mjs";

const exe = findBrowser();
const skip = exe ? false : "no Chrome or Edge on this machine";

// Waits in the page until `check` (a function body returning a value) gives something truthy.
const until = (d, check, what) => d.evaluate(`new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function tick() {
    let v = null;
    try { v = (() => { ${check} })(); } catch { v = null; }
    if (v) return resolve(v);
    if (Date.now() - t0 > 15000) return reject(new Error(${JSON.stringify(`waited in vain for ${what}`)}));
    setTimeout(tick, 50);
  })();
})`, { attempts: 1 });

const where = (d) => d.evaluate(`({
  step: document.querySelector(".wiz-step")?.textContent || "",
  title: document.querySelector("#wiz-title")?.textContent || "",
  text: document.querySelector(".wiz-content")?.innerText || "",
})`, { attempts: 1 });

// Continue, and wait for the next page of the wizard.
async function next(d) {
  const before = (await where(d)).title;
  await d.evaluate(`document.querySelector(".wiz-foot .btn.primary").click()`, { attempts: 1 });
  await until(d, `const t = document.querySelector("#wiz-title")?.textContent; return t && t !== ${JSON.stringify(before)} ? t : null;`, `the page after "${before}"`);
  return where(d);
}

test("the desk's wizard: a new install starts from the starters; a page of one's own is offered to keep; Godspeed connection is explained and found", { skip, timeout: 120000 }, async () => {
  const { mc, state } = tempMc({ onboarded: false });
  const prefs = path.join(mc, "routines", "wingman", "preferences.md");
  fs.writeFileSync(prefs, PREFERENCES_TEMPLATE);
  let codex = false;
  const detect = async () => ({
    desktop: true, platform: process.platform,
    sites: [{ id: "flirtual", name: "Flirtual", builtin: true, kind: "browser", ok: true, why: "", login_url: "https://flirtu.al/login", about: "" }],
    lanes: [
      { lane: "godspeed", label: "Use Godspeed connection", found: codex, where: codex ? "existing Godspeed connection" : "", name: "" },
      { lane: "claude", label: "Claude Code", found: false, where: "", name: "sonnet" },
      { lane: "codex", label: "Codex", found: codex, where: codex ? "the place its installer chose" : "", name: "" },
      { lane: "openai", label: "An OpenAI-compatible service", found: false, where: "no key in OPENAI_API_KEY", name: "" },
    ],
    telegram: { found: false, file: "" }, assistant: { hermes: false, claude: false }, notifications: { ok: false, how: "not in a test" }, timezone: "UTC", notebook: { found: false },
  });
  const desk = await startDesk({ mcDir: mc, stateDir: state, port: 0, deps: { detect } });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wingman-wizard-chrome-"));
  const d = new ChromeDriver({ profileDir, headless: true, keepOpen: false });
  const url = `http://127.0.0.1:${desk.port}/?t=${deskSecret(statePaths(state))}#setup`;
  try {
    await d.goto(url);
    await until(d, `return document.querySelector(".wiz-step")`, "the wizard");
    let w = await where(d);
    assert.equal(w.step, "Step 1 of 12");
    w = await next(d);
    assert.equal(w.step, "Step 2 of 12", "the blank page counts as no page: all twelve steps");
    w = await next(d);
    assert.equal(w.title, "You, and who you are looking for");
    assert.doesNotMatch(w.text, /You already have a preferences page/);
    assert.match(w.text, /Who are you, in a few words\?/, "the questions, not a choice to keep an empty page");
    w = await next(d);
    assert.equal(w.title, "Pick a starting point");
    assert.equal(w.step, "Step 4 of 12");

    // On to the model question: nothing found, so it says how to get Codex.
    for (let i = 0; i < 12 && w.title !== "Your existing AI connection"; i++) w = await next(d);
    assert.equal(w.title, "Your existing AI connection");
    assert.match(w.text, /uses Godspeed's existing AI connection/);
    assert.equal(await d.evaluate(`document.querySelector("#codex-install")`), null, "no new subscription or CLI install is requested");
    codex = true;
    await d.evaluate(`document.querySelector("#look-again").click()`, { attempts: 1 });
    await until(d, `return !document.querySelector("#model-help") && document.querySelector("#wiz-title")?.textContent === "Your existing AI connection"`, "the help to go once Codex is there");
    assert.equal(await d.evaluate(`document.querySelector('input[name=lane][value=godspeed]').checked`), true, "Godspeed remains the default");
    assert.match((await where(d)).text, /Found: existing Godspeed connection/);

    // A page with one real line: the wizard offers to keep it, and the three starter steps go.
    fs.writeFileSync(prefs, PREFERENCES_TEMPLATE.replace("## Who fits\n", "## Who fits\n\n- Someone kind.\n"));
    await d.evaluate(`sessionStorage.clear()`, { attempts: 1 });
    await d.goto(`http://127.0.0.1:${desk.port}/?r=2#setup`);
    await until(d, `return document.querySelector(".wiz-step")?.textContent === "Step 1 of 9"`, "the wizard with a page of one's own");
    w = await next(d);
    assert.equal(w.step, "Step 2 of 9");
    w = await next(d);
    assert.match(w.text, /You already have a preferences page/);
    assert.equal(await d.evaluate(`[...document.querySelectorAll('input[name=mode]')].map((x) => x.checked).join()`), "true,false", "Keep mine is chosen");
  } finally {
    await d.close();
    await desk.close();
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
