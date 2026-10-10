# How the Wingman is built

For contributors and for coding helpers. The Wingman is plain Node.js 22 with no npm packages at
all: global `fetch` and `WebSocket`, `node:test` for the tests.

## The parts

```
bin/godspeed-wingman.mjs     starts a command; nothing else
lib/commands/                one file per command, found by a registry (a new command is a new file)
lib/core/                    everything that does not depend on a site:
                               worker      the loop: daily session, pacing, inbox, housekeeping
                               judge       like or pass, from the preferences and the examples
                               replies     three reply ideas, and sending the one picked
                               training    practice and review answers, the switch to autopilot
                               watch       the watch list
                               archive     the kept profiles, the retention, the disk guard
                               requests    the queue between the assistant and the worker
                               context     the block the assistant sees before each message
                               model       the model lanes (claude, codex, openai)
                               settings, paths, store, text, collection, notebook, sync
lib/sites/                   the site registry and the adapter contract (contract.md)
lib/sites/flirtual/          the first site adapter
lib/sites/_template/         what `site new` copies: a website and an Android app variant
lib/drivers/                 how a site is reached:
                               chrome      the Wingman's own Chrome or Edge, over the DevTools protocol
                               bridge      a browser on another computer, through the Chrome Agent Bridge
                               android     an Android emulator, through adb
lib/android/                 setting up the emulator (Google's lists, Java, checked downloads)
lib/channels/                where the Wingman talks to you: desk, desktop (notifications), telegram
lib/desk/                    the desk: a small server on 127.0.0.1 and one self-contained page
lib/onboarding/              the setup questions, shared by the desk and the terminal
lib/setup/                   setup and uninstall: program copy, recipes, Hermes, Claude Code, service
starters/                    the four preferences starters and the setup's choices
skill/wingman/               the recipe the assistant follows every day
skill/wingman-add-site/      the recipe a coding helper follows to add a site
hermes/plugin/               the Hermes plugin that shows the assistant the open question
install.ps1, install.sh      the one-line installers
```

## Who does what

```
 you  <-- desk, notifications, Telegram -->  the worker  <-- driver -->  the dating site
  |                                           ^    |
  | "agree", "send 2"                         |    +--> the model (judge, reply ideas)
  v                                           |
 your assistant  -- godspeed-wingman ... -->  requests/ (one small file per request)
  ^
  +-- the open question, before every message (Hermes plugin or Claude Code hook)
```

- **The worker** is the only part that likes, passes or sends. It runs as you (a scheduled task,
  a LaunchAgent, a systemd service) and serves the desk.
- **Your assistant** never opens the dating site and never judges a profile. It passes your words
  on with the `godspeed-wingman` command its recipe names. The command drops a request file and
  waits for the worker's one-line answer. When the worker is not running, the request waits and is
  done when it is back.
- **The desk** sends what you do through the same requests, so the worker stays the only one that
  acts.

## A daily session

1. At `daily_start` in your time zone (once per day; later the same day if the computer was off),
   the worker starts a session on each site you switched on, one after another.
2. For each profile the site suggests: open it as a person would, keep a copy and a picture,
   check the watch list, ask the judge.
3. In practice, ask you and wait. On autopilot, wait a few seconds as if reading, then like or
   pass, exactly once.
4. A random pause between profiles (`wait_seconds`, 10 to 180 seconds), never a burst.
5. The session ends when the site has nobody left, the likes for the day are used up, or after
   `max_run_hours`.

Around the clock, every `inbox_every_minutes`, it checks for matches and messages and writes three
reply ideas for each.

## Sites

A site is a folder with `site.json` (what it is, what its terms say, what the adapter can do) and
`adapter.mjs`. The registry loads the built-in sites and the ones in your mission control
(`routines/wingman/sites/<id>/`). It **refuses a site whose terms were never read, and uses a
site whose terms forbid automated use only by the person's own choice**, recorded with the date in
`settings.json` (`terms_risk_accepted`); without it, it says what the terms say and how to go
ahead. The whole contract is in
[lib/sites/contract.md](../lib/sites/contract.md); how to add one is in
[adding-a-site.md](adding-a-site.md).

Several sites can be on at once. Practice and autopilot are per site; your answers teach every
site, because taste does not change per site. Every record carries the site's id.

## Safety rules in the code

- **The settings file may choose, never point.** `settings.json` is in git and the assistant can
  edit it, so it can choose which model lane and model name, never a program to run or an address
  to send profiles to. Addresses and keys come from the environment or the private `worker.env`.
- **Strangers' text is data.** It reaches the model inside a fence marked as data, and reaches the
  assistant only as one cleaned short line.
- **Changes happen once.** Like, pass and send are never retried; only reads are.
- **`site check` cannot change anything.** It runs the adapter with `like`, `pass`, `skip` and
  `send` replaced by errors, and every request the page makes goes through a guard that allows
  reads only.
- **Your own adapters are code the worker runs.** On Linux and macOS it refuses one that another
  account could change.
- **The desk** answers only on 127.0.0.1, only to a browser with its key, and takes changes only
  from its own page.

## Tests

```
node --test "test/*.test.mjs"
```

They run on Windows, macOS and Linux with Node 22 and 24 on every push. The tests use invented
people only, a pretend site, a pretend adb and a stand-in model; one test drives a real Chrome or
Edge when the machine has one and skips otherwise.
