// The desk: the Wingman's own page on this machine (http://127.0.0.1:<desk_port>/, lib/desk/).
// The page shows the open question and the reply ideas straight from the worker's state; this
// channel keeps every message as well, in the desk's inbox in the private state folder
// (desk/messages.jsonl), so the page can show what else was said (a Discord name, a lost login).
// A message counts as delivered once it is written: the desk has it, and shows it the next time
// the person looks.
import path from "node:path";
import crypto from "node:crypto";
import { appendJsonl, ensureDir, readJsonl } from "../core/store.mjs";

export function inboxFile(paths) { return path.join(paths.desk, "messages.jsonl"); }

export async function send({ text, picture, paths, now = new Date() }) {
  if (!paths?.desk) throw new Error("the desk has no folder");
  ensureDir(paths.desk);
  appendJsonl(inboxFile(paths), { id: `${now.getTime()}-${crypto.randomBytes(3).toString("hex")}`, at: now.toISOString(), text: String(text), picture: picture || null });
  return true;
}

// The newest messages first.
export function recent(paths, n = 30) { return readJsonl(inboxFile(paths)).slice(-n).reverse(); }

export async function ready({ paths, settings, probe }) {
  try { ensureDir(paths.desk); } catch (e) { return { ok: false, why: `the desk folder cannot be written: ${e.message}` }; }
  const base = `messages wait on the desk page (http://127.0.0.1:${settings.desk_port}/)`;
  const { deskUp } = await import("../desk/secret.mjs");
  const up = await (probe || deskUp)(settings.desk_port);
  return { ok: true, why: up ? base : `${base}; the page is not served right now: the worker serves it, or run \`godspeed-wingman desk\`` };
}
