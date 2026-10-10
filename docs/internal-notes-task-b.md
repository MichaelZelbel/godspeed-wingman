# Internal notes from task B (delete before publishing)

Written 2026-10-10 by the coding helper that built the desk and the onboarding. Tests:
`node --test "test/*.test.mjs"`, 197 passing on Windows 11 / Node 22.19 (168 from task A, 29 new).

## What was added

```
starters/                      the four starters and options.json from Mission Control (content unchanged)
lib/onboarding/index.mjs       questions(sites), cleanAnswers, renderPreferences, settingsFrom, apply, detect, WELCOME
lib/onboarding/terminal.mjs    terminalWizard (readline, scripted input in tests), afterSetup (what setup does next)
lib/desk/server.mjs            createDesk / startDesk / keepDeskServed, every route, watchText
lib/desk/view.mjs              what the page shows (state, pictures by reference, who, log, messages)
lib/desk/secret.mjs            the per-install key (<state>/desk/secret), deskUrl, deskUp, openInBrowser
lib/desk/app.html              the one self-contained page (wizard + practice, matches, who, preferences, status)
lib/channels/desktop.mjs       notifications (Windows toast via Windows PowerShell + WinRT, osascript, notify-send)
lib/channels/desk.mjs          now: ready() says whether the page is served; recent() for the page
lib/commands/desk.mjs          `godspeed-wingman desk [--setup] [--no-open]`
docs/assets/desk-*.png         README screenshots (invented, drawn people only)
```

Changed in task A's files: settings key `onboarded` (true | false | "YYYY-MM-DD"; a new install writes
false and no daily session runs until the questions are answered; a file without the key counts as
done), request type `welcome` (sent once, state.welcome), `worker` serves the desk in-process (not with
--once, not with GODSPEED_WINGMAN_NO_DESK=1), ChromeDriver.detach(), setup flags --wizard,
--no-wizard, --terminal, the program copy skips docs/.

## For task D (README, install)

- `setup` after the install: desktop opens the desk at `#setup` (waits up to 20 s for the worker's
  desk; with a terminal attached and no desk answering it serves the desk itself until Ctrl+C);
  without a screen it asks in the terminal. **`curl ... | bash` gives node a pipe as stdin**, so the
  terminal wizard does not run there; have install.sh run `godspeed-wingman setup ... </dev/tty`
  (or tell the person `godspeed-wingman setup --wizard`). Same for PowerShell `irm | iex` if stdin is
  not a console there (opening the desk on Windows does not need stdin).
- The README draft's "Your first ten minutes" order matches the wizard; the "Training" table answers
  work on the desk (Agree / Disagree, a reason box, "Only this once" checkbox).
- Desk URL: `http://127.0.0.1:47860/`, opened once with `?t=<key>` (the desk command, setup, a
  notification click), then a cookie. Opening the bare address in another browser shows "This page
  needs its key" with the command to run.
- Notifications never show a stranger's name or words (lock screens); the desk shows the rest.

## Checked for real on this PC

- One real Windows toast (it landed in the notification history; cleared afterwards).
- The real worker with an invented demo site adapter and a stand-in model (`GODSPEED_WINGMAN_MODEL_CMD`)
  in scratch folders: the worker served the desk in-process, practice questions arrived, Agree by key,
  Disagree with a reason by key, a reply idea sent through the confirm dialog; the demo site received
  exactly those likes and the one message.
- "Open the Wingman's browser" launched a throwaway Chrome profile at the demo site's login page
  (https://example.com/) and left the tab open; closed afterwards.
- Not done for real: the model "Test it" button (no paid call made), Telegram test (no bot on this PC),
  macOS and Linux notifications (command lines checked in tests only).
- One slip: running `check` against the throwaway Flirtual settings loaded https://flirtu.al/en once
  in a blank throwaway browser profile and asked its API for a session (none, no login). No account
  was involved; the browser was closed right after.
