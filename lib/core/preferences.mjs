// The preferences page (routines/wingman/preferences.md): the blank page the installer writes, and
// the one test both setup wizards use to tell that blank page from a page the person wrote.
//
//   PREFERENCES_TEMPLATE      what the installer writes when there is no page yet
//   isBlankPreferences(text)  true for no text, an empty file, or a page that holds nothing but the
//                             template's own headings and hint lines (in any wrapping)
//   isOwnPreferences(text)    a page with at least one real line of the person's (or of an
//                             earlier setup): the wizards offer to keep it
import fs from "node:fs";

export const PREFERENCES_TEMPLATE = `# Who I am looking for

Write in your own words who you want to meet. The Wingman goes by this page and by your practice
answers whenever it likes or passes. Plain sentences work best.

## Who fits

## Who does not fit

## How to judge

## How I write

(How your messages sound. Used only for reply ideas, never for picking.)
`;

const words = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

// The template taken apart: its headings, and its hint paragraphs as plain words. Read from the
// template itself, so a changed template changes the test with it. "## Added later" is the
// heading `prefs add` puts in; on its own it says nothing.
function templateParts(template = PREFERENCES_TEMPLATE) {
  const headings = new Set(["## added later"]);
  const hints = [];
  for (const block of template.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of lines.filter((x) => x.startsWith("#"))) headings.add(words(l));
    const rest = lines.filter((x) => !x.startsWith("#"));
    if (rest.length) hints.push(words(rest.join(" ")));
  }
  return { headings, hints };
}
const PARTS = templateParts();

export function isBlankPreferences(text, parts = PARTS) {
  if (typeof text !== "string") return true;
  const kept = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l && !parts.headings.has(words(l)));
  let rest = words(kept.join(" "));
  for (const hint of parts.hints) rest = rest.split(hint).join(" ");
  return rest.trim() === "";
}

export const isOwnPreferences = (text) => typeof text === "string" && !isBlankPreferences(text);

// The page in this file when it is the person's own, else null (no file, or the blank page).
export function readOwnPreferences(file) {
  let text = null;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  return isOwnPreferences(text) ? text : null;
}
