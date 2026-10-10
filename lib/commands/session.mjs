// What the owner asks the worker to do now: a practice round, a review, a session, a pause.
const simple = (name, type, summary, extra = {}) => ({
  meta: { name, summary, usage: name, flags: {}, ...extra },
  run: (ctx) => ctx.viaWorker(type),
});

export const commands = [
  {
    meta: { name: "train", summary: "a practice round now (10 unless n)", usage: "train [n] [--site <id>]", flags: { value: ["site"] } },
    run: (ctx) => ctx.viaWorker("train", { count: Number(ctx.rest[0]) || undefined, site: ctx.flags.site || undefined }),
  },
  {
    meta: { name: "review", summary: "go through recent autopilot decisions", usage: "review [n]", flags: {} },
    run: (ctx) => ctx.viaWorker("review", { count: Number(ctx.rest[0]) || undefined }),
  },
  {
    meta: { name: "run", summary: "a session now", usage: "run [--site <id>]", flags: { value: ["site"] } },
    run: (ctx) => ctx.viaWorker("run", { site: ctx.flags.site || undefined }),
  },
  simple("pause", "pause", "nothing is liked, passed or read until resume"),
  simple("resume", "resume", "carry on after a pause"),
  simple("inbox", "inbox", "look for matches and messages now"),
  simple("stop", "stop-practice", "stop practising for now"),
  simple("notebook", "notebook", 'bring "Wingman: likes and passes" in the notebook level now'),
];
