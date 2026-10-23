// Where things live.
//
// Two places, on purpose:
//   <mission control>/routines/wingman/   what the person says: preferences.md, watch.md,
//                                          settings.json, and sites/<id>/ for site adapters they
//                                          (or their coding helper) added. Plain text, in git.
//   the state folder                      everything about other people: the profile archive, the
//                                          practice answers, the reply ideas, the log, the
//                                          Wingman's own browser profile. Never in git, because git
//                                          never forgets and the archive must be deleted after the
//                                          retention. Linux as root: /var/lib/godspeed/wingman;
//                                          otherwise ~/.godspeed/wingman.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NAME = "godspeed-wingman";
export const ROUTINE = path.join("routines", "wingman");

export const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

// The server installer owns this descriptor and the adjacent fixed-service model proxy. It is
// not a second copy of the person's notebook workspace (which remains inside Docker). Only this
// exact marker shape plus the compose file and proxy qualifies; a loose model.mjs does not.
export function isDockerModelHost(dir) {
  if (!dir) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, ".godspeed", "model-host.json"), "utf8"));
    return marker?.format === 1 && marker.kind === "godspeed-docker" && marker.service === "godspeed"
      && marker.workspace === "/opt/data/full-candidate/workspace"
      && Object.keys(marker).every((k) => ["format", "kind", "service", "workspace"].includes(k))
      && fs.statSync(path.join(dir, "compose.yaml")).isFile()
      && fs.statSync(path.join(dir, ".godspeed", "model.mjs")).isFile();
  } catch { return false; }
}

// The mission control folder: the --godspeed argument, then the environment, then the device file
// Godspeed writes, then the folder this runs in (or one above it), then the default folders of
// Godspeed v2 and v1. A folder counts when it holds AGENTS.md.
export function findMissionControl({ arg, cwd = process.cwd(), userHome = os.homedir(), env = process.env, platform = process.platform, serverDir = "/opt/godspeed-mission-control" } = {}) {
  const isMc = (d) => !!d && (fs.existsSync(path.join(d, "AGENTS.md")) || isDockerModelHost(d));
  for (const c of [arg, env.GODSPEED_WINGMAN_DIR, env.GODSPEED_ROOT, env.GODSPEED_DIR]) {
    if (c) return isMc(path.resolve(c)) ? path.resolve(c) : null;
  }
  const envFile = path.join(userHome, ".godspeed", "device.env");
  try {
    const m = fs.readFileSync(envFile, "utf8").match(/^\s*GODSPEED_DIR=(.+)$/m);
    if (m) {
      const d = m[1].trim().replace(/^["']|["']$/g, "");
      if (isMc(d)) return path.resolve(d);
    }
  } catch { /* no device file */ }
  let d = path.resolve(cwd);
  for (;;) {
    if (isMc(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const name of ["godspeed-v2", "godspeed"]) {
    const dflt = path.join(userHome, name);
    if (isMc(dflt)) return dflt;
  }
  if (platform === "linux" && isDockerModelHost(serverDir)) return path.resolve(serverDir);
  return null;
}

export function defaultStateDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_WINGMAN_STATE) return path.resolve(env.GODSPEED_WINGMAN_STATE);
  if (platform === "linux" && root) return "/var/lib/godspeed/wingman";
  return path.join(home, ".godspeed", "wingman");
}

// Where the program is copied to, and where its command goes.
export function appDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_WINGMAN_APP) return path.resolve(env.GODSPEED_WINGMAN_APP);
  if (platform === "linux" && root) return "/usr/local/lib/godspeed-wingman";
  return path.join(home, ".godspeed", "addons", NAME);
}

export function binDir({ platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (platform === "linux" && root) return "/usr/local/bin";
  return path.join(home, ".godspeed", "bin");
}

export function statePaths(stateDir) {
  const p = (...a) => path.join(stateDir, ...a);
  return {
    root: stateDir,
    state: p("state.json"),          // per site: practice or autopilot; the run, the open question
    requests: p("requests"),         // what the assistant or the command asks the worker to do
    requestsDone: p("requests", "done"),
    archive: p("archive"),           // one folder per profile seen, per day
    archiveIndex: p("archive", "index.jsonl"),
    screenshots: p("screenshots"),   // the pictures of the pages, by day
    examples: p("examples.jsonl"),   // practice and review answers, the judge reads them
    decisions: p("decisions.jsonl"), // every like, pass, stop and practice question
    replies: p("replies.json"),      // reply ideas waiting for "send 2"
    collectionItems: p("collection-items.json"), // which notebook item holds whom, for `who`'s link
    log: p("worker.log"),
    heartbeat: p("heartbeat.json"),
    pid: p("worker.pid"),
    browser: p("browser"),           // the Wingman's own Chrome or Edge profile (local browser)
    desk: p("desk"),                 // what the desk page shows (messages to the person)
    workerEnv: p("worker.env"),      // private settings for the worker only: a model key, an address
  };
}

export function routinePaths(mcDir) {
  const p = (...a) => path.join(mcDir, ROUTINE, ...a);
  return { dir: p(), preferences: p("preferences.md"), watch: p("watch.md"), settings: p("settings.json"), sites: p("sites") };
}

// The worker's private environment file: KEY=VALUE lines in the state folder, never in git. Read
// at the worker's start, so a model key or a bridge token reaches a worker that a scheduled task or
// a service started without the person's shell. Only names starting GODSPEED_WINGMAN_, the bridge
// token and the key variable the openai lane names are taken; a value already set wins.
export function loadWorkerEnv(file, env = process.env) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const wanted = (k) => k.startsWith("GODSPEED_WINGMAN_") || k === "GODSPEED_MODEL_COMMAND" || k === "BRIDGE_TOKEN" || k === (env.GODSPEED_WINGMAN_OPENAI_KEY_ENV || "OPENAI_API_KEY");
  const set = [];
  const lines = text.split(/\r?\n/).map((l) => l.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean);
  // The key variable may itself be named in the file, so names come first.
  for (const m of lines) if (m[1] === "GODSPEED_WINGMAN_OPENAI_KEY_ENV" && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  for (const [, k, v] of lines) {
    if (!wanted(k) || env[k] !== undefined) continue;
    env[k] = v.replace(/^["']|["']$/g, "");
    set.push(k);
  }
  return set;
}
