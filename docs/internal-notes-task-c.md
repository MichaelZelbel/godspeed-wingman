# Internal notes from task C (delete before publishing)

Written 2026-10-10 by the coding helper that built sites and Android. Branch `task-c-sites`.

## What was added

```
lib/commands/site.mjs      site list | new | terms | check | use | off | login | network
lib/commands/android.mjs   android setup [--dry-run] [--accept-licenses] [--yes] [--headless] [--no-start]
                           | start | stop | status | dump [--all] | screenshot [file] | remove [--yes]
lib/sites/manage.mjs       newSite, recordTerms, useSite, offSite, siteRows, enabledSites, cannotUse
lib/sites/check.mjs        checkSite (offline + live read-only probe), siteLogin, siteNetwork, runOwnTests
lib/sites/guard.mjs        readOnlyAdapter, readOnlyBrowser (in-page guard), readOnlyAndroid, offlineDriver
lib/sites/trust.mjs        trustProblem: refuse the person's own adapters when another account can change them
lib/sites/_template/       browser/ and android/: site.json, adapter.mjs, adapter.test.mjs, README.md, gitignore
lib/drivers/android.mjs    createDriver({ settings, paths, log }) -> AndroidDriver over adb
lib/android/               sdk.mjs (Google's lists, finding an SDK), java.mjs (Temurin), files.mjs
                           (verified download, zip reader), emulator.mjs (start/stop/accel), setup.mjs
skill/wingman-add-site/    the recipe for the coding helper
docs/adding-a-site.md, docs/android.md
```

## Small changes in task A's files (merge with care)

- `lib/sites/index.mjs`: `android.package` required for kind android, `post_reads` validated,
  `listSites(...).untrusted`, `loadSite` refuses untrusted before importing; `listSites/loadSite`
  take `trust` (tests).
- `lib/core/settings.mjs`: new key `android_device` (adb name, regex-checked, default "").
- `lib/core/worker.mjs`: `theirPage(profile)`: the "Their profile: <url>" line only when there is a
  url (app profiles have none). Three message lines changed, nothing else.
- `lib/commands/check.mjs`: one line, an untrusted own site is a FAIL line instead of a crash.
- `skill/wingman/SKILL.md`: one bullet pointing "add a site" to `wingman-add-site`.
- `lib/sites/contract.md`: Android sites, `post_reads`, duck-typed `loggedOut`, the Android driver,
  the person's own sites, trust.

## For task D

- README "Everyday commands" can name `site list | new | check | use` as drafted; also `site
  terms`, `site login`, `android setup --dry-run`.
- Privacy scan false hits in this branch: the words "silent", "none" and "Max" (`Math.max`).
- `test/fixtures/android/*.xml` are excerpts of Google's public lists (licence texts shortened).
- The real-files trust test is skipped on Windows; it passed in WSL Ubuntu as a normal account
  (Node 18), and a root process refused an adapter owned by another account there. CI on ubuntu
  runs it.
- `android setup` was only dry-run on the development PC (no Java, no SDK, Windows Hypervisor
  Platform off). The full install path is tested with pretend tools, never for real.
