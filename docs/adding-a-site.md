# Adding a dating site to the Wingman

Flirtual is the first site the Wingman knows, not the only one. Another site, or an app, can be
added by your mission control's coding helper, but only where the service's own terms allow a
helper like the Wingman.

## In short

Tell your mission control: **"Add <the site's name> to my Wingman."**

Its coding helper follows the recipe that ships with the Wingman (`skills/wingman-add-site` in your
mission control):

1. It reads the site's terms first and quotes what they say about bots, automation and AI.
   If they forbid it, it stops and tells you, and nothing is built.
2. It builds a small adapter for the site in your own mission control folder, from a template.
3. It checks the adapter on the live site, reading only: it cannot like, pass, skip or send.
4. It switches the site on. The new site starts in practice, so the Wingman asks you about every
   profile there until it knows your taste on that site too.

You do two things yourself, because they need your accounts: log into the site once in the
Wingman's browser, and answer the first practice round.

## The terms rule, and why

Every site has a verdict in its `site.json`, from its terms of service, community guidelines and
any developer or API policy:

- **allowed**: the terms explicitly permit automated or AI help.
- **silent**: nothing in them speaks to it.
- **forbidden**: they prohibit bots, scripts, automated access or third-party tools using the
  service. One such sentence is enough.

The Wingman refuses to load a site whose verdict is forbidden, or whose terms were never checked,
and it says why in plain words. The recipe tells the coding helper to stop at a forbidden verdict
and never to suggest a way around it. Many large dating apps forbid automated use. The Wingman does
not ship them and will not build them for you.

Why so strict: the account is yours, and the rules are the site's. A site that forbids bots can
close your account, and a helper you have to hide is not a helper. The Wingman should be something
you could tell the site about.

Terms change. When a verdict is more than 180 days old, `site list` and `site check` remind you to
read them again. A new verdict of forbidden switches the site off at once.

### Why Flirtual qualifies

Flirtual's terms of service (last updated 4 December 2025, read on 10 October 2026) say nothing
about bots, automation, scripts, scraping or AI. Its guidelines say: "Misusing Flirtual or attempts
to maliciously exploit Flirtual will be investigated." The Wingman neither misuses nor exploits
Flirtual: it uses one account, your own login, a person's pace, and it never sends a message you
did not choose. So Flirtual's verdict is silent, and the Wingman works there. If Flirtual's terms
change, so does the verdict.

## What an adapter is

A folder with two files.

**`site.json`** says what the site is: its id and name, whether it is a website or an Android app,
where it lives, what its terms say (the verdict, the date, the addresses read, the sentences
quoted), and what the adapter can do (`can`: read the queue, like, pass, skip, read messages, send,
take a picture).

**`adapter.mjs`** holds a few functions the Wingman calls:

- `session()`: who is logged in.
- `queue()`: the people the site suggests today.
- `profile(id)`: one person's profile, in the Wingman's shape (name, age, bio, details, pictures).
- `open(profile)` and `picture()`: the profile on screen, and a picture of it to keep.
- `like(id)`, `pass(id)`, `skip(id)`: one each, exactly once, never retried.
- `conversations()`: matches and messages, so the Wingman knows who wrote last.
- `send(conversation, text)`: one message you chose, exactly once.

The rules every adapter keeps: reading never changes anything; a change happens once; the Wingman
sets the pace, so the adapter never hurries or loops; a lost login is reported as one, so the
Wingman can ask you to log in again; and no text from a profile is ever run as code. The full
contract, for coding helpers, is in [lib/sites/contract.md](../lib/sites/contract.md).

There are two ways to read a website. The preferred one calls the site's own web-app requests
from inside the logged-in page, the way the Flirtual adapter does: the browser sends your login by
itself, the adapter never sees a password, and the site sees the same requests its own page makes.
The fallback reads the page itself, the way a person sees it. The template shows both.

## The commands

```
godspeed-wingman site list                       every site, its terms, on or off, practice or autopilot
godspeed-wingman site new <id> --kind browser --name "<Name>" --home https://...
godspeed-wingman site new <id> --kind android --name "<Name>" --package com.example.app
godspeed-wingman site terms <id> --verdict allowed|silent|forbidden --url https://... --quote "..." --note "..."
godspeed-wingman site login <id>                 the Wingman's browser on the site's login page
godspeed-wingman site network <id> --url <page>  the addresses a page called (reading only)
godspeed-wingman site check <id> [--offline]     is it ready? (reading only)
godspeed-wingman site use <id>                   switch it on
godspeed-wingman site off <id>                   switch it off
```

