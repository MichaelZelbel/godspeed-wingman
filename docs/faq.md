# Questions people ask

## Is this allowed?

On a site whose terms do not forbid it, yes, and the Wingman behaves like a careful person there:
your own account, your own login, a person's pace, no message you did not choose. Every site
records what its terms say about bots, automation and AI, with the sentences quoted. When you ask
for a site whose terms forbid it, your mission control tells you so before any code is written,
with the risk to your account, and you decide. The Wingman switches such a site on only by your
recorded choice. See [adding-a-site.md](adding-a-site.md).

## Does it work with the big dating apps?

Many big dating apps forbid automated use in their terms. The Wingman does not ship adapters for
them; that is its author's choice about what to hand out. Ask your mission control "Add <the app>
to my Wingman": it reads that app's terms, tells you what they say and what you risk (the app may
suspend or close your account), and builds it in your own folder if you decide to go ahead.

## Do I need Godspeed Mission Control?

Yes. The Wingman is an add-on: it keeps your preferences in your mission control, talks to you
through it, and your assistant passes your answers on. Start at
[godspeedmissioncontrol.com/install](https://godspeedmissioncontrol.com/install).

## Do I need a server?

No. On Windows, macOS or a Linux desktop it runs on your computer, and you train it in the desk
page in your browser. A server lets it run around the clock and lets you train it on your phone
through Telegram ([server.md](server.md)).

## Does my computer have to be on?

At session time, yes. If it was off at 18:30, the session starts when the computer is on again
that day.

## What does it cost?

The Wingman is free (MIT). It uses the model your mission control already has: Claude Code,
Codex, or an OpenAI-compatible model with your own key. Each profile takes about one call, and so does each
set of reply ideas.

## Who is it for? Does it assume I am looking for a certain kind of person?

It assumes nothing. It knows you only through your preferences page and your answers. The starters
and the setup questions work for anyone looking for anyone.

## Will it write to people for me?

Only what you pick or dictate. Three reply ideas reach you; "send 2" sends the second, or you say
your own words. It never writes to anyone outside the dating site. When someone you liked has a
Discord name in their profile, it tells you the name, and writing there is yours.

## It keeps asking me. When does it decide alone?

Once you agreed with 9 of its last 10 practice verdicts on that site. Give reasons when you
disagree; that is what it learns from. [training.md](training.md).

## It decides alone now, and I want it to ask again.

Say "practice" for a round any time, or "review" to go through what it decided on its own. Your
answers there teach it as before.

## How do I change what I am looking for?

Tell your mission control ("no smokers either"), edit the desk's Preferences page, or edit
`routines/wingman/preferences.md` by hand. Change a line rather than adding one that says the
opposite.

## How do I stop it for a while?

Say "pause", or run `godspeed-wingman pause`. Nothing is liked, passed or read until "resume".

## Someone says I liked them. Who was that?

Ask "who was <name>?". It searches every profile kept (by name, another name, a Discord name or a
word from their bio) and shows the picture of their profile. After the retention (42 days unless
you chose otherwise) they are gone, except from the notebook list below if you switched it on.

## Does it put the people it sees into my notebook?

Not unless you switch it on. The list "Wingman: likes and passes" is off. You can tick it in the
setup questions, which offer it only when your Godspeed notebook answers on this computer, or set
`"notebook_collection": true` in `routines/wingman/settings.json`. The list is hidden from your
assistants. It is not deleted after the retention: it stays until you delete it in the notebook.

## Can other people see the desk?

No. It answers only on your computer (127.0.0.1), only to a browser that holds its key.

## Does it touch my everyday browser?

No. It uses its own browser profile, with only the dating site's login in it.

## The login stopped working.

Sites log people out now and then. The Wingman stops on that site and tells you once a day. Log in
again in the Wingman's browser (`godspeed-wingman site login <site>`, or the desk's Status page).

## Today's session stopped on errors.

When errors stop a session (a crashed browser tab, a site that is down for a while), the Wingman
tries once more about an hour later, because most of these are gone by then. If that one stops
too, or the day has no time left for it, it tells you once that day: when it stopped, what went
wrong in a few words, and that your assistant should check it. `godspeed-wingman check` names what
failed, and says plainly when it is not a login problem.

## Something else broke.

`godspeed-wingman check` goes through every part and says what to do. Or tell your mission
control; repairing it is its job.

## How do I update it?

Run the install line again. Your files and everything it kept stay.

## How do I take it out?

`godspeed-wingman uninstall`. Your own files stay; it asks before deleting the private folder.

## Where do I report a problem, or ask for a site?

[Open an issue](https://github.com/MichaelZelbel/godspeed-wingman/issues/new/choose). A security
problem goes through [SECURITY.md](../SECURITY.md) instead.
