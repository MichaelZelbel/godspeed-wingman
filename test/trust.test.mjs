// The person's own site adapters are code the worker runs. When another account than the worker's
// can change them (the worker runs as root, or any other account), the worker refuses to load them
// and says in one sentence how to fix it. The decision is tested on every system with a pretend
// Linux file tree; the last tests use real files and run on Linux and macOS only (CI).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { trustProblem, accountName } from "../lib/sites/trust.mjs";
import { listSites, loadSite } from "../lib/sites/index.mjs";
import { tempMc, makeWorker, user } from "./helpers.mjs";

const SITE = "/home/kiri/godspeed/routines/wingman/sites/kindmeet";
const NAMES = { 0: "root", 1000: "kiri", 1001: "robin" };
const name = (uid) => NAMES[uid] || `the account with number ${uid}`;

// A pretend Linux file tree: path -> { uid, gid, mode } (a folder when mode has 0o040000).
function tree(overrides = {}) {
  const D = 0o040000, F = 0o100000;
  const t = {
    "/": { uid: 0, gid: 0, mode: D | 0o755 },
    "/home": { uid: 0, gid: 0, mode: D | 0o755 },
    "/home/kiri": { uid: 1000, gid: 1000, mode: D | 0o750 },
    "/home/kiri/godspeed": { uid: 1000, gid: 1000, mode: D | 0o755 },
    "/home/kiri/godspeed/routines": { uid: 1000, gid: 1000, mode: D | 0o755 },
    "/home/kiri/godspeed/routines/wingman": { uid: 1000, gid: 1000, mode: D | 0o755 },
    "/home/kiri/godspeed/routines/wingman/sites": { uid: 1000, gid: 1000, mode: D | 0o755 },
    [SITE]: { uid: 1000, gid: 1000, mode: D | 0o755 },
    [`${SITE}/site.json`]: { uid: 1000, gid: 1000, mode: F | 0o644 },
    [`${SITE}/adapter.mjs`]: { uid: 1000, gid: 1000, mode: F | 0o644 },
    [`${SITE}/lib`]: { uid: 1000, gid: 1000, mode: D | 0o755 },
    [`${SITE}/lib/parse.mjs`]: { uid: 1000, gid: 1000, mode: F | 0o644 },
    ...overrides,
  };
  return {
    realpath: (p) => p,
    lstat: (p) => { if (!t[p]) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return t[p]; },
    readdir: (p) => Object.keys(t).filter((k) => k !== p && k.startsWith(p.endsWith("/") ? p : `${p}/`) && !k.slice(p.length + 1).includes("/")).map((k) => k.slice(p.length + 1)),
  };
}
const as = (uid, gid, fsImpl = tree()) => ({ platform: "linux", uid, gid, fsImpl, name });

test("the worker running as the folder's owner may run the person's own adapter", () => {
  assert.equal(trustProblem(SITE, "Kind Meet", as(1000, 1000)), null);
});

test("a worker running as root refuses an adapter another account can change, and says how to fix it", () => {
  assert.equal(trustProblem(SITE, "Kind Meet", as(0, 0)),
    "The Wingman does not run your own adapter for Kind Meet, because kiri can change its files while the worker runs as root; run the worker as the account that owns your mission control folder (or make the folder belong to root and writable only by it).");
  assert.match(trustProblem(SITE, "Kind Meet", as(1001, 1001)), /because kiri can change its files while the worker runs as robin;/, "any other account, not only root");
});

test("files every account may change, or another group may change, are refused too", () => {
  const F = 0o100000, D = 0o040000;
  assert.match(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ [`${SITE}/lib/parse.mjs`]: { uid: 1000, gid: 1000, mode: F | 0o666 } }))), /because every account on this machine can change its files/);
  assert.match(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ [`${SITE}/adapter.mjs`]: { uid: 1000, gid: 1001, mode: F | 0o664 } }))), /because the group with number 1001 can change its files/);
  assert.equal(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ [`${SITE}/adapter.mjs`]: { uid: 1000, gid: 1000, mode: F | 0o664 } }))), null, "the worker's own group is fine");
  assert.match(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ "/home": { uid: 0, gid: 0, mode: D | 0o777 } }))), /every account on this machine/, "a folder above it counts: it could be renamed");
  assert.equal(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ "/home": { uid: 0, gid: 0, mode: D | 0o1777 } }))), null, "a sticky folder above, like /tmp, is fine");
  assert.match(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ [SITE]: { uid: 1000, gid: 1000, mode: D | 0o1777 } }))), /every account/, "but never the adapter's own folder");
});

