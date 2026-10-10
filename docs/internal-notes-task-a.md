# Internal notes from task A (delete before publishing)

Written 2026-10-10 by the coding helper that built the foundation. Tests: `node --test "test/*.test.mjs"`,
168 passing on Windows 11 / Node 22.19 (the Chrome test ran against the installed Chrome 154).

## Module layout

```
bin/godspeed-wingman.mjs          thin: main(argv) from lib/commands, then process.exit(code)
lib/commands/index.mjs            registry: every *.mjs here except index and _*; exports meta+run or commands[]
lib/commands/_common.mjs          viaWorker, workerAlive, heartbeat, stateOf, diskLines
lib/commands/{answer,session,files,who,status,check,context,worker,setup,help}.mjs
lib/core/                         settings, paths (+ loadWorkerEnv), store, text (clean, fenced, headline),
                                  state (FRESH, FRESH_SITE, siteState, keyOf), worker, judge, replies,
                                  training, watch, archive, requests, context, collection, notebook,
                                  discord (off-site contact), model (lanes), exe (program finder), image, sync
lib/sites/index.mjs               registry: listSites, loadSite, validateSite, termsReminder, siteDirs,
                                  adapterGaps, REQUIRED, PROMISED, CAN, VERDICTS, KINDS, BUILTIN_DIR
lib/sites/errors.mjs              SiteError { loggedOut, refused, site, code, status }, isLoggedOut
lib/sites/contract.md             the contract (keep it and test/sites.test.mjs in step)
lib/sites/flirtual/               site.json, adapter.mjs, api.mjs (FlirtualApi, FlirtualError extends
                                  SiteError), profile.mjs (normalize, digest), page.mjs (takePicture), names.json
lib/drivers/index.mjs             createDriver(settings, { paths, log, tab, keepOpen })
lib/drivers/bridge.mjs            Chrome Agent Bridge over HTTP
lib/drivers/chrome.mjs            NEW local Chrome/Edge over CDP (findBrowser, ChromeDriver)
lib/channels/index.mjs            tell(text, picture, { settings, paths, log, impls }), readiness(), loadChannel()
lib/channels/telegram.mjs         send/ready + credentials, envCandidates, resolveEnvFile, sendText, sendPhoto
lib/channels/desk.mjs             MINIMAL: appends to <state>/desk/messages.jsonl (B owns the page)
lib/setup/index.mjs               plan + step functions (below), setup(), uninstall()
lib/setup/service.mjs             windowsTaskXml, launchAgentPlist, systemdUnit, installService, removeService
lib/setup/hermes.mjs              locate, installPlugin, removePlugin, restartGateway, hasTelegram
lib/setup/claude.mjs              mergeHook, removeHookText, installHook, removeHook
skill/wingman/SKILL.md            the daily recipe
hermes/plugin/godspeed-wingman/   pre_llm_call plugin; runs launcher.json's argv (no shell, no .cmd)
```

Archive folders are `archive/<day>/<site>.<id>`; raw site data is `raw.json` (was flirtual.json).
Decisions, examples, replies, waiting, discordTold keys all carry the site (`keyOf(site, id)` = "site:id").
Decision `by` values: `you` and `wingman` (were michael/godspeed). Examples: `judge` and `owner` (were godspeed/his).

## Commands

answer, exception, send, who, train [--site], review, run [--site], pause, resume, inbox, stop, notebook,
prefs, watch, status, check, context [--hook claude], worker [--once] [--supervise], setup, uninstall,
help, version, _sync (hidden). Global flags: --godspeed, --state, --wait, --help.

## Adapter interface as built

`create({ driver, settings, log, wait, now })` returns `session, queue, profile, like, pass` (required)
plus `open, picture, html, skip, conversations, send, likedYou, digest` as site.json `can` promises
(`adapterGaps` enforces it at load). Details in lib/sites/contract.md. Notes:
- `queue()` -> `{ next, limits, done }`; empty next with done false = retried 6 times, 30 s apart.
- `like/pass` -> `{ match, limitReached, why: "likes"|"profiles" }`, run once.
- `picture(profile?)` -> `{ data, ext, capture, meta }`; meta carries `loggedIn` (false pauses retakes 30 min).
- `conversations()` -> `[{ id, with: { id, name }, messages: [{ id, fromMe, text, at, system }] }]`.
- Profile shape: `{ id, site, name, age, gender, pronouns, location, country, bio, fields, prompts:[{q,a}],
  texts, handles:{label:name}, photos, url, contact:{discord}, raw }`; Flirtual adds `photoKeys`.
