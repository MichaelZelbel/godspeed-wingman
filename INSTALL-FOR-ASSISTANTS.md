# Adding the Wingman: steps for an AI assistant

You are an assistant, and your person said something like "add the Wingman", "install
godspeed-wingman" or "add the Wingman from github.com/MichaelZelbel/godspeed-wingman". Follow these
steps. Do the technical part yourself; the person answers only what is theirs to answer.

## The one rule

**Their taste is theirs.** Never answer the setup questions for them, never write
`routines/wingman/preferences.md` or the watch list from what you think you know about them (not
from memory, not from earlier chats, not from their notes), and never pick a starter for them. You
run the installer and open the questions; they answer.

## 1. Check that it fits

- Godspeed Mission Control has to be installed: a mission control folder that holds `AGENTS.md`.
  Note its path. If there is none, tell them in one sentence that the Wingman is an add-on for
  Godspeed Mission Control and point them to https://godspeedmissioncontrol.com/install.
- Find where the Wingman should run. On the computer they use every day (Windows, macOS, a Linux
  desktop) it runs there. When their mission control runs on a server with Telegram, it runs on the
  server, and it needs a computer at home with the Chrome Agent Bridge, 0.6.0 or newer, for the
  browser (`docs/server.md`). After an update of the bridge, every bridge instance on that computer
  must be restarted: each one runs the code it started with. If that is unclear, ask them which one, in one short question.
- Already installed? `godspeed-wingman version` answers. Running the installer again is the update.

## 2. Find the system

- Windows: `$env:OS` is `Windows_NT`, or `process.platform` is `win32`.
- macOS: `uname` says `Darwin`.
- Linux: `uname` says `Linux`. A server has no `DISPLAY` and no `WAYLAND_DISPLAY`.

## 3. Run the installer

Run it as the account the mission control belongs to (on a server, root works too).

**Windows**, in PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.ps1))) --godspeed "<mission control folder>"
```

**macOS or Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash -s -- --godspeed "<mission control folder>"
```

On a server, add `--browser bridge --bridge http://<home computer>:<port>` when you know the
bridge's address; otherwise the setup questions ask for it.

Read what it prints. Lines start with `ok` or `NOTE`; a `NOTE` says what is missing and what to do.
If the installer says Node.js 22 is missing, tell the person in one sentence and offer to install
it (`winget install OpenJS.NodeJS.LTS` on Windows, `brew install node` on macOS, the distribution's
Node.js 22 package on Linux). Installing a program is their call: ask first.

Options the person did not ask for stay out. Do not add `--yes`, `--no-wizard` or `--no-service`
on your own.

## 4. Open the setup questions for them

The installer opens them by itself when it can. When you ran it from a shell without a terminal:

- **On their own computer:** run `godspeed-wingman desk --setup`. It opens the setup in their
  browser (and keeps serving it while no worker runs, so start it in the background or a window of
  its own). Tell them: "The Wingman's setup is open in your browser. It takes about ten minutes,
  and the answers are yours."
- **On a server:** the questions run in a terminal: `godspeed-wingman setup --wizard`. They answer
  there, in an SSH session of their own. Or they open the desk through an SSH tunnel
  (`docs/server.md`, "The desk on a server"). Tell them the one command and what it is for.

If they ask you to go through it with them in the chat, ask each question as the setup asks it,
with its choices, and use their answers word for word. Never fill in an answer they did not give.

## 5. Check, then say what is next

```
godspeed-wingman status
godspeed-wingman check
```

`status` says whether the setup questions are answered. `check` says what fails and how to fix it;
fix what you can yourself. Two things only the person can do:

- **Log into the dating site once**, in the Wingman's own browser (the setup has a button for it,
  or `godspeed-wingman site login <site>`). On a server, in the bridge's Chrome at home.
- **The first practice round.** The setup's last page starts it, or they say "practice" to you
  and you run `godspeed-wingman train`.

From then on follow the recipe the installer put in their mission control, `skills/wingman`, and
`skills/wingman-add-site` when they want another site.

## 6. Never

- Never like, pass or message anyone yourself, and never open the dating site yourself.
- Never put the people the Wingman sees into the person's notes, memory or git.
- Never install it a second time somewhere else to make a command work. The command runs where the
  worker runs (their computer, or their server).
- Never weaken a terms check, and never skip telling the person what a site's terms say. A site
  whose terms forbid bots or automated use is built only when the person, told what they say and
  the risk, decides to go ahead (the recipe `wingman-add-site`); never refuse it for them.

## Taking it out

`godspeed-wingman uninstall` removes everything it added and keeps their files. It asks before
deleting the private folder with everything it kept about other people; that answer is theirs.
