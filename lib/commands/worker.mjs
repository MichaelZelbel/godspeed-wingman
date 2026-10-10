// The always-on worker. The service (systemd, launchd) or the Windows scheduled task runs this.
// --supervise keeps it running on Windows: a small parent restarts the worker whenever it stops,
// because a task started without a console window does not see the worker's exit code.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkerEnv } from "../core/paths.mjs";

export const meta = { name: "worker", summary: "the always-on worker (the service runs this)", usage: "worker [--once] [--supervise]", flags: { bool: ["once", "supervise"] } };

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "godspeed-wingman.mjs");
export const LOCKED = 4;

export async function run(ctx) {
  if (ctx.flags.supervise) return supervise(ctx);
  loadWorkerEnv(ctx.paths.workerEnv);
  const { Worker } = await import("../core/worker.mjs");
  const w = new Worker({ mcDir: ctx.mcDir, stateDir: ctx.stateDir });
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) { try { process.on(sig, () => w.stop()); } catch { /* not on this system */ } }
  // The desk page is served by the worker itself, for as long as it runs (not for one tick).
  let desk = null;
  if (!ctx.flags.once && process.env.GODSPEED_WINGMAN_NO_DESK !== "1" && w.lock()) {
    const { keepDeskServed } = await import("../desk/server.mjs");
    desk = keepDeskServed({ mcDir: ctx.mcDir, stateDir: ctx.stateDir, port: ctx.settings.desk_port, log: (l) => w.log(l) });
  }
  try {
    const ran = await w.loop({ once: !!ctx.flags.once });
    return ran === false ? LOCKED : 0;
  } finally {
    await desk?.stop();
  }
}

// Restarts the worker 20 seconds after it stops, longer when it keeps stopping at once (up to five
// minutes); stops for good when another worker already holds the lock.
async function supervise(ctx) {
  const args = [BIN, "worker", "--godspeed", ctx.mcDir, "--state", ctx.stateDir];
  let child = null;
  let stopping = false;
  const stop = () => { stopping = true; try { child?.kill(); } catch { /* gone */ } };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) { try { process.on(sig, stop); } catch { /* not on this system */ } }
  let pause = 20000;
  const log = (line) => { try { fs.mkdirSync(ctx.stateDir, { recursive: true }); fs.appendFileSync(ctx.paths.log, `${new Date().toISOString()} supervisor: ${line}\n`); } catch { /* never stops */ } };
  for (;;) {
    const started = Date.now();
    const code = await new Promise((resolve) => {
      child = spawn(process.execPath, args, { stdio: "ignore", windowsHide: true });
      child.on("error", () => resolve(1));
      child.on("exit", (c) => resolve(c ?? 1));
    });
    if (stopping) return 0;
    if (code === LOCKED) { log("another worker is running, so this one stops"); return LOCKED; }
    pause = Date.now() - started > 10 * 60000 ? 20000 : Math.min(pause * 2, 300000);
    log(`the worker stopped (exit ${code}); starting it again in ${Math.round(pause / 1000)} s`);
    await new Promise((r) => setTimeout(r, pause));
    if (stopping) return 0;
  }
}
