// Who was that? Searches every profile kept: names, other names they go by, Discord names, bios.
import { clean } from "../core/text.mjs";
import { listSites } from "../sites/index.mjs";

export const meta = { name: "who", summary: "who was that? searches every profile kept", usage: 'who "<name>" [--photo]', flags: { bool: ["photo"] } };

export async function run(ctx) {
  const q = ctx.rest.join(" ");
  const { search, picturePath } = await import("../core/archive.mjs");
  const hits = search(ctx.paths, q);
  if (!hits.length) { ctx.print(`Nobody called "${q}" among the profiles kept from the last ${ctx.settings.retention_days} days.`); return 0; }
  const names = Object.fromEntries(listSites({ mcDir: ctx.mcDir }).map((s) => [s.id, s.name]));
  const several = new Set(hits.map((h) => h.site)).size > 1 || ctx.settings.sites.length > 1;
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
  }
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
