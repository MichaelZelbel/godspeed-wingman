// The person's edits of routines/wingman reach their other machines through mission control's own
// git history. Only that folder is ever staged or committed, with an explicit pathspec, so
// half-finished work elsewhere in the same folder is never swept into a commit.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTINE } from "./paths.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "godspeed-wingman.mjs");
const g = (mcDir, args, timeout = 60000) => spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, windowsHide: true });
const SPEC = ROUTINE.replace(/\\/g, "/");

function rebaseInProgress(mcDir) {
  for (const which of ["rebase-merge", "rebase-apply"]) {
    const r = g(mcDir, ["rev-parse", "--git-path", which]);
    if (r.status === 0 && r.stdout.trim() && fs.existsSync(path.resolve(mcDir, r.stdout.trim()))) return true;
  }
  return false;
}

export function commitRoutine(mcDir, message, mode) {
  if (mode === "off" || !fs.existsSync(path.join(mcDir, ".git"))) return "off";
  if (rebaseInProgress(mcDir)) return "busy";
  g(mcDir, ["add", "--", SPEC]);
  if (g(mcDir, ["diff", "--cached", "--quiet", "--", SPEC]).status === 0) return "nothing";
  let c = g(mcDir, ["commit", "-m", message, "--", SPEC]);
  if (c.status !== 0) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); c = g(mcDir, ["commit", "-m", message, "--", SPEC]); }
  if (c.status !== 0) return "commit-failed";
  if (mode === "commit" || !g(mcDir, ["remote"]).stdout.trim()) return "committed";
  const pull = g(mcDir, ["pull", "--rebase", "--autostash", "-q"]);
  if (pull.status !== 0) { g(mcDir, ["rebase", "--abort"]); return "push-failed"; }
  return g(mcDir, ["push", "-q"], 300000).status === 0 ? "pushed" : "push-failed";
}

export function syncInBackground(mcDir, message, mode) {
  if (mode === "off") return;
  spawn(process.execPath, [BIN, "_sync", message, "--godspeed", mcDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
