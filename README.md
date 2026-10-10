# The Wingman

**An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel). Every evening it
opens the profiles a dating site suggests, reads each one the way a friend who knows you would, and
likes or passes at a person's pace.** You teach it in practice rounds; it stops for names you watch;
matches and messages reach you with three reply ideas, and "send 2" sends one. Flirtual is the first
site it knows; more can be added.

> From your Wingman: practice (you agreed with 7 of my last 8). Mara, 27 (DE): I would LIKE them,
> high sure. VRChat with full-body tracking, and their bio says they love horror worlds.
> Agree? Say "agree", or "disagree" and why.

> disagree, they only want friends

> Noted: you passed on Mara because they only want friends. Next one in a moment.

Version 0.5.0. The setup, the desk page and the documentation are still being written.

## Add it

```
node bin/godspeed-wingman.mjs setup
```

Then run `godspeed-wingman check`: it opens the Wingman's own browser, where you log into your
dating site once.

## Use

```
godspeed-wingman status          godspeed-wingman who "robin" --photo
godspeed-wingman train 10        godspeed-wingman review 5
godspeed-wingman answer agree    godspeed-wingman answer disagree --reason "..."
godspeed-wingman send 2 --to R4  godspeed-wingman send --to R4 --text "..."
godspeed-wingman prefs add "no smokers"      godspeed-wingman watch add "Robin"
godspeed-wingman pause | resume | run | inbox | stop | check | help
```

## Honest limits

- It works only on sites whose terms do not forbid helpers like it; each site records what its
  terms say, and the Wingman refuses a site whose terms forbid bots, automation or AI.
- It keeps a person's pace and never sends a message you did not choose.
- A lost login stops that site and tells you once a day; only you can log in again.
- Everything it keeps about other people stays in a private folder on your computer (never in git)
  and is deleted after 42 days unless you choose otherwise.

MIT License.
