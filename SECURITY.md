# Security

## Reporting a problem

Please report security problems privately, through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to
https://github.com/MichaelZelbel/godspeed-wingman/security/advisories/new.

Never in an open issue, a pull request or a discussion. Leave out real people's data: an invented
profile shows a problem just as well.

You get an answer as soon as possible. When the problem is confirmed, the fix is released and the report
is published with credit to you, unless you prefer to stay unnamed.

## Supported versions

| Version | Supported |
|---|---|
| 0.5.x | yes |
| older | no (0.1 to 0.4 were a private add-on) |

## What counts

Anything that breaks one of the promises the Wingman makes, for example:

- a profile's text that makes the assistant or the model do something (the text is meant to stay
  data);
- a way to like, pass or send that the person did not choose, or to send a message twice;
- a way for `settings.json` (which the assistant can edit) to run a program or send profiles to
  an address;
- reaching the desk from another computer or another web page, or without its key;
- a site adapter that runs while its terms verdict is missing or `forbidden`, or a `site check`
  that changes something on a site;
- data about other people ending up in git, in the mission control's memory, in a notification,
  or kept past the retention when it should not be;
- the installers running something other than the Wingman's own release.

## What the add-on stores

- In the person's mission control (`routines/wingman/`): their preferences, their watch list,
  their settings, and site adapters they added. In git.
- In a private folder outside git (`~/.godspeed/wingman`, or `/var/lib/godspeed/wingman` on a
  Linux server set up as root): the profiles it read and their pictures, the practice answers,
  reply ideas, the log, its own browser profile with the dating site's login, the desk's key, and
  `worker.env` with private settings such as a model key or a bridge token. Profiles are deleted
  after the retention (42 days unless the person chose otherwise).

The whole picture, including what leaves the computer: [docs/privacy.md](docs/privacy.md).
