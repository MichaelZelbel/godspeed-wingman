// The command registry. Every file in this folder (except index.mjs and files starting with "_")
// is a command module that exports `meta` and `run`, or `commands`, a list of { meta, run }.
//   meta = { name, summary, usage, flags: { value: [], greedy: [], bool: [] }, needs: "mc" | "none", hidden }
//   run(ctx) -> exit code (or nothing for 0)
// A new command is a new file here; nothing else changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findMissionControl, defaultStateDir, statePaths, routinePaths } from "../core/paths.mjs";
import { loadSettings } from "../core/settings.mjs";
import { viaWorker } from "./_common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GLOBAL = { value: ["godspeed", "state", "wait"], greedy: [], bool: ["help"] };

export async function loadCommands(dir = HERE) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs") && n !== "index.mjs" && !n.startsWith("_")).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const list = Array.isArray(mod.commands) ? mod.commands : mod.meta && mod.run ? [{ meta: mod.meta, run: mod.run }] : [];
    for (const c of list) {
      if (out.has(c.meta.name)) throw new Error(`two commands are called ${c.meta.name}`);
      out.set(c.meta.name, { ...c, file: f });
      for (const a of c.meta.aliases || []) out.set(a, { ...c, file: f, alias: true });
    }
  }
  return out;
}

// Known options only. A greedy option (--reason, --text) takes everything up to the next known
// option, so an unquoted `--reason too young` keeps both words and a reason may start with "--".
export function flagSpec(commands) {
  const spec = { value: new Set(GLOBAL.value), greedy: new Set(GLOBAL.greedy), bool: new Set(GLOBAL.bool) };
  for (const c of commands.values()) for (const k of ["value", "greedy", "bool"]) for (const f of c.meta.flags?.[k] || []) spec[k].add(f);
  return spec;
}

export function parse(argv, spec) {
  const known = (a) => typeof a === "string" && a.startsWith("--") && (spec.value.has(a.slice(2)) || spec.greedy.has(a.slice(2)) || spec.bool.has(a.slice(2)));
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known(a)) { rest.push(a); continue; }
    const k = a.slice(2);
    if (spec.bool.has(k)) { flags[k] = true; continue; }
    if (spec.greedy.has(k)) {
      const words = [];
      while (i + 1 < argv.length && !known(argv[i + 1])) words.push(argv[++i]);
      flags[k] = words.join(" ");
      continue;
    }
    if (i + 1 < argv.length && !known(argv[i + 1])) flags[k] = argv[++i];
    else flags[k] = "";
  }
  return { flags, rest };
}

export async function main(argv) {
  const commands = await loadCommands();
  const { flags, rest } = parse(argv, flagSpec(commands));
  const name = rest[0] || (flags.help ? "help" : "status");
  const c = commands.get(name);
  if (!c) {
    console.error(`Unknown command ${name}. Try: godspeed-wingman help`);
    return 1;
  }
  if (flags.help && name !== "help") { console.log(`godspeed-wingman ${c.meta.usage}\n  ${c.meta.summary}`); return 0; }
  const ctx = { name, flags, rest: rest.slice(1), argv, commands, print: (s) => console.log(s), fail: (s) => console.error(s) };
  if (c.meta.needs !== "none") {
    const mcDir = findMissionControl({ arg: flags.godspeed });
    if (!mcDir) { console.error("No mission control folder found. Run this inside it, or pass --godspeed <folder>."); return 1; }
    const stateDir = path.resolve(flags.state || defaultStateDir());
    const paths = statePaths(stateDir);
    const routine = routinePaths(mcDir);
    Object.assign(ctx, { mcDir, stateDir, paths, routine, settings: loadSettings(routine.settings) });
    ctx.viaWorker = (type, payload) => viaWorker(ctx, type, payload);
  }
  return (await c.run(ctx)) ?? 0;
}
