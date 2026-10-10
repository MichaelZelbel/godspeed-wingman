// May the worker run the person's own site adapter? An adapter in <mission control>/routines/
// wingman/sites/<id>/ is code, and the worker runs it with the worker's rights. When the worker runs
// as root (or as any account other than the one that can change those files), whoever can change
// the files can make the worker do anything it may do. So the worker refuses such an adapter and
// says, in one sentence, how to fix it: run the worker as the folder's owner.
//
// What counts as "can be changed by another account", on Linux and macOS:
//   - a file or folder of the adapter (or any folder above it, up to /) belongs to an account
//     other than the worker's own or root;
//   - it is writable by every account (a folder above the adapter with the sticky bit, like /tmp,
//     is fine: nobody can rename what they do not own there);
//   - it is writable by its group, and that group is not the worker's own group.
// A link inside the adapter's folder is refused too: it could point anywhere.
//
// On Windows the worker runs as the person who installed it (a scheduled task for the current
// user), so there is no second account to guard against, and Windows file rights are not Unix
// mode bits; the check says nothing there.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFLNK = 0o120000;
const isDir = (st) => (st.mode & S_IFMT) === S_IFDIR;
const isLink = (st) => (st.mode & S_IFMT) === S_IFLNK;

// The name of an account by its number, from /etc/passwd (no program is started).
export function accountName(uid, { readFile = (f) => fs.readFileSync(f, "utf8") } = {}) {
  if (uid === 0) return "root";
  try {
    for (const line of readFile("/etc/passwd").split("\n")) {
      const f = line.split(":");
      if (f.length > 2 && Number(f[2]) === uid) return f[0];
    }
  } catch { /* no passwd file */ }
  // macOS keeps its accounts outside /etc/passwd; this process's own account is known anyway.
  try { if (typeof process.getuid === "function" && uid === process.getuid()) return os.userInfo().username; } catch { /* no name */ }
  return `the account with number ${uid}`;
}

// What is wrong with one file or folder: null, or { path, by } where `by` is the account that can
// change it ("every account", a group, or an account name).
function writableByOther(p, st, { uid, gid, ancestor, name }) {
  if (st.uid !== uid && st.uid !== 0) return { path: p, by: name(st.uid) };
  const sticky = isDir(st) && (st.mode & 0o1000);
  if ((st.mode & 0o002) && !(ancestor && sticky)) return { path: p, by: "every account" };
  if ((st.mode & 0o020) && st.gid !== gid && !(ancestor && sticky)) return { path: p, by: `the group with number ${st.gid}` };
  return null;
}

// The problem with running the adapter in `dir`, as one plain sentence, or null when it is safe.
// `sys` stands in for the machine in tests: { platform, uid, gid, fsImpl: { lstat, realpath, readdir }, name }.
export function trustProblem(dir, siteName, sys = {}) {
  const platform = sys.platform ?? process.platform;
  if (platform === "win32") return null;
  // Unix path rules, also when a test on Windows plays a Linux machine.
  const P = platform === process.platform ? path : path.posix;
  siteName = siteName || P.basename(dir);
  const uid = sys.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  const gid = sys.gid ?? (typeof process.getgid === "function" ? process.getgid() : null);
  if (uid === null || uid === undefined) return null;
  const f = sys.fsImpl || { lstat: fs.lstatSync, realpath: fs.realpathSync, readdir: (d) => fs.readdirSync(d) };
  const name = sys.name || ((n) => accountName(n));
  const worker = name(uid);
  const fix = (by) => `The Wingman does not run your own adapter for ${siteName}, because ${by === "every account" ? "every account on this machine" : by} can change its files while the worker runs as ${worker}; run the worker as the account that owns your mission control folder (or make the folder belong to ${worker} and writable only by it).`;

  let real;
  try { real = f.realpath(dir); } catch { return null; } // a missing folder is reported elsewhere
  // The adapter's own folder and everything in it.
  const walk = (p, depth = 0) => {
    let st;
    try { st = f.lstat(p); } catch { return null; }
    if (isLink(st)) return { path: p, link: true };
    const bad = writableByOther(p, st, { uid, gid, ancestor: false, name });
    if (bad) return bad;
    if (isDir(st) && depth < 8) {
      let names = [];
      try { names = f.readdir(p); } catch { return null; }
      for (const n of names) { const r = walk(P.join(p, n), depth + 1); if (r) return r; }
    }
    return null;
  };
  const inside = walk(real);
  if (inside?.link) return `The Wingman does not run your own adapter for ${siteName}, because its folder holds a link (${inside.path}) that could point anywhere; replace the link with the file itself.`;
  if (inside) return fix(inside.by);
  // Every folder above it, up to the top: whoever can rename one of them can swap the adapter.
  for (let p = P.dirname(real); ; p = P.dirname(p)) {
    let st;
    try { st = f.lstat(p); } catch { break; }
    const bad = writableByOther(p, st, { uid, gid, ancestor: true, name });
    if (bad) return fix(bad.by);
    if (P.dirname(p) === p) break;
  }
  return null;
}

