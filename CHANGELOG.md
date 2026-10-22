# Changelog

## 0.6.3 (2026-10-22)

On Linux, the Wingman's background service starts again. The service file that setup writes put
the Wingman's folder in quotes on its `WorkingDirectory=` line. systemd does not accept quotes
there: it calls the path "not absolute", marks the whole service as broken and never starts it.
The line now holds the plain path, and a folder name with spaces works as it is.

If you installed the Wingman on Linux before, update it as usual by running the install line
again: that writes the corrected file and starts the service. Your settings stay as they are.
Windows and macOS were not affected.

## 0.6.2 (2026-10-22)

The notebook list of likes and passes has a new column, Reason: why each profile was liked or
passed, in one short sentence.

- **What it says:** when the Wingman decided, the reason it gave, the same kind you see in
  practice. When you decided and said why, your own words. When you agreed with the Wingman
  without saying why, the Wingman's reason. Otherwise it stays empty.
- **Your list keeps everything else:** a list made by an older Wingman gets the column added right
  after "Decided by". Your comment, the columns you added, their names and their order stay as they
  are, and a column you deleted does not come back. If you already made a column called Reason
  yourself, it stays yours: the Wingman never writes in it.
- **Likes and passes from before:** they get a reason too, as long as the Wingman still keeps its
  record of them (six weeks unless you chose otherwise).

## 0.6.1 (2026-10-21)

The shared AI connection is also found on Docker server installations through Godspeed's local
model proxy. It needs the server installer's exact marker and keeps existing native workspaces
as the first choice. The personal notebook workspace stays inside Godspeed.

Model output now preserves Unicode characters split across process output chunks and stops
if a model command returns more than 1 MiB.

## 0.6.0 (2026-10-21)

New installs use Godspeed's existing AI connection, with no separate model subscription or login.
Godspeed keeps its credentials and applies its chosen provider, model and usage rules to each
isolated request. Existing explicit separate connections are preserved.

AI failures now pause immediately and send one warning, retrying failed delivery while paused.
A failed read, invalid judgment or refused skip can no longer turn into an unwanted pass.
Status names the last host provider and model, and check reports unresolved AI failures.

## 0.5.4 (2026-10-16)

A session that errors stop no longer ends in silence, and `check` no longer calls a broken
browser a lost login.

- **What happened:** a Wingman whose browser came through the Chrome Agent Bridge lost a whole
  day. The bridge's browser tab had crashed, and bridges before 0.6.0 keep handing out a crashed
  tab: every page answered "Page crashed" while the bridge's own health check said ok. The daily
  session ended on "five errors in a row" with nothing liked or passed, nobody was told, and the
  check would have said "log in once", which was not the problem.
- **One more try, then a message:** the first time on a day that five errors in a row end a
  session, the Wingman starts one fresh session about an hour later, inside the time the first one
  had left, and not while it is paused or a question waits. A crashed tab or a short outage of the
  site is often gone by then. When that one stops too, or the day has no time left for it, you
  are told once that day: that today's session stopped, why in a few plain words, when the last
  like or pass was, and to ask your assistant to check the Wingman. A lost login keeps its own
  message, as before.
- **Status and your assistant see it:** `godspeed-wingman status`, the block your assistant reads
  before each message, and the desk say in one short line that a session stopped and whether the
  Wingman tries again, without anyone's name.
- **`check` names the real failure:** only the site's own "logged out" gives the hint to log in.
  Any other error (a crashed tab, the bridge answering with an error, a timeout, the site's own
  server error) fails as what it is, "not a login problem", with the first line of the error.
- **Bridge users:** the Wingman needs the Chrome Agent Bridge 0.6.0 or newer. `check` reads the
  bridge's version and fails when it is older or does not say. After you update the bridge,
  restart every bridge instance on that computer: each one runs the code it started with.
  docs/server.md says how.

## 0.5.3 (2026-10-11)

You decide about a site whose terms forbid bots. The Wingman tells you what they say and no
longer decides for you.

- **What changed:** a site whose terms forbid bots, automation or AI use was refused for good. The
  recipe for adding a site stopped and built nothing, `site use` said the site "cannot be switched
  on", and a new reading of the terms switched a site off. That overruled you. Now the terms are
  information: your mission control reads them, quotes what they say about bots and AI, tells you
  the risk once (the site may suspend or close your account, and some sites notice automated use),
  and asks once whether to build it anyway. On yes it builds the adapter like any other, with the
  same rules: it never touches a real person while building, the check reads only, and the site
  starts in practice. On no, it stops.
- **Your choice is recorded:** such a site is switched on only with
  `godspeed-wingman site use <id> --accept-terms-risk`, which writes the date into your
  `settings.json` (`terms_risk_accepted`). Without it, `site use` says in two sentences what the
  terms say and the command to go ahead. `site list`, `status` and `check` show the site as "terms
  forbid automated use; on by your choice (2026-10-11)". `site off` takes the choice back.
- **When terms change:** if a new reading finds that a site you use now forbids automated use, the
  Wingman pauses there and tells you once, with the command to keep it on or switch it off. It never
  switches the site off behind your back. The 180-day reminder to read terms again stays a reminder.
- **Unclear terms** are no longer counted as forbidden: the sentence is quoted, and you decide.
- **What ships stays the same:** the Wingman comes only with Flirtual, and this repository accepts
  adapters only for sites whose terms do not forbid automated or AI use. That is the author's choice
  about what to hand out, not a limit on you; README, CONTRIBUTING and docs/adding-a-site.md now say
  so.

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
