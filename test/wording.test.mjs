// What every file of this public repository must never hold: words that assume who the owner is
// or whom they like, em dashes in text a person reads, private network addresses, e-mail
// addresses, or a dating site's real profile ids. (The full check of every commit for private data
// is done before anything is published; this test keeps the obvious from coming back.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAMES = path.join(ROOT, "lib", "sites", "flirtual", "names.json");
function files(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if ([".git", "node_modules"].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const text = (f) => fs.readFileSync(f, "utf8");
const all = files().filter((f) => f !== NAMES && /\.(mjs|js|py|md|json|yaml|yml|txt|ps1|sh|html|css)$|^[^.]+$/.test(path.basename(f)));

test("the program, the recipe and the plugin speak of 'the person', 'they' and 'you', never he or she", () => {
  const bad = [];
  for (const f of all.filter((x) => /^(lib|bin|skill|hermes)\//.test(rel(x)) || rel(x) === "README.md")) {
    text(f).split(/\r?\n/).forEach((line, i) => {
      const m = line.match(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
      if (m) bad.push(`${rel(f)}:${i + 1}: ${m[0]}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test("no em dash in anything a person reads", () => {
  const bad = [];
  for (const f of all) {
    const r = rel(f);
    const prose = /\.(md|yaml|yml|txt)$/.test(r) || r === "package.json";
    text(f).split(/\r?\n/).forEach((line, i) => {
      if (!line.includes("—")) return;
      // In code, only the patterns that take em dashes out of a model's answer may hold one.
      if (!prose && /\[—–―\]/.test(line)) return;
      if (/^test\//.test(r)) return;
      bad.push(`${r}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test("no private network address, no e-mail address, no fixed home of one machine", () => {
  const bad = [];
  for (const f of all) {
    const t = text(f);
    for (const m of t.matchAll(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g)) bad.push(`${rel(f)}: ${m[0]}`);
    for (const m of t.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g)) if (!/noreply@|@openai\/|@anthropic-ai\/|@x\//.test(m[0])) bad.push(`${rel(f)}: ${m[0]}`);
    // One machine's assistant account, written so that this line does not match itself.
    const fixedHome = new RegExp(`${["", "home", "hermes"].join("/")}(?![\\w-])`);
    if (fixedHome.test(t)) bad.push(`${rel(f)}: a fixed home folder`);
  }
  assert.deepEqual(bad, []);
});

test("every Flirtual-style id in the repository is one of Flirtual's public word-list ids, never a person's", () => {
  const known = new Set(Object.values(JSON.parse(text(NAMES))).filter((v) => v && typeof v === "object").flatMap((o) => Object.keys(o)));
  const bad = [];
  for (const f of all) {
    for (const m of text(f).matchAll(/(?<![A-Za-z0-9_-])[1-9A-HJ-NP-Za-km-z]{22}(?![A-Za-z0-9_-])/g)) {
      if (!known.has(m[0]) && /\d/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0])) bad.push(`${rel(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the package says what it is: godspeed-wingman 0.5.1, public, MIT, Node 22, no dependencies", () => {
  const pkg = JSON.parse(text(path.join(ROOT, "package.json")));
  assert.equal(pkg.name, "godspeed-wingman");
  assert.equal(pkg.version, "0.5.1");
  assert.equal(pkg.private, false);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.engines.node, ">=22");
  assert.equal(pkg.dependencies, undefined, "zero runtime dependencies");
  assert.equal(pkg.repository.url, "git+https://github.com/MichaelZelbel/godspeed-wingman.git");
  assert.deepEqual(pkg.bin, { "godspeed-wingman": "bin/godspeed-wingman.mjs" });
  assert.match(text(path.join(ROOT, "hermes", "plugin", "godspeed-wingman", "plugin.yaml")), /^version: "0\.5\.1"$/m);
});
