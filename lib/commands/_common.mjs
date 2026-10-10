// What several commands share: handing a request to the worker and waiting for its one-line
// answer, whether the worker runs, and the disk warning lines.
import * as requests from "../core/requests.mjs";
import { readJson } from "../core/store.mjs";
import { readState } from "../core/state.mjs";

export function heartbeat(paths) { return readJson(paths.heartbeat, null); }
export function workerAlive(paths) {
  const hb = heartbeat(paths);
  return !!hb && Date.now() - new Date(hb.at).getTime() < 120000;
}

// Exit codes: 0 done (or passed on), 2 the worker said no, 3 the worker is not running (saved).
export async function viaWorker(ctx, type, payload = {}) {
  const alive = workerAlive(ctx.paths);
  const id = requests.submit(ctx.paths, type, payload);
  if (!alive) {
    ctx.print("The Wingman is not running right now. This is saved and done as soon as it is back.");
    return 3;
  }
  const result = await requests.waitFor(ctx.paths, id, Number(ctx.flags.wait || 25) * 1000);
  if (result) { ctx.print(result.text); return result.ok ? 0 : 2; }
  ctx.print("Passed on to the Wingman. It is busy and acts on it within a minute or two.");
  return 0;
}

export const stateOf = (paths) => readState(paths.state);

// The disk guard, for status and check: a warning when the disk is under the guard's limit now,
// and when the guard deleted pictures in the last seven days. Nothing when all is well, except
// check's one line saying how much is free.
export async function diskLines(ctx, s, { always = false } = {}) {
  const { freeBytes } = await import("../core/archive.mjs");
  const GB = 1024 ** 3;
  const gb = (b) => (b / GB).toFixed(1);
  const set = ctx.settings;
  const out = [];
  const free = freeBytes(ctx.paths.root);
  const min = set.min_free_gb * GB;
  if (free !== null && min && free < min) out.push({ warn: true, text: `Disk WARNING: only ${gb(free)} GB free on this disk, under the ${set.min_free_gb} GB the Wingman keeps; it deletes its oldest pictures before keeping a new one (never the profiles themselves, never the last seven days).` });
  else if (always) out.push({ warn: false, text: free === null ? "disk: free space unknown" : `disk: ${gb(free)} GB free${min ? ` (the oldest pictures make room below ${set.min_free_gb} GB)` : " (the disk guard is off)"}` });
  const d = s.disk;
  if (d?.cleanedAt && Date.now() - new Date(d.cleanedAt).getTime() < 7 * 86400000) {
    out.push({ warn: true, text: `Disk WARNING: the disk ran short of space, so the Wingman deleted the pictures of ${d.profiles} kept profile(s) (from ${d.first} to ${d.last}, ${Math.round((d.freed || 0) / 1024 ** 2)} MB), the last time ${d.cleanedAt}. The profiles stay, so \`who\` still finds them.` });
  }
  return out;
}
