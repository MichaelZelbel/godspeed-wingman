// What the assistant sees before each turn (the Hermes plugin and the Claude Code hook run this).
// It never fails loudly: a broken Wingman must never break the assistant.
export const meta = { name: "context", summary: "what the assistant sees before each turn", usage: "context [--hook claude]", flags: { value: ["hook"] } };

export async function run(ctx) {
  try {
    const { render } = await import("../core/context.mjs");
    const out = render(ctx.paths, ctx.settings);
    if (!out) return 0;
    if (ctx.flags.hook === "claude") ctx.print(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: out } }));
    else ctx.print(out);
  } catch { /* the assistant must never break on this */ }
  return 0;
}
