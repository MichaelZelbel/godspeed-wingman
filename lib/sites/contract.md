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
  through an Android emulator, experimental).
- `home`, `login_url`: https addresses. A browser site needs `home`; for an Android site it is
  optional (the service's website, where its terms are). `profile_url` (optional): a profile's
  address with `{id}` where the profile id goes; the notebook collection uses it when a kept address
  looks wrong.
- `android.package` (Android sites only): the app's package name, the id in its Play Store address
  (`com.example.app`).
- `post_reads` (optional): https addresses the site reads through POST requests (a GraphQL search,
  for example). `site check` is read only and refuses every POST except to these addresses (the
  address itself or below it), and never a GraphQL mutation.
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
object. `create()` only prepares: it never reaches for the site (the offline check gives it a
driver that throws). `driver` is the Wingman's browser (the local Chrome or Edge, or a Chrome Agent
Bridge, both with the same methods: `health()`, `goto(url)`, `evaluate(js, { attempts })`,
`capture({ selector, full, pad, format, quality })`, `screenshot()`, `content()`), or for an
Android site the Android driver (below). `settings` holds the site's options and `kind`.
`log(line)` writes to the worker's log. `wait(ms)` is the worker's pause (the tests make it
instant).

### The Android driver (lib/drivers/android.mjs)

An Android emulator through adb. The screen is a list of nodes `{ index, parent, depth, text, desc,
id, class, package, bounds: [x1, y1, x2, y2], clickable, scrollable, enabled, checked, selected,
focused, password }`; `id` is the full resource id (`com.example.app:id/card_name`), and a query
may name only the part after `:id/`.

| method | what it does |
|---|---|
| `health()` | the device is there and Android has finished starting |
| `screencap()`, `screenshot()` | the screen as a PNG; `capture()` gives `{ data, capture: "viewport" }` |
| `dump()` | the nodes on the screen now |
| `find(query, nodes)`, `findAll(query, nodes)` | query: `{ text, textContains, textMatches, id, desc, descContains, class, clickable, scrollable }` |
| `waitFor(query, { timeoutMs })` | reads the screen again until a node matches |
| `nodeAt(nodes, x, y)` | the node a tap at x,y lands on |
| `tap(x, y)`, `tapNode(node)`, `tapText(text)`, `tapId(id)`, `tapDesc(desc)` | a tap in the middle of the node |
| `swipe(x1, y1, x2, y2, ms)`, `scroll("down" \| "up")` | a swipe; a scroll of half a screen |
| `type(text)` | types plain printable characters; anything else (an emoji, an accent, a line break) is refused, never sent garbled |
| `key(code)`, `back()` | a key event; Back |
| `launch(package)`, `current()`, `installed(package)` | start the app, the app and activity in front, whether an app is installed |

Which device: the settings' `android_device`, else the only emulator running. A phone on USB is
used only when the settings name it.

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
- `photos`: https addresses of their pictures. `url`: their profile page (`""` in an app, which
  has none; the Wingman's messages then leave the "Their profile" line out).
- `contact.discord`: the site's own Discord field, when it shows one.
- `raw`: what the site sent, kept as `raw.json` in the archive.

An adapter may add its own keys (Flirtual adds `photoKeys`); the core keeps them and ignores them.

### Errors

Throw `SiteError` (from `lib/sites/errors.mjs`) with `loggedOut: true` for a lost login, or any
`Error` with `loggedOut = true` (the person's own adapters live outside the Wingman's folder and
need not import anything from it). The core turns it into one "log in again" message a day and
stops that site until the person logs in. Any other error is retried later; one profile that fails
twice is skipped (`skip`, else `pass`).

## The person's own sites

`godspeed-wingman site new <id>` copies `lib/sites/_template/<kind>/` into
`<mission control>/routines/wingman/sites/<id>/`, without terms, so the site cannot be switched on
before `site terms` records what its terms say. `site check <id>` checks it: offline, site.json,
the terms, the methods against `can`, and the folder's own `*.test.mjs`; then, live, the login,
the queue, one profile, one picture and the conversations, holding only a copy of the adapter
whose `like`, `pass`, `skip` and `send` throw, in a page (or emulator) that refuses changes
(`lib/sites/guard.mjs`). `site use` and `site off` change `sites` in the settings.

Such an adapter is code the worker runs. On Linux and macOS the loader refuses it when any of its
files, or any folder above them, can be changed by another account than the worker's own (or
root): the worker must run as the account that owns the mission control folder
(`lib/sites/trust.mjs`).

## Rules every adapter keeps

- A person's pace: the core waits between profiles; the adapter never loops or hurries.
- Reading is free, changing is once: `like`, `pass`, `skip` and `send` never retry by themselves.
- The reading methods (`session`, `queue`, `profile`, `open`, `picture`, `conversations`) never
  change anything: `site check` runs them on the live site.
- Only what a person could do by hand in the same app, with the person's own login.
- No text from a profile is ever run, followed or sent anywhere except to the model, fenced as data.
