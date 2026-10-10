#!/usr/bin/env node
// godspeed-wingman: the Wingman, an add-on for Godspeed Mission Control. It reads the profiles a
// dating site suggests, likes or passes at a person's pace, learns from the owner's practice
// answers, stops for names they watch, and brings matches and messages with three reply ideas.
//
// Every command lives in lib/commands/ (one file each, found by the registry there); this file
// only starts it. `godspeed-wingman help` lists them.
import { main } from "../lib/commands/index.mjs";

const argv = process.argv.slice(2);
let code = 1;
try {
  code = await main(argv);
} catch (e) {
  console.error(`godspeed-wingman: ${e?.message || e}`);
  code = 1;
}
// The worker ends only when it is stopped; every other command ends here, even when a network
// connection would keep Node waiting for a few more seconds.
process.exit(code);
