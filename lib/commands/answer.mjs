// The owner's answer to the open question: agree or disagree (practice and review), like, pass or
// judge (a watch-list stop). --exception: a one-off the Wingman must not learn from.
import { readAnswer } from "../core/training.mjs";

export const commands = [
  {
    meta: {
      name: "answer", summary: "answer the open question", usage: 'answer agree|disagree|like|pass|judge [--about <id>] [--reason "<their words>"] [--exception]',
      flags: { value: ["about"], greedy: ["reason"], bool: ["exception"] },
    },
    async run(ctx) {
      const word = String(ctx.rest[0] || "").toLowerCase();
      const d = ["like", "pass", "judge", "agree", "disagree"].includes(word) ? word : readAnswer(word);
      if (!d) { ctx.fail('Say: answer agree | disagree | like | pass | judge [--reason "..."]'); return 1; }
      return ctx.viaWorker("answer", { decision: d, reason: ctx.flags.reason || "", about: ctx.flags.about || "", exception: !!ctx.flags.exception });
    },
  },
  {
    meta: { name: "exception", summary: "an answer already given was a one-off: never learn from it", usage: "exception --about <id or name>", flags: { value: ["about"] } },
    async run(ctx) {
      const about = ctx.flags.about || ctx.rest.join(" ").trim();
      if (!about) { ctx.fail("Say: exception --about <their id or name>"); return 1; }
      return ctx.viaWorker("exception", { about });
    },
  },
  {
    meta: { name: "send", summary: "send a reply idea, or the owner's own words", usage: 'send <1|2|3> [--to <R12|name>]   or   send --to <R12|name> --text "<their words>"', flags: { value: ["to"], greedy: ["text"] } },
    async run(ctx) {
      const option = ctx.rest[0] ? Number(ctx.rest[0]) : undefined;
      if (!option && !ctx.flags.text) { ctx.fail('Say: send <1|2|3> [--to R12] or send --to R12 --text "..."'); return 1; }
      return ctx.viaWorker("send", { option, to: ctx.flags.to || "", text: ctx.flags.text || "" });
    },
  },
];
