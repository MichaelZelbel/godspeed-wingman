// The desk: the Wingman's own page on this machine (http://127.0.0.1:<desk_port>/). This channel
// only writes each message to the desk's inbox in the private state folder (desk/messages.jsonl);
// the desk page reads it from there, shows what is open and takes the person's answers. A message
// counts as delivered once it is written: the desk shows it the next time the person looks.
import path from "node:path";
import crypto from "node:crypto";
import { appendJsonl, ensureDir } from "../core/store.mjs";

export function inboxFile(paths) { return path.join(paths.desk, "messages.jsonl"); }

export async function send({ text, picture, paths, now = new Date() }) {
  if (!paths?.desk) throw new Error("the desk has no folder");
  ensureDir(paths.desk);
  appendJsonl(inboxFile(paths), { id: `${now.getTime()}-${crypto.randomBytes(3).toString("hex")}`, at: now.toISOString(), text: String(text), picture: picture || null });
  return true;
}

export function ready({ paths, settings }) {
  try { ensureDir(paths.desk); return { ok: true, why: `messages wait on the desk page (http://127.0.0.1:${settings.desk_port}/)` }; }
  catch (e) { return { ok: false, why: `the desk folder cannot be written: ${e.message}` }; }
}
