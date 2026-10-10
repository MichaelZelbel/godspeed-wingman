// Adding the Wingman to this machine's Godspeed Mission Control, and taking it out again.
// Without flags that answer them, the setup questions follow the install: on a desktop in the
// browser (the desk's wizard), without a screen in the terminal. --no-wizard skips them,
// --wizard asks them again, --terminal asks them in the terminal even on a desktop.
const SETUP_FLAGS = {
  value: ["site", "browser", "bridge", "talk", "hermes-home", "hermes-profile", "telegram-env", "timezone", "daily-start", "app", "notebook", "screenshots-url"],
  bool: ["no-service", "no-hermes", "no-claude", "yes", "delete-state", "wizard", "no-wizard", "terminal"],
};

export const commands = [
  {
    meta: {
      name: "setup", needs: "none", flags: SETUP_FLAGS,
      summary: "add the Wingman to this machine's mission control",
      usage: "setup [--site flirtual] [--browser local|bridge] [--bridge URL] [--talk desk,desktop,telegram] [--hermes-home DIR | --hermes-profile NAME] [--no-service] [--yes] [--wizard | --no-wizard] [--terminal]",
    },
    async run(ctx) {
      const { setup } = await import("../setup/index.mjs");
      const code = await setup(ctx.flags);
      if (code !== 0 || ctx.flags["no-wizard"]) return code;
      const { afterSetup } = await import("../onboarding/terminal.mjs");
      return afterSetup(ctx.flags);
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
