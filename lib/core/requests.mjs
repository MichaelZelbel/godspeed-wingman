// How the assistant talks to the worker. The assistant's account answers a practice question, asks
// for "send 2" or starts a practice round by dropping one small file into requests/; the worker
// picks them up in order within seconds. Nothing else is shared, so the assistant never needs the
// browser, the model or the worker's rights.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./store.mjs";

export const TYPES = ["answer", "send", "train", "review", "run", "pause", "resume", "inbox", "stop-practice", "exception", "notebook", "welcome"];

export function submit(paths, type, payload = {}) {
  if (!TYPES.includes(type)) throw new Error(`unknown request: ${type}`);
  ensureDir(paths.requests);
  const id = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(paths.requests, `${id}.json`);
  writeJson(file, { id, type, ...payload, at: new Date().toISOString() });
  return id;
}

// Each request is claimed by renaming its file before anything happens, so two workers (the
// service and a stray `worker --once`) can never both act on one "send 2".
export function pending(paths) {
  let names = [];
  try { names = fs.readdirSync(paths.requests).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const from = path.join(paths.requests, n);
    const claimed = `${from}.claimed-${process.pid}`;
    try { fs.renameSync(from, claimed); } catch { continue; }
    const body = readJson(claimed);
    if (body) out.push({ file: claimed, name: n, body });
    else { try { fs.unlinkSync(claimed); } catch { /* gone */ } }
  }
  return out;
}

export function done(paths, req, result) {
  ensureDir(paths.requestsDone);
  writeJson(path.join(paths.requestsDone, req.name || path.basename(req.file)), { ...req.body, result, doneAt: new Date().toISOString() });
  try { fs.unlinkSync(req.file); } catch { /* already gone */ }
}

// The CLI waits a little for the worker's answer, so the assistant can tell the person what happened.
export async function waitFor(paths, id, timeoutMs = 20000) {
  const f = path.join(paths.requestsDone, `${id}.json`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = readJson(f);
    if (r) return r.result;
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}
