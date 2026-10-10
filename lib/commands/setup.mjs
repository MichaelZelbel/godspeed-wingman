// Adding the Wingman to this machine's Godspeed Mission Control, and taking it out again.
const SETUP_FLAGS = {
  value: ["site", "browser", "bridge", "talk", "hermes-home", "hermes-profile", "telegram-env", "timezone", "daily-start", "app", "notebook", "screenshots-url"],
  bool: ["no-service", "no-hermes", "no-claude", "yes", "delete-state"],
};

export const commands = [
  {
    meta: {
      name: "setup", needs: "none", flags: SETUP_FLAGS,
      summary: "add the Wingman to this machine's mission control",
      usage: "setup [--site flirtual] [--browser local|bridge] [--bridge URL] [--talk desk,desktop,telegram] [--hermes-home DIR | --hermes-profile NAME] [--no-service] [--yes]",
    },
    async run(ctx) {
      const { setup } = await import("../setup/index.mjs");
      return setup(ctx.flags);
    },
  },
  {
    meta: { name: "uninstall", needs: "none", flags: SETUP_FLAGS, summary: "take the Wingman out (your own files stay)", usage: "uninstall [--delete-state] [--yes]" },
    async run(ctx) {
      const { uninstall } = await import("../setup/index.mjs");
      return uninstall(ctx.flags);
    },
  },
];
