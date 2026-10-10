// The watch list: names that stop everything. When a profile carries one of them, nothing is liked
// or passed until the owner has seen it and said what to do. One name per line in
// routines/wingman/watch.md, written as a list item ("- Robin"); everything else in the file is
// free text for the owner.
import fs from "node:fs";

export function readWatch(file) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    const name = m[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// The fields a watch name is looked for in: the name, every other name the site shows (a VRChat
// name, a page name), the Discord name, then the bio.
export function watchFields(profile) {
  return [
    ["name", profile?.name],
    ...Object.entries(profile?.handles || {}),
    ["Discord", typeof profile?.contact?.discord === "string" ? profile.contact.discord : null],
    ["bio", profile?.bio],
  ];
}

// A watch name matches as a whole word, so "Robin" finds "Robin", "robin_vr" and "Lady Robin", but
// "Rob" does not find "Robin". The bio counts too: someone who writes the name is worth a look.
export function matchWatch(names, profile) {
  const fields = watchFields(profile);
  for (const watched of names) {
    const w = norm(watched).trim();
    if (!w) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");
    for (const [label, value] of fields) {
      if (typeof value === "string" && value && re.test(norm(value))) return { name: watched, field: label };
    }
  }
  return null;
}

export function addWatch(file, name) {
  const names = readWatch(file);
  if (names.some((n) => n.toLowerCase() === name.trim().toLowerCase())) return false;
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { text = WATCH_TEMPLATE; }
  if (text && !text.endsWith("\n")) text += "\n";
  fs.writeFileSync(file, `${text}- ${name.trim()}\n`);
  return true;
}

export function removeWatch(file, name) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return false; }
  const lines = text.split(/\r?\n/);
  const want = name.trim().toLowerCase();
  const kept = lines.filter((l) => { const m = l.match(/^\s*[-*]\s+(.+?)\s*$/); return !(m && m[1].replace(/\s+#.*$/, "").trim().toLowerCase() === want); });
  if (kept.length === lines.length) return false;
  fs.writeFileSync(file, kept.join("\n"));
  return true;
}

export const WATCH_TEMPLATE = `# Watch list

When a profile carries one of these names (their name, another name they go by on the site, their
Discord name, or a word in their bio), the Wingman stops before liking or passing and shows them
to you first. One name per line, like this:

`;
