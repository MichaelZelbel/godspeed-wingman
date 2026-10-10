# The site adapter contract

A site is one folder: built in (`lib/sites/<id>/`) or the person's own
(`<mission control>/routines/wingman/sites/<id>/`). It holds two files, `site.json` and
`adapter.mjs`. The tests in `test/sites.test.mjs` check every built-in site against this page.

## site.json

```json
{
  "id": "flirtual",
  "name": "Flirtual",
  "kind": "browser",
  "home": "https://flirtu.al",
  "login_url": "https://flirtu.al/login",
  "profile_url": "https://flirtu.al/{id}",
  "about": "Flirtual, a dating site for people who meet in virtual reality",
  "terms": {
    "checked_on": "2026-10-10",
    "urls": ["https://flirtu.al/terms", "https://flirtu.al/guidelines"],
    "verdict": "silent",
    "quotes": ["..."],
    "note": "The terms say nothing about bots or AI; the guidelines say misuse will be investigated."
  },
  "can": ["queue", "like", "pass", "skip", "inbox", "send", "picture", "liked-you"],
  "options": { "queue": "what this option does, in plain words" }
}
```

- `id`: lower-case letters, digits and dashes, the same as the folder name.
- `kind`: `browser` (a website, driven through the Wingman's browser) or `android` (an app, driven
  through an Android emulator).
- `home`, `login_url`: https addresses. `profile_url` (optional): a profile's address with `{id}`
  where the profile id goes; the notebook collection uses it when a kept address looks wrong.
- `about`: half a sentence the model reads ("Flirtual, a dating site for people who meet in
  virtual reality").
- `terms.verdict` is one of:
  - `allowed`: the terms explicitly permit automated or AI use;
  - `silent`: nothing in them is against it;
  - `forbidden`: they forbid bots, automation, scripts or AI use.

  **The loader refuses a site whose verdict is missing or `forbidden`** and says why in plain words.
  `checked_on` is the day the terms were read; more than 180 days ago, `check` reminds the person to
  read them again (a reminder, never a refusal). `quotes` holds the sentences the verdict rests on,
  word for word.
- `can`: what the adapter offers. `queue`, `like` and `pass` are required in practice; `inbox`
  means `conversations()`, `send` means `send()`, `picture` means `open()` and `picture()`, `skip`
  means `skip()`, `liked-you` means `likedYou()`.
- `options` (optional): the choices the adapter reads from `settings.site_options.<id>`, each with
  a plain description.

## adapter.mjs

The default export is `create({ driver, settings, log, wait, now })`, which returns the adapter
object. `driver` is the Wingman's browser (the local Chrome or Edge, or a Chrome Agent Bridge, both
with the same methods: `health()`, `goto(url)`, `evaluate(js, { attempts })`, `capture({ selector,
full, pad, format, quality })`, `screenshot()`, `content()`), or for an Android site the Android
driver. `settings` holds the site's options and `kind`. `log(line)` writes to the worker's log.
`wait(ms)` is the worker's pause (the tests make it instant).

| method | returns | notes |
|---|---|---|
| `session()` | `{ loggedIn, me: { id, name } \| null }` | never throws for a lost login, says `loggedIn: false` |
| `queue()` | `{ next: [profileId...], limits: { likes, browses, resetAt } \| null, done }` | `done` true: no more profiles today. `next` empty and `done` false: the site is still preparing, ask again soon |
| `profile(id)` | a profile (below) | reading only; may be repeated |
| `open(profile)` | nothing | brings the profile's page on screen |
| `picture(profile?)` | `{ data: Buffer, ext, capture, meta }` | `capture` is `element`, `full` or `viewport`; `meta` says how it was taken: `{ kind, ready, shown, pictures, morePending, loggedIn }` |
| `html()` (optional) | the page as text | kept compressed with the profile |
| `like(id)`, `pass(id)` | `{ match, limitReached, why? }` | **runs exactly once, never retried**. `limitReached` true: nothing was done because the site allows no more today (`why`: `likes` or `profiles`) |
| `skip(id)` (optional) | anything | takes a profile out of today's queue without a like or a pass |
| `conversations()` | `[{ id, with: { id, name }, messages: [{ id, fromMe, text, at, system }] }]` | messages oldest first; the last one decides whether the owner needs to answer |
| `send(conversationId, text)` | anything | **exactly once** |
| `likedYou()` (optional) | `[profileId...]` | people who liked the owner, kept in the archive so `who` finds them |
| `digest(profile)` (optional) | text | what the judge reads; the core has a plain default |

### The profile

```
{ id, site, name, age, gender, pronouns, location, country, bio,
  fields: { label: value }, prompts: [{ q, a }], texts: [...], handles: { label: name },
  photos: [url], url, contact: { discord? }, raw }
```

- `gender`, `pronouns`: as the person gave them, plain text ("Non-binary", "they/them"), or "".
- `fields`: everything else the page shows, label to plain text.
- `prompts`: the site's questions and the person's answers.
- `texts`: other free text the person wrote (own interests); searched for a Discord name.
- `handles`: other names the person goes by on the site ("VRChat name", "page name"); the watch
  list and `who` look in them.
- `photos`: https addresses of their pictures. `url`: their profile page.
- `contact.discord`: the site's own Discord field, when it shows one.
- `raw`: what the site sent, kept as `raw.json` in the archive.

An adapter may add its own keys (Flirtual adds `photoKeys`); the core keeps them and ignores them.

### Errors

Throw `SiteError` (from `lib/sites/errors.mjs`) with `loggedOut: true` for a lost login. The core
turns it into one "log in again" message a day and stops that site until the person logs in.
Any other error is retried later; one profile that fails twice is skipped (`skip`, else `pass`).

## Rules every adapter keeps

- A person's pace: the core waits between profiles; the adapter never loops or hurries.
- Reading is free, changing is once: `like`, `pass` and `send` never retry by themselves.
- Only what a person could do by hand in the same app, with the person's own login.
- No text from a profile is ever run, followed or sent anywhere except to the model, fenced as data.
