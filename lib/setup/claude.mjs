// Claude Code: a UserPromptSubmit hook in the mission control's .claude/settings.json that prints
// the Wingman's block before every prompt (`godspeed-wingman context --hook claude`). Added only
// when that file exists, and only once.
import fs from "node:fs";
import path from "node:path";

export const HOOK_MATCH = "godspeed-wingman";

export function hookCommand(shLauncher) {
  // Always the sh launcher: Claude Code runs hooks through Git Bash on Windows too, and a .cmd
  // hook would start cmd.exe, which flashes a console window on every prompt.
  return `"${shLauncher.replace(/\\/g, "/")}" context --hook claude`;
}

// The settings text with the hook added, or null when it is already there.
export function mergeHook(text, command) {
  const cfg = text && text.trim() ? JSON.parse(text) : {};
  if (JSON.stringify(cfg.hooks || {}).includes(HOOK_MATCH)) return null;
  cfg.hooks ||= {};
  cfg.hooks.UserPromptSubmit ||= [];
  cfg.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command, timeout: 10 }] });
  return JSON.stringify(cfg, null, 2) + "\n";
}

// The settings text without any of the Wingman's hooks, or null when there was none.
export function removeHookText(text) {
  if (!text || !text.includes(HOOK_MATCH)) return null;
  const cfg = JSON.parse(text);
  const list = cfg.hooks?.UserPromptSubmit;
  if (!Array.isArray(list)) return null;
  const kept = list.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || "").includes(HOOK_MATCH)) })).filter((g) => g.hooks.length);
  if (kept.length === list.length && JSON.stringify(kept) === JSON.stringify(list)) return null;
  if (kept.length) cfg.hooks.UserPromptSubmit = kept; else delete cfg.hooks.UserPromptSubmit;
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  return JSON.stringify(cfg, null, 2) + "\n";
}

export function settingsFile(mcDir) { return path.join(mcDir, ".claude", "settings.json"); }

export function installHook(mcDir, shLauncher) {
  const file = settingsFile(mcDir);
  if (!fs.existsSync(file)) return { ok: true, skipped: true, text: "no .claude/settings.json in mission control, so no Claude Code hook" };
  let merged;
  try { merged = mergeHook(fs.readFileSync(file, "utf8"), hookCommand(shLauncher)); }
  catch { return { ok: false, text: `${file} is not valid JSON; add the hook by hand: {"type":"command","command":${JSON.stringify(hookCommand(shLauncher))}} under hooks.UserPromptSubmit` }; }
  if (merged === null) return { ok: true, text: "Claude Code hook already there" };
  fs.writeFileSync(file, merged);
  return { ok: true, file, text: `Claude Code hook added to ${file}` };
}

export function removeHook(mcDir) {
  const file = settingsFile(mcDir);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return { ok: true, text: "no Claude Code hook to remove" }; }
  let out;
  try { out = removeHookText(text); } catch { return { ok: false, text: `${file} is not valid JSON; remove the godspeed-wingman hook by hand` }; }
  if (out === null) return { ok: true, text: "no Claude Code hook to remove" };
  fs.writeFileSync(file, out);
  return { ok: true, file, text: `Claude Code hook removed from ${file}` };
}