`--url` and `--quote` can be given more than once: once per page of terms, once per sentence.

## A walk-through

Kind Meet is an invented site; every name below is made up.

1. **Make the folder.**

   ```
   godspeed-wingman site new kindmeet --kind browser --name "Kind Meet" --home https://kindmeet.example
   ```

   This copies the template into `routines/wingman/sites/kindmeet/` in your mission control:
   `site.json`, `adapter.mjs`, `adapter.test.mjs`, a `README.md` and a `.gitignore`. The site has
   no terms yet, so it cannot be switched on.

2. **Read the terms and record them.**

   ```
   godspeed-wingman site terms kindmeet --verdict silent --url https://kindmeet.example/terms --url https://kindmeet.example/guidelines --quote "Misuse of the service will be investigated." --note "Nothing about bots, automation or AI."
   ```

3. **Log in once:** `godspeed-wingman site login kindmeet` opens the Wingman's own browser on the
   login page. Log in there. The login stays in that browser, apart from your everyday one.

4. **Find the site's requests.**

   ```
   godspeed-wingman site network kindmeet --url https://kindmeet.example/discover
   ```

   lists the addresses the page called, for example `/api/suggestions`. Do the same for a profile
   and the messages. The addresses can hold the ids of real people: use them to learn the routes,
   never copy them into a test.

5. **Change the adapter:** the addresses in `ROUTES`, the field names in `toProfile()`. Change the
   tests to the real shape of the answers, with invented people, and run them:

   ```
   node --test "routines/wingman/sites/kindmeet/*.test.mjs"
   ```

6. **Check it.** `godspeed-wingman site check kindmeet` prints something like:

   ```
   Kind Meet (your own, .../routines/wingman/sites/kindmeet), a website
     ok   site.json is complete
     ok   terms: silent, read on 2026-10-10 (https://kindmeet.example/terms, ...)
     ok   the adapter has every method it promises: session, queue, profile, like, pass, ...
     ok   tests: 11 of 11 passed
     ok   logged in as you
     ok   queue: 12 profile(s) waiting, 25 likes left
     ok   profile u_8f3a: a name, an age, 6 field(s), 2 question(s), a bio of 214 characters, 4 picture address(es)
     ok   picture: 412 KB (element), kept to look at in .../check/kindmeet-picture.png
     ok   conversations: 3 (only counted)
   All checks passed. Switch it on with: godspeed-wingman site use kindmeet
   ```

   It prints what it found, never what anyone wrote.

7. **Switch it on:** `godspeed-wingman site use kindmeet`. It starts in practice, whatever your
   other sites do: every like or pass there waits for your answer until you agree with 9 of its
   last 10. Say "practice" for the first round.

8. **Save it.** The adapter is your code: it is committed in your mission control's history like
   your other files. The Wingman's private folder never is.

## For coding helpers

- Follow `skills/wingman-add-site/SKILL.md`. It starts with the terms.
- Build in `<mission control>/routines/wingman/sites/<id>/`, never in the Wingman's program
  folder, which every update replaces.
- Never like, pass, skip or message a real person while building. Use `site check` and the
  folder's tests.
- Tests use invented people only. Anything real (a recording, a screen dump, notes) goes only in
  `private/` in the folder, which git ignores, and is deleted when you are done.
- No npm packages. The adapter imports nothing from the Wingman; a lost login is any `Error` with
  `loggedOut = true`.

### What `site check` guards against, and what it cannot

During a live check the Wingman holds only a copy of the adapter whose `like`, `pass`, `skip` and
`send` throw. Every script the adapter runs in the page runs behind a guard that refuses any
request other than a read (GET), every form, beacon and WebSocket message; a site that reads
through POST (a GraphQL search, for example) lists those addresses in `post_reads`, and a GraphQL
mutation is refused even there. In an app, the guard refuses taps on anything labelled like, pass,
send and the like, typing, and sideways swipes. What no guard can know is what a click on a web
page, or a tap on an unlabelled button, does. So the reading functions never click or tap anything
that changes something.

### Your own adapters and the worker's account

Your adapter is code the worker runs with the worker's rights. On Linux and macOS, the worker
refuses to load it when another account can change its files (or a folder above them), for
example when the worker runs as root and the folder belongs to you. The fix is to run the worker as
the account that owns your mission control folder, which is how the Wingman's setup installs it.

## When a site changes

Sites change their pages and requests. When something breaks, `godspeed-wingman check` and
`site check <id>` say what, and the coding helper repairs the adapter with the same steps.
