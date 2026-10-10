// Where the Wingman talks to the person: every channel they chose in the setting `talk` gets each
// message (the desk page, desktop notifications, Telegram). A message counts as delivered when at
// least one channel took it; one that no channel took is sent again later by the worker.
//
// A channel is a module lib/channels/<name>.mjs with
//   send({ text, picture, settings, paths, log }) -> true when it took the message (or throws)
//   ready({ settings, paths }) -> { ok, why } for `check`
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TALK } from "../core/settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
const missingSaid = new Set();

export async function loadChannel(name) {
  if (!TALK.includes(name)) return null;
  if (cache.has(name)) return cache.get(name);
  const file = path.join(HERE, `${name}.mjs`);
  const mod = fs.existsSync(file) ? await import(pathToFileURL(file).href) : null;
  const ch = mod && typeof mod.send === "function" ? mod : null;
  cache.set(name, ch);
  return ch;
}

// Fans one message out. `impls` replaces channels (the tests); returns { delivered, results }.
export async function tell(text, picture, { settings, paths, log = () => {}, impls = {} } = {}) {
  const results = {};
  let delivered = false;
  for (const name of settings.talk || []) {
    try {
      const ch = impls[name] || await loadChannel(name);
      if (!ch) {
        results[name] = "not available";
        if (!missingSaid.has(name)) { missingSaid.add(name); log(`talk: the channel "${name}" is not part of this version; the other channels still get every message`); }
        continue;
      }
      const ok = await (typeof ch === "function" ? ch({ text, picture, settings, paths, log }) : ch.send({ text, picture, settings, paths, log }));
      results[name] = ok ? "ok" : "not taken";
      if (ok) delivered = true;
    } catch (e) {
      results[name] = e.message;
      log(`talk: ${name} did not take the message: ${e.message}`);
    }
  }
  return { delivered, results };
}

// For `check`: one line per chosen channel.
export async function readiness(settings, paths) {
  const out = [];
  for (const name of settings.talk || []) {
    const ch = await loadChannel(name);
    if (!ch) { out.push({ name, ok: false, why: "not part of this version" }); continue; }
    try { out.push({ name, ...(typeof ch.ready === "function" ? await ch.ready({ settings, paths }) : { ok: true, why: "" }) }); }
    catch (e) { out.push({ name, ok: false, why: e.message }); }
  }
  return out;
}
