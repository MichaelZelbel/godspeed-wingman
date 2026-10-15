# The Wingman on a server

When your mission control runs on a server (Chapter 2 and Chapter 34 of
[*Teach It Once*](https://leanpub.com/teachitonce)), the Wingman can run there too, around the
clock. You train it on your phone, in the Telegram chat you already use with your assistant.

## How the parts fit

```
 your phone                     the server                              a computer at home
 ----------                     ----------                              ------------------
 Telegram  <-- messages ---  the Wingman's worker  --- page requests --> Chrome Agent Bridge
    |                          (systemd service)                         a real Chrome, logged
    | your replies                   ^                                   into the dating site
    v                                | godspeed-wingman answer ...
 Hermes (your assistant)  -----------+
   sees the open question before every message (the Wingman's plugin)
```

- **The worker** runs on the server as a systemd service.
- **Telegram:** the worker sends its messages and pictures through your assistant's own Telegram
  bot. Hermes owns the bot; the Wingman only sends. Your replies go to your assistant, which sees
  the open question (the Wingman's Hermes plugin shows it before every message) and passes your
  answer on with the `godspeed-wingman` command its recipe names.
- **The browser** sits on a computer at home, behind the
  [Chrome Agent Bridge](https://github.com/MichaelZelbel/chrome-agent-bridge). Dating sites often
  look at where a login comes from, and a server's address is not a home. A real Chrome on your
  home connection, with your login in it, is what it looks like: you, on your computer. The
  worker only asks the bridge to open a page, run the site's own requests in it, and take a
  picture.

## What you need

- A server with Godspeed Mission Control and Hermes, with Telegram set up for Hermes.
- Node.js 22 or newer on the server. Hermes brings one (`~/.hermes/tools/node-*`); the installer
  finds it.
- A computer at home with the Chrome Agent Bridge, 0.6.0 or newer, reachable from the server over
  a private network such as Tailscale or WireGuard. Never expose the bridge to the internet:
  whoever reaches it controls that browser. Give the Wingman a Chrome profile of its own on the
  bridge (the bridge's multi-agent setup), apart from the profiles your other agents use.
- The home computer has to be on at session time.

## Install

On the server, as the account your mission control belongs to:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash -s -- --browser bridge --bridge http://<home computer>:3007
```

`3007` is the bridge's default port; use the port of the profile you gave the Wingman. Leave the
two options out and the setup questions ask for the address instead.

The setup asks its questions in the terminal (the server has no screen). Telegram is offered when
it finds a bot in Hermes. Run them again any time with `godspeed-wingman setup --wizard`. When you
finish, the Wingman sends you a welcome on Telegram; answer "practice" there to start the first
round.

### As root, or as the account

- **As the account** that owns the mission control: the worker is a systemd user service
  (`systemctl --user status godspeed-wingman`). A user service stops when the account logs out
  unless lingering is on: `loginctl enable-linger <account>` (as root, once).
- **As root:** the worker is a system service (`systemctl status godspeed-wingman`) that runs as
  the account that owns the mission control folder, never as root when it does not have to. The
  program goes to `/usr/local/lib/godspeed-wingman`, the command to `/usr/local/bin`, the private
  folder to `/var/lib/godspeed/wingman` (only that account and its group can read it). Use a Node
  that account can reach, not one inside `/root`.

## Telegram

The setup reads the Telegram bot from Hermes' own `.env` file: `TELEGRAM_BOT_TOKEN`, and the chat
from `TELEGRAM_HOME_CHANNEL` (or the one user in `TELEGRAM_ALLOWED_USERS`). It never copies the
token anywhere. Which Hermes it uses:

```
--hermes-profile <name>    a named Hermes profile (hermes -p <name>)
--hermes-home <folder>     a Hermes home in another place
--telegram-env <file>      the .env file itself; it has to sit in a Hermes home
```

Pictures of profiles arrive as photos. Messages start with "From your Wingman:", so you always see
who is talking.

## The bridge

In `routines/wingman/settings.json`:

```json
{ "browser": "bridge", "bridge": "http://<home computer>:3007" }
```

If the bridge wants a token (`BRIDGE_TOKEN` on the bridge), put the same token in the worker's
private settings, `worker.env` in the private folder, never in `settings.json`:

```
GODSPEED_WINGMAN_BRIDGE_TOKEN=<the same secret>
```

Log into the dating site once in the bridge's Chrome window on the home computer. Then
`godspeed-wingman check` on the server says whether the bridge answers, which version it runs,
and whether the login is there.

**The bridge must be 0.6.0 or newer.** When a browser tab crashes, an older bridge keeps handing
out that dead tab: every page fails while the bridge's health check still says ok, and the
Wingman cannot like or pass anyone until the bridge is restarted. 0.6.0 opens a fresh tab
instead. `godspeed-wingman check` reads the bridge's version and fails below 0.6.0.

**After you update the bridge, restart every bridge instance on that computer,** not only the one
the Wingman uses. Each instance runs the code it started with, so one you did not restart still
runs the old version. The logins stay, because they live in the Chrome profile.

## The desk on a server

The worker serves the desk on the server too, on 127.0.0.1 only. To use it from your computer,
forward the port over SSH and open the address with its key:

```bash
ssh -L 47860:127.0.0.1:47860 <account>@<server>
godspeed-wingman desk --no-open        # on the server: prints the address with its key
```

Open that address in your browser. Keep the local port the same (47860): the desk answers only to
its own address.

## Where things are on the server

| What | As the account | As root |
|---|---|---|
| The command | `~/.godspeed/bin/godspeed-wingman` | `/usr/local/bin/godspeed-wingman` |
| The program | `~/.godspeed/addons/godspeed-wingman` | `/usr/local/lib/godspeed-wingman` |
| The private folder | `~/.godspeed/wingman` | `/var/lib/godspeed/wingman` |
| The service | `~/.config/systemd/user/godspeed-wingman.service` | `/etc/systemd/system/godspeed-wingman.service` |

What the private folder holds, and for how long: [privacy.md](privacy.md).
