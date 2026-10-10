// The owner's own files in mission control: preferences and the watch list.
import fs from "node:fs";
import path from "node:path";

export const commands = [
  {
    meta: { name: "prefs", summary: "the owner's preferences: show, add a line, where the file is", usage: 'prefs show | add "<their words>" | path', flags: {} },
    async run(ctx) {
      const sub = ctx.rest[0] || "show";
      const file = ctx.routine.preferences;
      if (sub === "path") { ctx.print(file); return 0; }
      if (sub === "show") { try { ctx.print(fs.readFileSync(file, "utf8")); } catch { ctx.print("No preferences written yet."); } return 0; }
      if (sub === "add") {
        const words = ctx.rest.slice(1).join(" ").trim();
        if (!words) { ctx.fail('Say: prefs add "<their words>"'); return 1; }
        let text = "";
        try { text = fs.readFileSync(file, "utf8"); } catch { text = "# Who I am looking for\n"; }
        const day = new Date().toISOString().slice(0, 10);
        if (!/^## Added later/m.test(text)) text = text.replace(/\s*$/, "\n\n## Added later\n");
        text = text.replace(/\s*$/, `\n- ${words} (${day})\n`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        const { syncInBackground } = await import("../core/sync.mjs");
        syncInBackground(ctx.mcDir, "wingman: a preference added", ctx.settings.sync);
        ctx.print(`Added to your preferences: ${words}`);
        return 0;
      }
      ctx.fail('Say: prefs show | add "..." | path');
      return 1;
    },
  },
  {
    meta: { name: "watch", summary: "the watch list: names that stop everything", usage: 'watch list | add "<name>" | remove "<name>"', flags: {} },
    async run(ctx) {
      const { readWatch, addWatch, removeWatch } = await import("../core/watch.mjs");
      const { syncInBackground } = await import("../core/sync.mjs");
      const sub = ctx.rest[0] || "list";
      const name = ctx.rest.slice(1).join(" ").trim();
      const file = ctx.routine.watch;
      if (sub === "list") { const n = readWatch(file); ctx.print(n.length ? `Watch list: ${n.join(", ")}` : "The watch list is empty."); return 0; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (sub === "add" && name) { ctx.print(addWatch(file, name) ? `${name} is on the watch list.` : `${name} was already on it.`); syncInBackground(ctx.mcDir, "wingman: watch list changed", ctx.settings.sync); return 0; }
      if (sub === "remove" && name) { ctx.print(removeWatch(file, name) ? `${name} is off the watch list.` : `${name} was not on it.`); syncInBackground(ctx.mcDir, "wingman: watch list changed", ctx.settings.sync); return 0; }
      ctx.fail('Say: watch list | add "<name>" | remove "<name>"');
      return 1;
    },
  },
  {
    meta: { name: "_sync", summary: "commit routines/wingman (used in the background)", usage: "_sync <message>", flags: {}, hidden: true },
    async run(ctx) {
      const { commitRoutine } = await import("../core/sync.mjs");
      ctx.print(commitRoutine(ctx.mcDir, ctx.rest[0] || "wingman: settings changed", ctx.settings.sync));
      return 0;
    },
  },
];
