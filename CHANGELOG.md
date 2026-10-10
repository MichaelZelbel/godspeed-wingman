# Changelog

## 0.5.2 (2026-10-10)

A new install now starts the setup from the starters, and the model question helps people who
think with ChatGPT.

- **The starters come first on a new install.** The installer writes an empty preferences page,
  and the setup took it for a page you wrote: it offered "Keep mine", already chosen, and left out
  the starter, the green flags and deal-breakers, and how you write. Pressing Continue kept an
  empty page. Now the empty page counts as no page, on the desk and in the terminal: you go
  straight to the starters, and saving replaces it. A page with any line of your own is still
  offered to keep, as before.
- **Codex for ChatGPT accounts.** When neither Claude Code nor Codex is on the computer, the
  question "Who does the thinking?" shows the one line that installs Codex, OpenAI's assistant
  program, then `codex login` and "Sign in with ChatGPT" (any plan works; the free one has a small
  allowance). "Look again" (Enter in the terminal) finds it without starting over. The Wingman
  also finds Codex where that installer puts it when it is not on the PATH yet.
- **Starters read better.** "Looking for a partner" no longer says "not looking for anyone who
  fits" when you chose "Anyone who fits", nor "they live anywhere ... so we can be online at the
  same time". Ticking "Only wants friends" adds no second line when the starter already says it.
- **The book:** *Teach It Once* has a chapter about the Wingman, Chapter 41, "Let Your Mission
  Control Be Your Wingman".

If you went through the setup with 0.5.1 on a new install and kept the empty page,
`godspeed-wingman desk --setup` (or `godspeed-wingman setup --wizard` on a server) now offers the
starters.

## 0.5.1 (2026-10-10)

The notebook list of likes and passes is now off unless you switch it on.

- **Why:** the list "Wingman: likes and passes" keeps names, ages and places of strangers with no
  end date, while everything else about other people is deleted after the days you chose.
- **Switching it on:** the setup questions offer it as one choice, unticked, only when your
  Godspeed notebook answers on this computer. Or set `"notebook_collection": true` in
  `routines/wingman/settings.json`. Only an explicit `true` switches it on.
- **If you used it before:** an install whose settings do not say `true` stops adding to the list.
  What the list already holds stays in your notebook until you delete it there.

## 0.5.0 (2026-10-10)

The first public release. The Wingman is now an add-on that anyone with Godspeed Mission Control
can add.

- **One line to add it:** `install.ps1` for Windows, `install.sh` for macOS and Linux, and steps for
  assistants (`INSTALL-FOR-ASSISTANTS.md`). Running the line again is the update.
- **Runs on your own computer,** no server needed: a scheduled task on Windows, a LaunchAgent on
  macOS, a systemd user service on a Linux desktop, with its own Chrome or Edge.
- **The desk:** a page on your computer (`http://127.0.0.1:47860`) for practice, matches and reply
  ideas, "who was that?", your preferences and the status. Notifications on Windows, macOS and
  Linux.
- **The setup questions,** in the browser or the terminal, with four starters so nobody faces a
  blank preferences page, and a guided first practice round.
- **Several sites.** Flirtual is the first site adapter, not the only one. Practice and autopilot
  are per site. Every site records what its terms say about bots and AI, and the Wingman refuses a
  site whose terms forbid it.
- **Adding a site:** `godspeed-wingman site list | new | terms | check | use | off | login |
  network`, a template, and the recipe `wingman-add-site` for a coding helper. `site check` reads
  only and cannot like, pass or send.
- **Android (experimental):** an emulator for services that only have an app
  (`godspeed-wingman android setup`).
- **Models:** Claude Code, Codex, or any OpenAI-compatible model.
- **Speaks of everyone neutrally:** the messages, the prompts and the docs assume nothing about who
  you are or whom you like.
- **Private by default:** the retention is 42 days; everything about other people stays in a
  private folder outside git.

## 0.1 to 0.4

A private add-on, used by its author on a server through Telegram, on one site.
