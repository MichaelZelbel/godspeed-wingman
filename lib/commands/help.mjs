// The command list, from the registry.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
export const version = () => JSON.parse(fs.readFileSync(PKG, "utf8")).version;

export const commands = [
  {
    meta: { name: "help", summary: "this list", usage: "help", flags: {}, needs: "none", aliases: ["--help"] },
    run(ctx) {
      const rows = [...ctx.commands.entries()].filter(([n, c]) => !c.alias && !c.meta.hidden && n === c.meta.name);
      ctx.print(`godspeed-wingman ${version()}: the Wingman, an add-on for Godspeed Mission Control.\n`);
      for (const [, c] of rows) {
        const u = `godspeed-wingman ${c.meta.usage}`;
        ctx.print(u.length <= 58 ? `  ${u.padEnd(58)} ${c.meta.summary}` : `  ${u}\n  ${"".padEnd(58)} ${c.meta.summary}`);
      }
      ctx.print("\nEvery command takes --godspeed <mission control folder> and --state <private folder>; the installed command fills both in.");
      return 0;
    },
  },
  {
    meta: { name: "version", summary: "the version", usage: "version", flags: {}, needs: "none", aliases: ["--version"] },
    run(ctx) { ctx.print(version()); return 0; },
  },
];
