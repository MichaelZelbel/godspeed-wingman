# Privacy: what is kept where, for how long, and what leaves

The Wingman handles two kinds of data: yours (what you want, how you write) and other people's
(the profiles it reads). They live in two different places, on purpose.

## Your words: in your mission control

In `routines/wingman/` in your mission control folder:

- `preferences.md`: who you are looking for, in your words.
- `watch.md`: the names on your watch list.
- `settings.json`: your choices (sites, times, where it talks to you, the model, the retention).
- `sites/<id>/`: site adapters you or your coding helper added, with the record of their terms.

These are plain text, and they are in your mission control's git history like your other files.
By default (`"sync": "auto"`) a change you make through the Wingman is committed and pushed, so it
reaches your other machines; `"commit"` commits without pushing, `"off"` leaves git alone.

Keep in mind that the names on your watch list are in that history too.

## Everything about other people: in the private folder

`~/.godspeed/wingman` (Windows: `%USERPROFILE%\.godspeed\wingman`; a Linux server set up as root:
`/var/lib/godspeed/wingman`; `GODSPEED_WINGMAN_STATE` or `--state` choose another place). It is
never in git, because git never forgets, and these people did not ask to be remembered.

What is in it:

- `archive/<day>/<site>.<id>/`: every profile the Wingman opened (from your queue, your matches
  and everyone you have a conversation with), as the site sent it, as the Wingman read it, the page
  as the browser showed it, and a picture of it.
- `collection-items.json`: when the notebook list is on, which item in it holds whom, so "who was
  that?" can link to it.
- `screenshots/<day>/`: the same pictures, named by day and name, to look back.
- `examples.jsonl`: your practice and review answers, each with the profile text the judge read.
- `decisions.jsonl`: every like, pass, stop and question.
- `replies.json`: the reply ideas waiting for you.
- `desk/`: the desk's messages, and the desk's key.
- `browser/`: the Wingman's own browser profile, with your login on the dating site.
- `worker.log`: what the worker did. When something goes wrong with a profile, a line can name it.
- `worker.env`: private settings for the worker (a model key, the bridge token). On Linux and
  macOS only your account can read it.
- `state.json`, `requests/`, `heartbeat.json`: what runs and what waits.

The Android emulator, when you set one up, lives in `~/.godspeed/android` with the apps and logins
in it ([android.md](android.md)).

## How long

**42 days** unless you choose another number (`retention_days`, asked in the setup). Once a day the
worker deletes everything older than that about other people: the profile folders and their
pictures, the decisions, the reply ideas, the desk's messages, the lists of who liked you, and the
Discord names it told you.

Two things stay longer, and a third one only if you switch it on:

- **Your practice answers** are how the Wingman learns, so they stay. After the retention each one
  loses the person's name and profile id; the text the judge read (their bio, their details) stays
  with your answer and your reason.
- **The worker's log** is not cut by date. It starts a new file at 2 MB and keeps the one before.
- **The notebook list of likes and passes**, only if you switch it on (see below). It is not
  deleted with the retention. It stays until you delete it.

**The disk guard.** When the disk gets below 8 GB free (`min_free_gb`), the oldest pictures go
first, never the last seven days and never the profiles themselves.

## What leaves your computer

- **Through Godspeed's configured AI connection:** each profile's text (never the pictures), your
  preferences page and a few practice answers. For reply ideas: the profile, the last message and
  your writing preferences. Godspeed sends them to its configured provider, which can also be a
  local model. The request has no tools or chat history. The Wingman does not copy Godspeed's
  credentials. If you explicitly chose a separate Claude Code, Codex or OpenAI-compatible
  connection, that choice and its provider's rules apply instead.

- **To Telegram, if you chose it:** the Wingman's messages to you, with names, the reason, the
  picture of the profile and the reply ideas. They stay in your Telegram chat.
- **To the dating site:** what a person does there, at a person's pace: opening profiles, likes,
  passes, and the messages you chose.
- **To the bridge's computer**, when the Wingman runs on a server: the pages open in the Chrome
  there.
- **To your Godspeed notebook, only if you switch it on:** one list, "Wingman: likes and passes",
  one item per profile liked or passed (date, name, age, gender, place, site, liked or passed, by
  whom, the reason in one short sentence, the profile's address, a Discord name, a link to the
  picture, and a column for your own comment). The reason is the Wingman's, or your own words when
  you said why. Everyone you matched with or have a conversation with gets an item too, also when
  you liked them yourself in the site's app or wrote first: liked, "you, on" that site. When the
  site no longer has their profile, the item holds only what the list of conversations shows. It
  is off unless you tick it in the setup questions (they offer it only when the notebook answers
  on this computer) or set `"notebook_collection": true` in the settings. The list is hidden from every assistant, so none
  of them can turn a stranger into a fact or a suggestion; "who was that?" tells them whether
  someone is in it, with a link to their item.
  The Wingman never deletes items from it, so it is not deleted with the retention: delete items
  yourself, or delete the whole list in the notebook (the Wingman then stops writing it).
  `"notebook_collection": false` switches it off again; that stops new items, and what the list
  already holds stays until you delete it.

What never leaves:

- Notifications never show a name, a picture or anything a stranger wrote; they can appear on a
  lock screen.
- The desk answers only on this computer (127.0.0.1), only to a browser that holds its key.
- Nothing about other people goes into your mission control's memory, its notes or git, apart
  from the notebook list above when you switch it on.
- Nothing goes to the Wingman's author. There is no usage reporting of any kind.

## Strangers' words are data, never instructions

Profiles are written by strangers. Everything a profile says reaches the model fenced off as data
to judge, and reaches your assistant only cleaned (one short line, no brackets, quotes or code
marks), so a profile cannot hand your assistant a command.

## Deleting

- **One person:** they disappear by themselves after the retention.
- **Everything about other people:** `godspeed-wingman uninstall --delete-state`, or delete the
  private folder while the worker is stopped.
- **A shorter memory:** lower `retention_days`; the next daily clean-up applies it.
- **The notebook list, if you switched it on:** the retention does not touch it. Delete its items,
  or the whole list, in the notebook.
- **Your own words:** they are your files in `routines/wingman/`; the uninstall leaves them, so
  delete them yourself if you want them gone.

Chapter 22 of [*Teach It Once*](https://leanpub.com/teachitonce), "Check Where Your Private
Information Goes", explains why the line between your mission control and the private folder sits
where it does.
