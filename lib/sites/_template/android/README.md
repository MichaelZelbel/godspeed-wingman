# The Wingman on __NAME__ (Android app, experimental)

This folder teaches the Wingman one dating app: __NAME__ (`__PACKAGE__`). It was made by
`godspeed-wingman site new __ID__ --kind android` from the Wingman's Android template, and it
belongs to you: it lives in your mission control and is saved in its history like your other files.

Use this only for a service that has no website. A website is simpler and steadier: use
`--kind browser` then.

## What it needs

- The Android emulator on this computer: `godspeed-wingman android setup` (a few gigabytes, and
  hardware virtualisation switched on). See the Wingman's docs/android.md.
- The app installed in the emulator from the Play Store, and you logged in once.
- The terms: many app makers forbid automated use of their apps. Read them first (below), so you
  know what they say before you decide.

## The files

- `site.json` says what the app is (`android.package`), whether its terms allow a helper like the
  Wingman, and what the adapter can do (`can`).
- `adapter.mjs` works the app through the Wingman's Android driver: it reads the card in front,
  opens a profile and scrolls through it, likes or passes, reads matches and messages, and sends a
  message you chose.
- `adapter.test.mjs` tests it against a pretend app with invented people. Run it with
  `node --test "routines/wingman/sites/__ID__/*.test.mjs"` from your mission control folder
  (`site check` runs them too).
- `.gitignore` keeps anything real out of git. Screen dumps of the real app go only in `private/`,
  and are deleted when you are done.

## The order of work

1. **The terms first.** Read the app's terms of service, community guidelines and any developer
   policy, then record what they say:

   ```
   godspeed-wingman site terms __ID__ --verdict silent --url https://... --quote "..." --note "..."
   ```

   **Forbidden is your decision:** the app may suspend or close your account if it notices a
   helper. Go on only if you want that; the Wingman then switches it on only with
   `godspeed-wingman site use __ID__ --accept-terms-risk`, which records your choice with the date.
2. **Look at the screens.** Open each screen in the emulator (the cards, an open profile, the
   messages, one conversation) and run `godspeed-wingman android dump` to see what is on it: text,
   description and resource id of every node.
3. **Change `adapter.mjs`:** the resource ids in `IDS`, and the steps where the app works
   differently.
4. **Change the test's pretend screens** to match, with invented people, and run it.
5. **Check it on the real app, read only:** `godspeed-wingman site check __ID__`. It reads the card
   in front and one profile and takes one picture. It refuses taps on anything marked like, pass or
   send, sideways swipes and typing.
6. **Switch it on:** `godspeed-wingman site use __ID__` (with `--accept-terms-risk` when its terms
   forbid automated use and you chose to go ahead). It starts in practice: every decision waits for
   your answer until you agree with 9 of its last 10.

## Honest limits

- Some apps refuse to run in an emulator, or notice it and lock the account. Stop when that happens.
- An app changes its screens with updates; the adapter then needs a repair, and `site check` says so.
- adb can type only plain letters, digits and punctuation; a reply idea with an emoji or an accent
  is refused instead of being sent garbled.
