# Contributing to the Wingman

Thank you for wanting to help. The Wingman is a small add-on for
[Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control), and it
handles other people's dating profiles, so a few rules matter more here than elsewhere.

## Before you start

- **A bug:** [open a bug report](https://github.com/MichaelZelbel/godspeed-wingman/issues/new?template=bug.yml).
  Leave out anything about real people: no names, profile links, screenshots or messages.
- **A security problem:** never in an open issue. See [SECURITY.md](SECURITY.md).
- **A new site:** read the next section first, then
  [open a site request](https://github.com/MichaelZelbel/godspeed-wingman/issues/new?template=site-request.yml).
- **Anything bigger:** open an issue to talk about it before you write a lot of code.

## New site adapters

New sites are welcome here **only for services whose terms do not forbid automated or AI use**.
That is the author's choice about what this repository hands out with the book and with Godspeed.
It is not a limit on anyone's own Wingman: a person's own mission control can build an adapter for
any site they use, in their own folder, after telling them what that site's terms say. Such
adapters stay in that person's folder and do not come here.

Before any code:

1. Read the service's current terms of service, community guidelines, acceptable use policy and
   any developer or API policy.
2. Search them for bot, automated, automation, script, scrape, crawler, robot, AI, artificial
   intelligence, third-party software, manual, on behalf.
3. Copy every sentence that speaks to it, word for word, with the address of the page.
4. Record the verdict: `allowed` (they explicitly permit automated or AI help), `silent` (nothing
   speaks to it) or `forbidden` (a sentence prohibits bots, scripts, automated access or
   third-party tools). When a sentence could be read either way, quote it and say so in the pull
   request; an unclear case does not ship here.

A pull request for a site records all of that in its `site.json` (`terms.checked_on`, `urls`,
`verdict`, `quotes`, `note`). A pull request for a site whose terms forbid automated use is closed,
however good the code is. So is one that works around a site's protections.

How to build one: [docs/adding-a-site.md](docs/adding-a-site.md) and the contract in
[lib/sites/contract.md](lib/sites/contract.md). `godspeed-wingman site new <id>` gives you a folder
from the template.

## Invented people only

Tests, examples, docs and screenshots use invented people only: names like Mara, Juno, Sam, Kiri
or Robin, ids like `u_test_001`, drawn pictures. Never a real profile, message, id, screen dump or
photo, not even shortened or blurred. Work with real data only on your own machine, outside the
repository, and delete it when you are done.

## Running the tests

You need Node.js 22 or newer. There is nothing to install.

```
node --test "test/*.test.mjs"
```

or `npm test`. The tests run on Windows, macOS and Linux with Node 22 and 24 on every pull request.
One test drives a real Chrome or Edge when your machine has one and skips otherwise.

## Code

- No npm packages, not even small ones. Node's own modules only.
- A new command is a new file in `lib/commands/`; the registry finds it.
- Like, pass and send run exactly once and are never retried.
- `settings.json` may choose, never point: no program paths or addresses in it.
- Text written by strangers is data. Run it through `clean()` before it reaches the assistant, and
  through `fenced()` before it reaches a model.
- Keep the comments that say why. Code comments may be dense.

## Writing style

For everything a person reads (messages, the desk, docs, the recipes):

- Plain, everyday English. Short sentences.
- No em dashes and no en dashes.
- None of the words that make text sound machine-written, such as `seamless`, `leverage`,
  `unlock`, `delve`, `robust`, `elevate`.
- Speak of "you" for the owner and "they" for the person on the profile. Never assume who the owner
  is or whom they like.

## Pull requests

- One change per pull request, with a plain description of what and why.
- The tests pass, and new behaviour has a test.
- The pull request template has a short checklist; please go through it.

By contributing you agree that your contribution is licensed under the MIT License of this
repository, and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
