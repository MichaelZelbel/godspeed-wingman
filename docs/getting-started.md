# Getting started

This page takes you from nothing to your first practice round. It takes about ten minutes.

## What you need

- **Godspeed Mission Control**, installed and working. The Wingman is an add-on: it lives next to
  your mission control and talks to you through it. No mission control yet? Start with
  [the install page](https://godspeedmissioncontrol.com/install) and Chapter 2 of
  [*Teach It Once*](https://leanpub.com/teachitonce).
- **Node.js 22 or newer.** Godspeed brings one, and so does Hermes; the installer finds it. If it
  finds none, it says so and stops.
- **A model.** The Wingman reads every profile with a language model: Claude Code, Codex, or any
  OpenAI-compatible model. Your mission control most likely has one of them already.
- **On a computer with a screen:** Chrome or Edge (Chromium works too). The Wingman runs its own
  copy with its own profile, apart from your everyday browser.
- **On a server:** see [server.md](server.md). The browser then sits on a computer at home.
- **An account on a dating site the Wingman knows.** Flirtual is built in. For another site, see
  [adding-a-site.md](adding-a-site.md).

## Install

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.ps1 | iex
```

**macOS or Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash
```

Or tell your mission control: "Add the Wingman from github.com/MichaelZelbel/godspeed-wingman."
It follows [the steps for assistants](../INSTALL-FOR-ASSISTANTS.md).

### What the installer does

1. It finds Node.js 22 or newer.
2. It downloads the newest release of the Wingman from GitHub into a temporary folder.
3. It runs the Wingman's setup, which:
   - copies the program to `~/.godspeed/addons/godspeed-wingman` and adds the `godspeed-wingman`
     command to `~/.godspeed/bin` (on Windows `%USERPROFILE%\.godspeed\...`);
   - makes the private folder `~/.godspeed/wingman` for everything about other people;
   - writes your files in your mission control, in `routines/wingman/`: `settings.json`,
     `preferences.md` and `watch.md`. Files you already have are never overwritten;
   - copies two recipes into your mission control's `skills/` folder: `wingman` (daily use) and
     `wingman-add-site` (for adding a site);
   - connects your assistant: a Hermes plugin and, when your mission control uses Claude Code, a
     Claude Code hook. Both show the assistant the open question before each message;
   - starts the worker, the part that does the work, and makes sure it starts again after a
     restart: a scheduled task on Windows, a LaunchAgent on macOS, a systemd service on Linux;
   - saves your new files in your mission control's git history.
4. It opens the setup questions: in your browser on a computer with a screen, in the terminal on
   a server.
5. It deletes the temporary folder.

When `godspeed-wingman` is not found afterwards, open a new terminal. `~/.godspeed/bin` is on the
PATH on Godspeed machines; if it is not on yours, add it.

### Options

Anything after the installer goes to the setup. On Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.ps1))) --godspeed D:\my-mission-control
```

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash -s -- --godspeed ~/my-mission-control
```

The options you are most likely to need:

```
--godspeed <folder>        your mission control, when the setup does not find it by itself
--daily-start 19:00        the time of the daily session (18:30 unless you say otherwise)
--timezone Europe/Vienna   your time zone (this computer's unless you say otherwise)
--talk desk,desktop        where it talks to you: desk, desktop (notifications), telegram
--browser bridge --bridge http://<home computer>:3007    the browser on another computer (server.md)
--no-service               no scheduled task or service; you start `godspeed-wingman worker` yourself
--no-wizard                no setup questions now; open them later with `godspeed-wingman desk --setup`
--terminal                 ask the setup questions in the terminal, even on a computer with a screen
```

`godspeed-wingman help` lists every command and option.

### How it finds your mission control

In this order: `--godspeed`, the environment (`GODSPEED_WINGMAN_DIR`, `GODSPEED_ROOT`,
`GODSPEED_DIR`), the folder Godspeed wrote into `~/.godspeed/device.env`, the folder you run it in
(or one above it), then `~/godspeed-v2` and `~/godspeed`. A folder counts when it holds `AGENTS.md`.

## The setup questions

They come one page at a time. Nothing goes to the model or to a dating site while you answer,
unless you press one of the test buttons.

1. **Hello.** What the Wingman does and never does.
2. **Your site.** The sites it knows, and how to add another one.
3. **You, and who you are looking for.** A few choices: who you are in a few words, who you are
   looking for, the ages, where they live.
4. **A starting point.** Four starters: looking for a partner, flirty and playful, friends first,
   just exploring. Each fills in a whole preferences page from your answers, so you never start
   with a blank page. You see the page as it would start.
5. **Clear yes and clear no.** Green flags and deal-breakers to tick, and your own.
6. **How you write.** The tone of your reply ideas, a message you liked (optional), the language.
7. **When.** The daily session's time, your time zone, how many days it remembers the people it
   saw (42 unless you choose another number). When your Godspeed notebook answers on this
   computer, one more choice: "Also keep a list of every like and pass in my Godspeed notebook (it
   stays until I delete it)". It is unticked, so the list is off unless you tick it. Unlike
   everything else about other people, that list is not deleted after the days you chose.
8. **Where it talks to you.** The desk page, notifications, Telegram when your assistant has a bot.
   Buttons send a test.
9. **Log in once.** "Open the Wingman's browser" opens the site's login page in the Wingman's own
   browser. Log in there; it stays logged in. "Check my login" tells you it worked.
10. **Who does the thinking.** The model lanes this computer has, with a "Test it" button that
    makes one small call.
11. **A last look.** Your preferences page as the Wingman will read it, to change as you like, and
    names to watch.
12. **Done.** "Start my first practice round" starts ten profiles.

Your answers go into `routines/wingman/preferences.md`, `settings.json` and `watch.md`. Until you
finish, no daily session runs; `godspeed-wingman status` says so.

On a server the same questions come in the terminal. Run them again any time with
`godspeed-wingman desk --setup` (in the browser) or `godspeed-wingman setup --wizard` (in the
terminal). Your old preferences page is kept in the private folder when you replace it.

## The first practice round

The Wingman opens a profile, says what it would do and why, and waits for you. Agree, or disagree
and say why. After ten profiles the round ends. See [training.md](training.md).

## Check that everything works

```
godspeed-wingman status
godspeed-wingman check
```

`status` says whether each site is in practice or on autopilot, when the next session runs and
what waits for you. `check` goes through every part (the worker, your preferences, the disk, each
way it talks to you, the model, the browser and the login on each site) and says what to do when
one fails. It opens the Wingman's browser to see the login.

## Update

Run the install line again. It downloads the newest release, stops the running worker, replaces
the program and starts it again. Your preferences, watch list, settings and everything the Wingman
kept stay as they are.

## Take it out

```
godspeed-wingman uninstall
```

It removes the scheduled task or service, the command, the program copy, the Hermes plugin, the
Claude Code hook and the recipes it put in your mission control. Your own files in
`routines/wingman/` stay. Then it asks whether to delete the private folder with every profile,
picture and answer it kept; `--delete-state` says yes in advance.
