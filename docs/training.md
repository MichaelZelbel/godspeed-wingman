# Training: how the Wingman learns your taste

The Wingman knows you through two things only: your preferences page, in your own words, and your
answers in practice. It assumes nothing else about who you are or whom you like.

## Practice and autopilot

Every site starts in **practice**. In practice the Wingman opens a profile, decides what it would
do, and asks you before anything happens:

> **From your Wingman:** practice (you agreed with 7 of my last 8). Mara, 27 (DE): I would LIKE
> them, high sure. VRChat with full-body tracking, and their bio says they love being teased.
> Agree? Say "agree", or "disagree" and why.

Your answer decides. The like or pass happens on the site only after it, exactly once.

Once you agreed with **9 of its last 10** practice verdicts on a site, that site goes on
**autopilot**: the Wingman likes and passes there by itself, at a person's pace. Each site counts
on its own. A new site starts in practice even when another one already runs on autopilot. The
rule is the setting `practice_until` (`{ "agree": 9, "of": 10 }`).

## How to answer

| You say | What happens |
|---|---|
| `agree` (or yes, right, a thumbs up) | It was right. The like or pass happens. |
| `disagree, they only want friends` | The opposite happens, and your reason becomes an example. |
| `like` or `pass`, with a reason | The same, said the other way round. |
| `disagree, but only this time` | A one-off. The like or pass happens, and the Wingman neither learns from it nor counts it. |

Your reason is what it learns the most from. A plain "no" works, but "no, they only want friends"
tells it where your line is. Say it the way you would say it to a friend; the assistant passes your
words on close to how you wrote them.

**Changed your mind afterwards?** "That last one was an exception" marks the answer as a one-off
after the fact (`godspeed-wingman exception --about <name>`).

## What happens to your answers

Each answer becomes an **example**: the profile as the Wingman read it, what it said, what you
said, and your reason. Before every later decision the judge reads your preferences page and up to
16 of your most recent examples, mostly corrections (they teach the most) and some agreements.
Examples from every site count, because taste does not change per site. Examples you called
exceptions are kept but never read.

The judge is told to weigh the whole profile, never one box alone, and to follow the reasoning of
your corrections. Its reason is one plain sentence to you; "high", "medium" or "low" says how sure
it is.

## Practice on demand, and review

- **"practice"** (or `godspeed-wingman train`, `train 20`, `train --site <id>`): a round now, ten
  profiles unless you name a number. It runs on autopilot too, and the site goes back to
  autopilot when the round ends.
- **"stop"** (`godspeed-wingman stop`): no more practice for today.
- **"review"** (`godspeed-wingman review`, five unless you name a number): it shows you decisions it
  made on autopilot, one at a time, and asks whether you agree. The like or pass already happened
  on the site; your answer teaches it for next time.

## Your preferences page

`routines/wingman/preferences.md` in your mission control. The setup wrote it from a starter and
your answers. It has four parts the judge reads well:

- **Who fits**
- **Who does not fit**
- **How to judge**: what weighs more, what to do with a thin profile
- **How I write**: used only for reply ideas, never for picking

Change it any time: by hand, in the desk's Preferences page, or by telling your mission control
("no smokers either", which runs `godspeed-wingman prefs add "no smokers either"`). A correction
of an earlier line should change that line, not add a second one that says the opposite.

## The watch list

`routines/wingman/watch.md`, one name per line. When a profile carries one of these names (its
name, another name it shows, its Discord name, or a word in its bio), the Wingman stops before
liking or passing and asks you: "like", "pass", or "you decide". Good for an ex, a friend, or
someone you already talk to elsewhere.

```
godspeed-wingman watch add "a name"
godspeed-wingman watch remove "a name"
godspeed-wingman watch list
```

## Reply ideas

When someone matches with you or writes to you, the Wingman writes three reply ideas that play
with a detail of their profile, in the tone you chose. "send 2" sends the second one; "send this:
<your words>" sends yours exactly. It never sends anything you did not pick or dictate, and it
sends each message exactly once.

```
godspeed-wingman send 2 --to R4
godspeed-wingman send --to R4 --text "your own words"
```

When someone you liked wrote a Discord name in their profile, the Wingman tells you that name
right after the like, so you can write there yourself. It never writes there for you.

## Why this works

A model copies examples more reliably than it follows rules. That is the idea behind Chapter 12 of
[*Teach It Once*](https://leanpub.com/teachitonce), "Correct AI Without the Argument": correct it
once, with a reason, and let the correction become an example it reads every time.