- `settings` given to an adapter = `{ kind: settings.kind, ...settings.site_options[id] }`.
- A site of kind `android` gets its driver from `lib/drivers/android.mjs` if that file exists:
  `export function createDriver({ settings, paths, log })` returning an object (with `close()`).
  Until then the worker refuses such a site with a plain sentence (task C).
- The person's own sites in `<mc>/routines/wingman/sites/<id>/` are already found and loaded by the
  registry (built-ins win on a clash). Folders starting with `_` (the `_template` of task C) are skipped.
  Security note for C: such an adapter is code from the mission control folder run by the worker.

## Setup functions for B and C

`plan(flags, sys)` -> p (mcDir, stateDir, appDir, binDir, script, node, service, runAs, routine, paths, desktop).
`stepProgram(p)`, `stepState(p)`, `initialSettings(p, found)`, `explicitSettings(p, found)`,
`checkSites(p, ids)`, `stepRoutine(p, wantedSettings, { preferences })` (B: pass the starter text as
`preferences`; it never overwrites an existing preferences.md), `stepRecipe(p)` (copies every
`skill/<name>` in RECIPES = wingman, wingman-add-site, with the marker), `stepHermes(p, h)`,
`stepClaude(p)`, `stepWorkerEnv(p)`, `stepService(p)`, `stepCommit(p, files)`, `setup(flags, sys)`,
`uninstall(flags, sys)`, `launchers(p)`, `launcherArgv(p)`. `sys = { env, platform, root, home }` stands in
for the machine (tests). Setup flags: --godspeed --state --site --browser --bridge --talk --hermes-home
--hermes-profile --telegram-env --timezone --daily-start --app --notebook --screenshots-url --no-service
--no-hermes --no-claude --yes --delete-state. B: add the wizard as a new command file or a `--wizard`
path in lib/commands/setup.mjs; add "starters" to package.json "files".

## Facts checked on this PC

- `codex exec --help` (codex-cli 0.155.1): --sandbox read-only, --skip-git-repo-check, --ephemeral,
  --ignore-user-config, --ignore-rules, -C, -o, -m, "-" for stdin. Tools switched off with
  `-c features.<name>=false` (names from `codex features list`). Never called for real.
- `claude --help` (2.1.270): the old print-mode flags still exist.
- Hermes (v0.21.2): NO hermes lane. `hermes -z` needs at least one valid toolset and auto-approves;
  `hermes chat -t <unknown>` only warns and resolves to no static tools, but plugins/MCP/memory can add
  tools at runtime; nothing documented guarantees a tool-free turn. Settings coerce lane "hermes" to claude.
- Windows: `conhost.exe --headless node ...` runs without a window and waits for node, but always exits
  0, hence `worker --supervise`. The task XML registered without elevation (checked with a disabled
  throwaway task, deleted right after). The real task was never installed on this PC.
- Godspeed v2 Windows Hermes: home `%LOCALAPPDATA%\Godspeed Mission Control Full Alpha State\hermes-profile`,
  program `...\hermes-runtime\bin\hermes.exe` when isolated; Hermes' own Windows home is
  `%LOCALAPPDATA%\hermes` (its .env is there, not in ~/.hermes).
- Flirtual terms (read 2026-10-10): terms last updated December 4, 2025, nothing on bots/automation/AI;
  guidelines: "Misusing Flirtual or attempts to maliciously exploit Flirtual will be investigated."

## Not done, and why

- Not run live against Flirtual on purpose (keeps away from Michael's account and home IP).
- macOS LaunchAgent, systemd user/system units and the root `runuser` path for Hermes are only checked
  as generated text; no Mac or Linux here. CI on ubuntu (task D) runs the rest of the suite.
- `server/caddy-wingman.caddy` dropped. GODSPEED_WINGMAN_SCREENSHOTS_URL / _NOTEBOOK go to `<state>/worker.env`.
- The old `--bot-user` (assistant and worker as different accounts on a root server) is gone: the
  worker runs as the mission control's owner (User=), state folder 2770 for that account.
- README is a placeholder for task D.
- For task D's privacy scan: commits are authored with this PC's configured git identity (its
  e-mail address is in every commit's metadata; check it is the one to publish). Two real profile names in the private collection are ordinary words
  that appear in code ("silent" is a terms verdict the brief requires; "none"), so whitelist those.
  The scratch scanner used here lives outside the repo.