test("a link inside the adapter's folder is refused; Windows is not checked", () => {
  assert.match(trustProblem(SITE, "Kind Meet", as(1000, 1000, tree({ [`${SITE}/lib/parse.mjs`]: { uid: 1000, gid: 1000, mode: 0o120777 } }))), /its folder holds a link \(.*parse\.mjs\) that could point anywhere/);
  assert.equal(trustProblem(SITE, "Kind Meet", { platform: "win32", uid: 0, gid: 0, fsImpl: tree() }), null);
});

test("account names come from /etc/passwd", () => {
  const readFile = () => "root:x:0:0:root:/root:/bin/bash\nkiri:x:1000:1000::/home/kiri:/bin/bash\n";
  assert.equal(accountName(1000, { readFile }), "kiri");
  assert.equal(accountName(0, { readFile }), "root");
  assert.equal(accountName(4242, { readFile }), "the account with number 4242");
});

const ADAPTER_THAT_RUNS = `globalThis.__wingmanImported = (globalThis.__wingmanImported || 0) + 1;
export default function create() { return { session: async () => ({ loggedIn: true, me: null }), queue: async () => ({ next: [], limits: null, done: true }), profile: async (id) => ({ id }), like: async () => ({}), pass: async () => ({}) }; }
`;
function ownSite(mc, id = "kindmeet") {
  const dir = path.join(mc, "routines", "wingman", "sites", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "site.json"), JSON.stringify({ id, name: "Kind Meet", kind: "browser", home: "https://kindmeet.example", about: "Kind Meet, a test site", terms: { checked_on: "2026-10-01", urls: ["https://kindmeet.example/terms"], verdict: "allowed", quotes: ["Helpers are welcome."] }, can: ["queue", "like", "pass"] }));
  fs.writeFileSync(path.join(dir, "adapter.mjs"), ADAPTER_THAT_RUNS);
  return dir;
}

test("the loader refuses before a line of the adapter runs, and the worker leaves the site alone", async () => {
  const { mc } = tempMc();
  ownSite(mc);
  const trust = { platform: "linux", uid: 0, gid: 0, fsImpl: { ...tree(), realpath: () => SITE }, name };
  assert.match(listSites({ mcDir: mc, trust }).find((s) => s.id === "kindmeet").untrusted, /kiri can change its files while the worker runs as root/);
  await assert.rejects(loadSite("kindmeet", { mcDir: mc, trust }), (e) => e.refused && e.code === "untrusted" && /run the worker as the account that owns your mission control folder/.test(e.message));
  assert.equal(globalThis.__wingmanImported, undefined, "the adapter was never imported");

  const h = makeWorker([user("a1", "Mara")], { settings: { sites: ["kindmeet"] } });
  ownSite(h.mc);
  let made = 0;
  h.w.deps.loadSite = (id) => loadSite(id, { mcDir: h.mc, trust });
  h.w.deps.makeAdapter = () => { made++; return {}; };
  await h.w.tick();
  assert.equal(made, 0);
  assert.match(h.w.state.lastError.text, /The Wingman does not run your own adapter for Kind Meet/);
  assert.equal(globalThis.__wingmanImported, undefined);
});

const posix = process.platform !== "win32";
const root = posix && process.getuid() === 0;
test("real files on Linux and macOS: a file every account may write is refused, the owner's own files are not", { skip: !posix ? "Unix rights only (CI runs this on Linux)" : root ? "runs as root here" : false }, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wingman-trust-")));
  const dir = ownSite(base);
  for (const p of [base, path.join(base, "routines"), path.join(base, "routines", "wingman"), path.join(base, "routines", "wingman", "sites"), dir]) fs.chmodSync(p, 0o755);
  for (const f of ["site.json", "adapter.mjs"]) fs.chmodSync(path.join(dir, f), 0o644);
  assert.equal(trustProblem(dir, "Kind Meet"), null, "the worker as the owner");
  fs.chmodSync(path.join(dir, "adapter.mjs"), 0o666);
  assert.match(trustProblem(dir, "Kind Meet"), /every account on this machine can change its files/);
  fs.chmodSync(path.join(dir, "adapter.mjs"), 0o644);
  const me = os.userInfo().username;
  assert.match(trustProblem(dir, "Kind Meet", { uid: 4242, gid: 4242 }), new RegExp(`because ${me} can change its files while the worker runs as the account with number 4242`));
  assert.match(listSites({ mcDir: base, trust: { uid: 4242, gid: 4242 } }).find((s) => s.id === "kindmeet").untrusted, /Kind Meet/);
});
