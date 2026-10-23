// Who was that? Searches every profile kept: names, other names they go by, Discord names, bios.
// With the notebook list of likes and passes switched on, it also says for each one whether they
// are in that list, with a link to their item: the assistants cannot see the list (it is hidden
// from them on purpose), so this is how they know.
import { clean } from "../core/text.mjs";
import { readJson } from "../core/store.mjs";
import { listSites } from "../sites/index.mjs";
import { stateOf } from "./_common.mjs";

export const meta = { name: "who", summary: "who was that? searches every profile kept", usage: 'who "<name>" [--photo]', flags: { bool: ["photo"] } };

const LIST = '"Wingman: likes and passes"';

// The line under each person about the notebook list, or null when the list is off or deleted
// (one line at the end says that instead).
async function listLine(ctx) {
  const s = stateOf(ctx.paths);
  const c = s.collection;
  if (!ctx.settings.notebook_collection) return { end: c?.id && !c.removed ? `The notebook list ${LIST} is off, so the Wingman writes nothing new into it.` : null };
  if (c?.removed) return { end: `The notebook list ${LIST} was deleted in the notebook, so nobody is in it.` };
  const { rowKeys, itemLink } = await import("../core/collection.mjs");
  const keys = rowKeys(ctx.paths);
  const held = readJson(ctx.paths.collectionItems, null);
  const items = held && c?.id && held.collectionId === c.id ? held.items || {} : {};
  const web = typeof c?.web === "string" ? c.web : null;
  const local = !!web && /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/i.test(web);
  return {
    line(h) {
      const k = `${h.site}:${h.id}`;
      const item = items[k];
      if (item) {
        const link = itemLink(web, c.slug, item);
        if (link) return `  In your notebook list ${LIST}: ${link}${local ? " (opens only on the computer the notebook runs on)" : ""}`;
        return `  In your notebook list ${LIST}. The notebook does not know its own web address, so there is no link: open your notebook where you usually do, then Collections.`;
      }
      if (keys.has(k)) return `  Not in your notebook list ${LIST} yet: the Wingman adds them at its next update of the list.`;
      return `  Not in your notebook list ${LIST}: the Wingman has no like, pass or match of theirs.`;
    },
  };
}

export async function run(ctx) {
  const q = ctx.rest.join(" ");
  const { search, picturePath } = await import("../core/archive.mjs");
  const hits = search(ctx.paths, q);
  if (!hits.length) { ctx.print(`Nobody called "${q}" among the profiles kept from the last ${ctx.settings.retention_days} days.`); return 0; }
  const names = Object.fromEntries(listSites({ mcDir: ctx.mcDir }).map((s) => [s.id, s.name]));
  const several = new Set(hits.map((h) => h.site)).size > 1 || ctx.settings.sites.length > 1;
  const list = await listLine(ctx);
  for (const h of hits) {
    const o = h.outcome;
    const yours = o?.by === "you" ? " (your call)" : "";
    const what = !o ? "seen" : o.action === "like" ? `liked${yours}` : o.action === "pass" ? `passed${yours}` : o.action;
    const how = h.source === "liked-you" ? "they liked you" : h.source === "match" ? "a match" : h.source === "message" ? "they wrote you" : "in your queue";
    const dc = h.discord || o?.discordFound;
    const other = Object.entries(h.handles || {}).filter(([, v]) => String(v).toLowerCase() !== String(h.name || "").toLowerCase()).slice(0, 2);
    const ids = [...other.map(([k, v]) => `${clean(k, 20)} ${clean(v)}`), dc && `Discord ${clean(dc)}`].filter(Boolean).join(", ");
    const where = several ? ` on ${names[h.site] || h.site}` : "";
    ctx.print(`${clean(h.name)} (${how}${where}, ${h.day}): ${what}${o?.reason ? `, because ${clean(o.reason, 200)}` : ""}.${ids ? ` ${ids}.` : ""} ${h.url}`);
    if (list.line) ctx.print(list.line(h));
  }
  if (list.end) ctx.print(list.end);
  if (ctx.flags.photo) {
    const pic = picturePath(ctx.paths, hits[0]);
    if (pic) {
      const { tell } = await import("../channels/index.mjs");
      const r = await tell(`${clean(hits[0].name)}, as ${names[hits[0].site] || hits[0].site} showed them on ${hits[0].day}`, pic, { settings: ctx.settings, paths: ctx.paths });
      ctx.print(r.delivered ? "(picture sent)" : "(the picture could not be sent)");
    }
  }
  return 0;
}
