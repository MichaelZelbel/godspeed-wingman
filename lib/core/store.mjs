// Small file helpers. Everything the worker writes may later be read or written by the assistant's
// own account (the assistant answers a practice question by dropping a request file), so every
// file is written group-writable, and when the worker runs as root it hands each new file to the
// owner of the state folder. Writes are atomic: a reader never sees half a file.
import fs from "node:fs";
import path from "node:path";

let owner = null; // { uid, gid } of the state folder, when we run as root

export function adoptOwner(stateDir) {
  try {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      const st = fs.statSync(stateDir);
      owner = { uid: st.uid, gid: st.gid };
    }
  } catch { owner = null; }
  try { process.umask(0o002); } catch { /* not on Windows */ }
}

function hand(p) {
  if (!owner) return;
  try { fs.chownSync(p, owner.uid, owner.gid); } catch { /* best effort */ }
}

export function ensureDir(dir) {
  if (fs.existsSync(dir)) return dir;
  const parent = path.dirname(dir);
  if (parent !== dir) ensureDir(parent);
  try { fs.mkdirSync(dir); } catch (e) { if (e.code !== "EEXIST") throw e; }
  hand(dir);
  try { fs.chmodSync(dir, 0o2775); } catch { /* Windows */ }
  return dir;
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

export function writeJson(p, value) {
  writeText(p, JSON.stringify(value, null, 2) + "\n");
}

// Atomic: written to a temporary name, then renamed. A write that fails half way leaves no stray
// .tmp file, and a picture that cannot be written (a full disk) leaves the one before it whole.
export function writeBuffer(p, data) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    try { fs.chmodSync(tmp, 0o664); } catch { /* Windows */ }
    hand(tmp);
    renameRetry(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
}

export function writeText(p, text) { writeBuffer(p, text); }

// On Windows a file another process has open for a moment (a reader, a virus scanner) refuses a
// rename; a few short tries get past that.
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (i + 1));
    }
  }
}

export function appendJsonl(p, value) {
  ensureDir(path.dirname(p));
  const existed = fs.existsSync(p);
  fs.appendFileSync(p, JSON.stringify(value) + "\n");
  if (!existed) { try { fs.chmodSync(p, 0o664); } catch { /* Windows */ } hand(p); }
}

export function readJsonl(p) {
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { return []; }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line is skipped */ }
  }
  return out;
}

export function removeTree(p) {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
}
