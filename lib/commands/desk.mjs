// The Wingman's desk in the browser: opens the page the worker serves, or serves it here when no
// worker runs (until this window is closed or Ctrl+C).
import { loadWorkerEnv } from "../core/paths.mjs";
import { workerAlive } from "./_common.mjs";

export const meta = { name: "desk", summary: "open the Wingman's desk in your browser", usage: "desk [--setup] [--no-open]", flags: { bool: ["setup", "no-open"] } };

export async function run(ctx) {
  const { deskUrl, deskUp, openInBrowser } = await import("../desk/secret.mjs");
  const port = ctx.settings.desk_port;
  const url = deskUrl(ctx.settings, ctx.paths, ctx.flags.setup ? "setup" : "");
  const open = () => { if (!ctx.flags["no-open"]) openInBrowser(url); };
  if (await deskUp(port)) {
    open();
    ctx.print(`The Wingman's desk: ${url}`);
    return 0;
  }
  loadWorkerEnv(ctx.paths.workerEnv);
  const { startDesk } = await import("../desk/server.mjs");
  let d;
  try { d = await startDesk({ mcDir: ctx.mcDir, stateDir: ctx.stateDir, port, log: (l) => ctx.print(l) }); }
  catch (e) { ctx.fail(`The desk could not start on port ${port}: ${e.code === "EADDRINUSE" ? "another program uses that port; choose another one with desk_port in the settings" : e.message}`); return 1; }
  open();
  ctx.print(`The Wingman's desk: ${url}\nIt runs here until you close this window or press Ctrl+C.${workerAlive(ctx.paths) ? "" : "\nThe Wingman itself is not running, so what you ask for there waits until it is back."}`);
  await new Promise((resolve) => {
    for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) { try { process.on(sig, resolve); } catch { /* not on this system */ } }
  });
  await d.close();
  return 0;
}
