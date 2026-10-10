# The Wingman on __NAME__

This folder teaches the Wingman one dating site: __NAME__ (__HOME__). It was made by
`godspeed-wingman site new __ID__` from the Wingman's browser template, and it belongs to you:
it lives in your mission control and is saved in its history like your other files.

## The files

- `site.json` says what the site is, whether its terms allow a helper like the Wingman, and what
  the adapter can do (`can`).
- `adapter.mjs` does the work: it reads who the site suggests, reads one profile, likes or passes,
  reads matches and messages, and sends a message you chose.
- `adapter.test.mjs` tests the adapter with invented people. Run it with
  `node --test "routines/wingman/sites/__ID__/*.test.mjs"` from your mission control folder
  (`site check` runs them too).
- `.gitignore` keeps anything real out of git. Put notes or recordings of the real site only in
  `private/`, and delete them when you are done.

## The order of work

1. **The terms first.** Read the site's terms of service, community guidelines and any developer
   or API policy. Record what they say:

   ```
   godspeed-wingman site terms __ID__ --verdict silent --url https://... --quote "..." --note "..."
   ```

   `allowed` when they explicitly permit automated or AI help, `silent` when nothing in them is
   against it, `forbidden` when they forbid bots, scripts, automated access or third-party tools.
   **Forbidden is your decision:** the site may suspend or close your account if it notices a
   helper. Go on only if you want that; the Wingman then switches the site on only with
   `godspeed-wingman site use __ID__ --accept-terms-risk`, which records your choice with the date.
2. **Find the site's own requests.** Log in once: `godspeed-wingman site login __ID__` opens the
   Wingman's own browser on the site's login page. Then:

   ```
   godspeed-wingman site network __ID__ --url https://.../the-suggestions-page
   ```

   lists the addresses that page called. Do it for a profile page and the messages page too. The
   browser's developer tools (F12, Network, "Fetch/XHR") show the same, with the answers.
3. **Change `adapter.mjs`:** the addresses in `ROUTES`, the field names in `toProfile()`. If the
   site has no requests you can call, use the fallback `pageProfile()` and the selectors in `PAGE`.
4. **Change the test** to the real shape of the answers, with invented names and ids, and run it.
5. **Check it on the live site, read only:**

   ```
   godspeed-wingman site check __ID__
   ```

   It logs in with your session, reads the queue, one profile and one picture, and cannot like,
   pass, skip or send: those are blocked while it runs.
6. **Switch it on:** `godspeed-wingman site use __ID__` (with `--accept-terms-risk` when its terms
   forbid automated use and you chose to go ahead). It starts in practice: every decision waits for
   your answer until you agree with 9 of its last 10.

## Rules

- Never like, pass or write to a real person while building. `site check` and the tests are enough.
- `like`, `pass`, `skip` and `send` run once and never retry.
- Reading methods never click anything that changes something.
- Only what a person could do by hand, at a person's pace, with your own login.
