# The Wingman on your own computer

On Windows, macOS or a Linux desktop, the Wingman runs as you, on your computer. It needs no
server. Three parts make that work: the worker, the desk page and notifications.

## The worker

The worker does the work: the daily session, the inbox checks, the practice questions. The setup
starts it and makes sure it starts again whenever you log in.

| System | What runs it | Look at it |
|---|---|---|
| Windows | the scheduled task "Godspeed Wingman": at logon, as you, without a window, started again when it stops | Task Scheduler, or `schtasks /Query /TN "Godspeed Wingman"` |
| macOS | the LaunchAgent `com.godspeed.wingman` in `~/Library/LaunchAgents` | `launchctl print gui/$(id -u)/com.godspeed.wingman` |
| Linux desktop | the systemd user service `godspeed-wingman.service` | `systemctl --user status godspeed-wingman` |

`godspeed-wingman check` says whether the worker runs, and how to start it when it does not.
`godspeed-wingman pause` and `resume` stop and restart the work without stopping the worker.

**Your computer has to be on.** The daily session starts at the time you chose (18:30 unless you
chose another). If the computer was off or asleep then, it starts as soon as the worker runs again
that day. A session ends after six hours at most (`max_run_hours`). Matches and messages are
checked every 30 minutes while it runs (`inbox_every_minutes`).

## The desk

The Wingman's desk is a page in your browser at `http://127.0.0.1:47860/`. It has five parts:

- **Practice:** the open question, the picture of the profile, Agree and Disagree, a box for your
  reason, "Only this once", and your progress to 9 of 10. Keys: A agrees, D disagrees.
- **Matches:** new matches and messages with three reply ideas each, and a box for your own words.
  Nothing is sent before you confirm.
- **Who:** "who was that?" over every profile kept, with the picture.
- **Preferences:** your preferences page and your watch list, to read and change.
- **Status:** what runs, what waits, the login on each site, the settings you chose, and the setup
  questions again.

Open it with:

```
godspeed-wingman desk
```

The worker serves the page while it runs. When no worker runs, `godspeed-wingman desk` serves it
itself until you close that window. The page also fits a narrow window.

**Who can open it.** Only this computer: the page answers on 127.0.0.1 and nowhere else. It also
needs its key, a random secret in the private folder. `godspeed-wingman desk`, the setup and a
click on a notification open it with the key once; after that a cookie in that browser carries it.
Opening the bare address in another browser shows "This page needs its key" and the command to
run. Every change also has to come from the page itself, so another web page cannot use it.

**Another port.** If another program uses 47860, set `desk_port` in
`routines/wingman/settings.json` to a free port above 1024 and restart the worker.

## Notifications

A short note when a question or a match waits:

- **Windows:** a Windows notification. A click opens the desk.
- **macOS:** a notification through the system's own `osascript`.
- **Linux:** `notify-send` (the package `libnotify-bin` or `libnotify`).

Notifications never show a name, a picture or anything a stranger wrote, because they can appear on
a lock screen or a shared screen. The desk shows the rest. While the desk is open in front of you,
no notification comes. The setup's "Show a test notification" button sends one to try.

## The Wingman's browser

On your computer the Wingman uses its own copy of Chrome or Edge (Chromium works too), with its own
profile in the private folder (`~/.godspeed/wingman/browser`). Your everyday browser, its logins and
its history are never touched. You log into the dating site once in that browser: in the setup, on
the desk's Status page, or with `godspeed-wingman site login <site>`. It stays logged in.

It looks for Chrome first, then Edge, then Chromium. `GODSPEED_WINGMAN_BROWSER` in the worker's
private settings names another program. `browser_headless: true` in the settings runs it without a
window; only use that once the login works, because you cannot log in again in a window you cannot
see.

## Where things are on this computer

| What | Windows | macOS and Linux |
|---|---|---|
| The command | `%USERPROFILE%\.godspeed\bin\godspeed-wingman.cmd` | `~/.godspeed/bin/godspeed-wingman` |
| The program | `%USERPROFILE%\.godspeed\addons\godspeed-wingman` | `~/.godspeed/addons/godspeed-wingman` |
| The private folder | `%USERPROFILE%\.godspeed\wingman` | `~/.godspeed/wingman` |
| Your files | `<mission control>\routines\wingman` | `<mission control>/routines/wingman` |

The private folder is described in [privacy.md](privacy.md).

## Private settings for the worker

Some settings never go into `settings.json`, because that file is in git and the assistant can
change it: keys and addresses. They go into `worker.env` in the private folder, one `KEY=value`
per line, and the worker reads them when it starts. Only names that start with `GODSPEED_WINGMAN_`,
`BRIDGE_TOKEN`, and the key the OpenAI-compatible lane names are read.

```
# The OpenAI-compatible lane
GODSPEED_WINGMAN_OPENAI_BASE=https://api.openai.com/v1
OPENAI_API_KEY=...
# Another browser program
GODSPEED_WINGMAN_BROWSER=C:\Program Files\Chromium\chrome.exe
```

Restart the worker after a change (on Windows: sign out and in, or end and run the task again).
