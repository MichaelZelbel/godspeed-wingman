// How the Wingman is doing: practice or autopilot per site, today's session, what waits.
import { readJson } from "../core/store.mjs";
import { clean } from "../core/text.mjs";
import { siteState } from "../core/state.mjs";
import { failureNote } from "../core/context.mjs";
import { listSites, choiceLine } from "../sites/index.mjs";
import { heartbeat, stateOf, diskLines } from "./_common.mjs";

export const meta = { name: "status", summary: "practice or autopilot per site, today's session, what waits", usage: "status", flags: {} };

export async function run(ctx) {
  const { agreement } = await import("../core/training.mjs");
  const { needingRetake } = await import("../core/archive.mjs");
  const set = ctx.settings;
  const s = stateOf(ctx.paths);
  const known = Object.fromEntries(listSites({ mcDir: ctx.mcDir }).map((x) => [x.id, x]));
  const name = (id) => known[id]?.name || id;
  const hb = heartbeat(ctx.paths);
  const ageS = hb ? Math.round((Date.now() - new Date(hb.at).getTime()) / 1000) : null;
  const lines = [];
  const tally = (id) => { const a = agreement(ctx.paths, set.practice_until.of, id); return `you agreed with ${a.agreed} of the last ${a.of} verdicts; autopilot at ${set.practice_until.agree} of ${set.practice_until.of}`; };
  if (!set.sites.length) lines.push("No site is switched on (sites in the settings).");
  if (set.sites.length === 1) {
    const id = set.sites[0];
    const ss = siteState(s, id);
    lines.push(`Mode: ${ss.mode === "auto" ? "autopilot (likes and passes on its own)" : "practice (every decision waits for your answer)"} on ${name(id)}${s.paused ? ", PAUSED" : ""}.`);
    lines.push(`Practice: ${tally(id)}.`);
  } else if (set.sites.length > 1) {
    lines.push(`Sites${s.paused ? " (PAUSED)" : ""}:`);
    for (const id of set.sites) {
      const ss = siteState(s, id);
      lines.push(`  ${name(id)}: ${ss.mode === "auto" ? "autopilot" : `practice, ${tally(id)}`}${ss.loggedOutAt ? `, logged out since ${ss.loggedOutAt}` : ""}.`);
    }
  }
  for (const id of set.sites) {
    const k = known[id];
    if (!k) lines.push(`${id}: the Wingman knows no such site.`);
    else if (k.refused) lines.push(`${k.name}: ${k.refused}`);
    else if (k.chosenOn) lines.push(`${k.name}: ${choiceLine(k.chosenOn)}.`);
    if (set.sites.length === 1 && siteState(s, id).loggedOutAt) lines.push(`${name(id)} logged the Wingman out (${siteState(s, id).loggedOutAt}); log in again in the Wingman's browser.`);
  }
  if (s.run) lines.push(`Session running since ${s.run.startedAt}${s.run.sites?.length > 1 ? `, now on ${name(s.run.sites[s.run.at || 0] || "")}` : ""}: ${s.run.liked} liked, ${s.run.passed} passed, ${s.run.asked} asked, ${s.run.stopped} stopped.`);
  else if (s.lastRun) lines.push(`Last session ${s.lastRun.startedAt} to ${s.lastRun.endedAt}: ${s.lastRun.liked} liked, ${s.lastRun.passed} passed, ${s.lastRun.asked} asked. Ended: ${s.lastRun.why}.`);
  else if (set.onboarded !== false) lines.push(`No session yet. The daily session starts at ${set.daily_start} (${set.timezone}).`);
  const failed = failureNote(s, set, new Date(), { maxAgeMs: Infinity });
  if (failed?.pending) lines.push(`Stopped at ${failed.when} after five errors in a row: ${failed.cause}. One more try today at ${failed.pending}.`);
  else if (failed) lines.push(`Stopped at ${failed.when} after five errors in a row: ${failed.cause}.${failed.retried ? ` A second try at ${failed.retried} stopped too.` : ""} ${failed.told ? "You were told." : "The message about it has not gone out yet."} \`godspeed-wingman check\` shows what failed.`);
  // A new install waits for the setup questions before its first daily session.
  if (set.onboarded === false) lines.push("The setup questions are not answered yet, so no daily session runs. Open them with: godspeed-wingman desk --setup (on a machine without a screen: godspeed-wingman setup --wizard).");
  if (s.waiting) lines.push(`Waiting for you: ${s.waiting.kind} question about ${clean(s.waiting.name)}${set.sites.length > 1 && s.waiting.siteName ? ` on ${clean(s.waiting.siteName)}` : ""}${s.waiting.notifiedAt ? "" : " (not delivered yet, retrying)"}.`);
  const replies = Object.values(readJson(ctx.paths.replies, {}) || {}).filter((x) => !x.sent);
  if (replies.length) lines.push(`Reply ideas waiting: ${replies.map((x) => `${x.id} ${clean(x.name)}`).join(", ")}.`);
  if (s.collection?.id && !set.notebook_collection && !s.collection.removed) lines.push(`Likes and passes: the notebook list is off, so nothing new is written to it. The ${s.collection.total} profiles it holds stay until you delete them in the notebook.`);
  else if (s.collection?.id) lines.push(s.collection.removed ? "Likes and passes: the collection was deleted in the notebook, so nothing is written to it." : `Likes and passes: the notebook collection "Wingman: likes and passes" holds ${s.collection.total} profiles (written ${s.collection.at}).`);
  for (const l of await diskLines(ctx, s)) lines.push(l.text);
  const retake = needingRetake(ctx.paths);
  if (retake.length) lines.push(`Screenshots: ${retake.length} kept profile(s) still to be pictured again as a whole profile, ${s.run ? "after the session" : s.paused ? "once resumed" : "one every 10 s to a minute"}${s.retake?.done ? ` (${s.retake.done} done so far)` : ""}.`);
  else if (s.retake?.finishedAt && Date.now() - new Date(s.retake.finishedAt).getTime() < 2 * 86400000) lines.push(`Screenshots: pictured again as whole profiles, finished ${s.retake.finishedAt}: ${s.retake.done || 0} new, ${s.retake.kept || 0} kept as they were.`);
  if (s.lastError) lines.push(`Last problem: ${s.lastError.text} (${s.lastError.at}).`);
  lines.push(hb ? `Worker last seen ${ageS} s ago.` : "The worker has not run yet.");
  ctx.print(lines.join("\n"));
  return 0;
}
