---
name: wingman-add-site
description: Teach the person's Wingman (the dating add-on for Godspeed Mission Control) a new dating site or app, only where the service's terms allow it. Use when the person says "add <site> to my Wingman", "can the Wingman do <app> too", "make the Wingman work on <site>", "the Wingman should also use <service>", or when the work is to build, repair or check a Wingman site adapter. It starts with the service's terms and stops for good when they forbid bots or automated use. This is programming work: hand it to the coding helper with this recipe.
---

## What this is

The Wingman works on a dating site through a small adapter: a folder with `site.json` (what the
site is and what its terms say) and `adapter.mjs` (how to read profiles, like, pass, read and send
messages). Flirtual is built in. You build new ones in the person's own mission control, from the
template the Wingman ships, and only after the terms are read.

Talk to the person in plain words. Say "the Wingman", "the site", "the terms". Do the work
yourself; ask them only for what needs their own accounts (logging in, accepting a licence).

## 1. The terms first, every time

1. Make the site's folder, so the check can be recorded (nothing is built yet):

   ```
   godspeed-wingman site new <id> --kind browser --name "<Name>" --home https://<site>
   ```

   For a service with no website, `--kind android --package <com.example.app>` (the id in its Play
   Store address).
2. Read the service's current terms of service, community guidelines, acceptable use policy and
   any developer or API policy, on its own website (the footer links to them). For an app, also
   the terms the app shows in the Play Store.
3. Search them for: bot, automated, automation, script, scrape, crawler, robot, spider, AI,
   artificial intelligence, machine learning, third-party software or tools, manual, on behalf.
   Copy every sentence that speaks to it, word for word.
4. Decide:
   - **forbidden** when any sentence prohibits automated or scripted access, bots, or third-party
     tools using the service. One sentence is enough. Unsure between silent and forbidden: forbidden.
   - **allowed** only when they explicitly permit automated or AI help.
   - **silent** when nothing in them speaks to it.
5. Record it, one `--url` per page read and one `--quote` per sentence:

   ```
   godspeed-wingman site terms <id> --verdict <verdict> --url https://... --quote "..." --note "<one line>"
   ```

**Forbidden means stop.** Tell the person in plain words which document says it, quote the
sentence, and say that the Wingman will not be built for this service. Do not suggest a workaround:
no other tool, no other account, no "read only" version, no unofficial app. The recorded verdict
stays in the folder, so nobody builds it later by mistake.

## 2. A website first

Use `--kind browser` whenever the service has a website where people browse and like. Only for a
service that is an app and nothing else, use `--kind android`, and first tell the person the honest
limits: it is experimental; it needs hardware virtualisation and about 15 GB of disk; some apps
refuse to run in an emulator or lock accounts that do; and app terms usually forbid automation.
Then run `godspeed-wingman android setup --dry-run`, tell them what it found in two sentences, and
run `godspeed-wingman android setup` only when they say go. The Android SDK licence is theirs to
accept: they answer its question, or tell you to add `--accept-licenses`. When it is done they
sign into the Play Store in the emulator, install the app and log in.

## 3. Build the adapter in their folder

- The folder is `<mission control>/routines/wingman/sites/<id>/`. Never build inside the Wingman's
  program folder: every update replaces it.
- Follow the folder's `README.md` and the comments in `adapter.mjs`. Change only what the comments
  mark as examples: `ROUTES` and `toProfile()` for a website, `IDS` for an app.
- Website, the preferred way: call the site's own web-app requests inside the logged-in page, as the
  template does. Have the person log in once: `godspeed-wingman site login <id>` opens the
  Wingman's own browser on the site's login page, and they log in there. Then find the requests with
  `godspeed-wingman site network <id> --url <page>` for the suggestions page, a profile and the
  messages, or in the site's open-source code. The fallback is reading the page (`pageProfile`).
- App: open each screen in the emulator and read it with `godspeed-wingman android dump`.
- No npm packages. The Wingman has none; the adapter needs none.

## 4. Never touch a real person while building

- Never like, pass, skip or message anyone: not from your code, not by hand in the Wingman's
  browser or emulator, not "just to test".
- Build against `godspeed-wingman site check <id>` (it reads the live site and cannot like, pass,
  skip or send) and against the folder's tests, from the mission control folder:
  `node --test "routines/wingman/sites/<id>/*.test.mjs"`.
- Tests use invented people only (Mara, Juno, Kiri; ids like `u_test_001`). Never copy a real
  profile, message, id or screen dump into a test, a commit or a message. Anything real goes only
  into `private/` in the folder (git ignores it) and is deleted when you are done.
- `site check --show` prints one real profile; use it only when the person asks.

## 5. Check, then switch it on

1. `godspeed-wingman site check <id>` until every line says ok.
2. `godspeed-wingman site use <id>`.
3. Tell the person: the new site starts in practice, even when another site already runs on its
   own; every like or pass there waits for their answer until they agree with 9 of its last 10;
   the first practice round is how it learns. They say "practice" (or you run
   `godspeed-wingman train --site <id>`).

## 6. Save it in their history

The adapter is their code: commit `routines/wingman/sites/<id>/` in their mission control's git
with a plain message ("wingman: the <Name> site"), and push the way their mission control does.
Never commit the Wingman's private folder (`~/.godspeed/wingman`), `private/`, pictures or
recordings.

## Later

- `site check` says what broke when the site changes; repair with the same steps.
- When `site list` or `site check` says the terms were read more than 180 days ago, read them again
  and record them again with `site terms`. A new verdict of forbidden switches the site off.
- Only what a person could do by hand, at a person's pace, with their own login. Like, pass, skip
  and send run once and are never retried.
