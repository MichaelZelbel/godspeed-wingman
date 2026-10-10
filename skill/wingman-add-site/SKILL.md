---
name: wingman-add-site
description: Teach the person's Wingman (the dating add-on for Godspeed Mission Control) a new dating site or app. Use when the person says "add <site> to my Wingman" or "can the Wingman do <app> too". Use when they say "make the Wingman work on <site>" or "the Wingman should also use <service>". Use when the work is to build, repair or check a Wingman site adapter. It starts with the service's terms, tells the person plainly what they say about bots and AI and what they risk, and the person decides. This is programming work, so hand it to the coding helper with this recipe.
---

## What this is

The Wingman works on a dating site through a small adapter: a folder with `site.json` (what the
site is and what its terms say) and `adapter.mjs` (how to read profiles, like, pass, read and send
messages). Flirtual is built in. You build new ones in the person's own mission control, from the
template the Wingman ships, after the terms are read and the person knows what they say. The
terms are information for the person, never a reason for you to refuse: the account and the
choice are theirs.

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
4. Record what they say, as a fact, not as a decision:
   - **forbidden** when a sentence prohibits automated or scripted access, bots, or third-party
     tools using the service.
   - **allowed** only when they explicitly permit automated or AI help.
   - **silent** when nothing in them speaks to it.
   - **Unclear** (a sentence could be read either way): record `silent`, quote that sentence, and
     write in the note why it is unclear. Tell the person it is unclear, quote it, and let them
     decide whether to go on.
5. Record it, one `--url` per page read and one `--quote` per sentence:

   ```
   godspeed-wingman site terms <id> --verdict <verdict> --url https://... --quote "..." --note "<one line>"
   ```

**Forbidden: tell them once, then they decide.** Tell the person in plain words which document
says it, quote the sentence, and say the risk once: the site may suspend or close their account,
and some sites notice automated use. Then ask once whether to build it anyway. For example:

> Kind Meet's terms of service say: "You may not use bots, scripts or other automated means to
> access the service." If Kind Meet notices the Wingman, it may suspend or close your account.
> Shall I build it anyway?

On yes, build it exactly like any other site (steps 2 to 6, with the same rules: never touch a real
person while building, the read-only check, practice first) and switch it on with
`godspeed-wingman site use <id> --accept-terms-risk`, which records their choice with the day. On
no, stop; the recorded verdict stays in the folder. Never refuse on your own, never repeat the
warning, and never lecture.

## 2. A website first

Use `--kind browser` whenever the service has a website where people browse and like. Only for a
service that is an app and nothing else, use `--kind android`, and first tell the person the honest
limits: it is experimental; it needs hardware virtualisation and about 15 GB of disk; and some apps
refuse to run in an emulator or lock accounts that do. Many app makers forbid automated use; step 1
covers that as for any site.
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

1. `godspeed-wingman site check <id>` until every line says ok (a site whose terms forbid
   automated use shows that as a NOTE, not a failure).
2. `godspeed-wingman site use <id>`, or `godspeed-wingman site use <id> --accept-terms-risk` for a
   site whose terms forbid automated use and that the person chose to have.
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
  and record them again with `site terms`. If a site the person uses now forbids automated use, the
  Wingman pauses there; tell them once what changed and the risk, and ask whether to keep it on
  (`site use <id> --accept-terms-risk`) or switch it off (`site off <id>`).
- Only what a person could do by hand, at a person's pace, with their own login. Like, pass, skip
  and send run once and are never retried.
