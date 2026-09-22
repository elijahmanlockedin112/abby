# Locked In

A Chrome extension and an iPhone web app that answer one question when you sit
down after school: **what am I supposed to be doing right now?**

It lives in one pinned tab:

```
RIGHT NOW
Biology ch 4 review
35m
Test Thursday. Nearest deadline on your list.

THEN            FFA quiz prep            45m
AFTER THAT      Finish GitHub project    60m

2h 47m until bedtime            [ ▶ Start 35m ]
```

The complexity is underneath. The screen is four lines.

**It does not take over your new tab page.** It sits as a single favicon at the
far left of your tab strip, there when you open Chrome and gone when you close
it. `Ctrl+Shift+L` jumps to it from anywhere.

---

## See it right now

Double-click **`Start Locked In.cmd`**.

It opens setup in your browser and prints a URL your phone can use on the same
Wi-Fi. No install, no extension, no accounts. Needs [Node.js](https://nodejs.org)
(the LTS button) — the launcher tells you if it's missing.

```
On this PC:
  Setup        http://localhost:8931/extension/setup.html
  Right now    http://localhost:8931/extension/now.html
  Full brief   http://localhost:8931/extension/newtab.html

On your phone (same Wi-Fi):
  http://192.168.x.x:8931/pwa/
```

Over plain http the phone app runs but can't cache for offline use. Host it on
GitHub Pages for the real install — see below.

---

## The one rule everything is built around

You said it first: **AI adds unnecessary things.** So the scheduler isn't AI.

`buildPlan()` is a pure function that takes your tasks and returns *those same
tasks*, ordered and timed. There is no code path in it that creates a task. The
sidebar counts this out on every render:

```
uploaded   added by you   accounted for   invented
    4            1              5             0
```

If `invented` is ever anything but `0`, the app is lying and the number says so.
The test suite asserts it stays `0` — when the evening overflows, when the
calendar eats half of it, and when reminders are sitting in the same state.

The "why this, now" line under each block is a string template over your data,
not prose a model wrote:

> *Test Thu (2 days out). Nearest deadline on the list, so it goes first.*
> *No deadline written on this line. Holding your list order (#3).*

**How the order is decided** — deadline bucket first (tonight/tomorrow, then ≤3
days, then ≤7, then none), and inside a bucket **the order you said it wins.**
That's the only tiebreak. Nothing is compressed to fit: if the list is longer
than the evening, the overflow is named out loud.

---

## What it does

### Say your list — don't type it

> *"biology chapter four review thirty five minutes then FFA quiz prep forty
> five minutes and finish the github project an hour"*

becomes three editable lines with the durations already filled in:

```
1  Biology chapter four review 35m
2  FFA quiz prep 45m
3  Finish the github project 1h
```

You read them, fix anything wrong, tap **Use as tonight's list**. The split is
deterministic — filler words dropped, spoken numbers converted, `half an hour` →
`30m`, `an hour and a half` → `90m`. With a key set, the model gets one shot at
splitting it better, and any line it returns that doesn't quote what you actually
said is thrown out.

Transcription happens in the browser. No audio is uploaded.

### Reminders — the notification lane

> *"cancel spotify subscription on november 30"*

becomes a reminder for **Nov 30**, and on Nov 30 Chrome tells you. It understands
`November 30` · `Nov 30th` · `30 November` · `11/30` · `Friday` · `next Tuesday` ·
`tomorrow at 9am` · `in 2 weeks`.

This is a **separate lane from tasks on purpose.** A reminder is a thing that has
to surface on a day; it is never scheduled into an evening and never appears in
the ledger. Cancelling Spotify isn't homework.

Where notifications actually fire:

| | fires when the app is closed? |
|---|---|
| Chrome extension | **Yes** — whenever Chrome is running |
| iPhone PWA | **No** — only while it's open |

If Chrome wasn't running the moment something came due, it fires the next time
you open Chrome and tells you how late it is. See [IOS.md](IOS.md) for closing
the phone gap properly.

### Life Context Engine — throw anything in

Screenshots, PDFs, voice memos, GitHub activity, open tabs, half-thoughts at 9pm.
No folders, no tags. This is the part that most wants to break the rule above,
so it can't:

```
   capture  →  candidates  →  you accept  →  committed list
                   ↑                              ↑
          quotes its source            the only thing the scheduler sees
```

Every candidate carries the exact line it came from. A model-proposed candidate
whose quote **isn't verbatim in your material is dropped before you see it.**
Screenshots need a key (there is no local OCR); text, PDFs with a text layer,
GitHub and tabs all work through the rules pass with no key at all.

### Future Me — trajectory, not vibes

> *You're 2h 30m behind the pace required to finish by October 20.*
> *Suggested adjustment: 35m tomorrow + 50m Thu.*

Zero AI. `doneMin` is sessions you actually finished. The evenings are your real
bedtime minus your real calendar. `expected − done = behind`. When it genuinely
doesn't fit it says so instead of inventing a heroic schedule:

> *There isn't enough evening left before October 20. You need 9h and only about
> 6h 30m exists after your calendar takes its cut.*

### Ask

The questions you ask daily are **looked up, not generated**, so they can't be
wrong — and they need no key:

`what should I do right now` · `what did I leave unfinished yesterday` ·
`what do I need to worry about this week` · `am I on pace` ·
`how much time do I have` · `what did I get done today` · `what's on the list`

Anything else falls through to the model, and the answer is labelled
`answered by the model` vs `looked up — no model involved`.

---

## Install as a Chrome extension

This is what gives you the pinned tab, arrival detection, and notifications that
fire when the app isn't open.

1. `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → pick **this folder** — the one with `manifest.json`,
   *not* `extension/`
3. Setup opens by itself. Open a new tab when you're done.

The extension is the whole repo so both clients share one copy of the engine —
no build step, no duplicated scheduling logic.

## Install on your iPhone

The PWA needs HTTPS to install properly, so it has to be hosted. GitHub Pages:

```bash
git add -A && git commit -m "Locked In"
gh repo create locked-in --public --source=. --push
gh api -X POST repos/:owner/locked-in/pages -f source[branch]=main -f source[path]=/
```

Then on your phone: open `https://<you>.github.io/locked-in/pwa/` in **Safari** →
Share → **Add to Home Screen**. Full screen, works with no signal, one tap from
your lock screen — which matters, because you're using it at 3:00 walking out of
class.

> Pages serves publicly. The sync key is what protects your data, not the repo.

Want a real native app with lock-screen widgets and Siri? [IOS.md](IOS.md).

---

## Setup

Everything is in the wizard on first run, and in **Options** afterwards. All of
it is optional.

| | What it turns on | Where to get it |
|---|---|---|
| **API key** | Reading screenshots; messy-text extraction; better voice splitting; open-ended questions | platform.openai.com/api-keys — GPT-5.1 by default, or Anthropic |
| **Calendar feed** | Blocked time + deadline flags | Google Calendar → your calendar → Settings and sharing → Integrate calendar → **Secret address in iCal format** |
| **Phone sync** | The 3:00 list landing on your PC | console.firebase.google.com → new project → Realtime Database → create in **test mode** → copy the URL |
| **GitHub** | Recent activity as inbox context | your username; a token only for private repos |

**The model never decides your order.** It reads, extracts, splits and answers.
The schedule stays arithmetic.

**The API key is local-only.** It is never written to the synced document, so it
doesn't travel to the cloud or your phone — add it separately on each device.
Calls go straight from your browser to the provider on your own billing.

**Phone sync security, honestly:** test-mode rules let anyone who knows the exact
path read the record. The generated key *is* the password — don't post it. To
tighten it:

```json
{ "rules": { "lockedin": { "$key": { ".read": true, ".write": true } } } }
```

That still relies on the key being secret, but stops anyone enumerating the root.

---

## Ambient arrival

No surveillance, no extra permissions. `chrome.idle` notices the first time
you're actually *using* the browser on a given day after your arrival hour, and
sends **one** notification:

> **Welcome home, Elijah.**
> 4 things tonight. Biology ch 4 review first.

Clicking it focuses the pinned tab. It fires once a day, never twice, and never
opens a window on its own.

An earlier version delivered this by taking over the new tab page instead. That
was wrong — every new tab turning into a planner is the opposite of staying out
of the way — so it's a notification you can ignore and a tab you choose to look
at.

## Where it lives

| | |
|---|---|
| **Pinned tab** | Far left of the strip, survives restarts. Turn it off in Options. |
| **`Ctrl+Shift+L`** | Jump to it from anywhere |
| **Toolbar icon** | Quick popup: current task, timer, what's next |
| **Badge** | Red = a reminder is standing. Gold = tasks left tonight. |

Every path reuses the same tab — you can't end up with six copies of it.

---

## Layout

```
Start Locked In.cmd     double-click this
manifest.json           the extension (load THIS folder unpacked)
shared/
  engine.js             parsing, scheduling, reason lines, the ledger — pure
  goals.js              Future Me trajectory math — pure
  reminders.js          dated things, parsing and firing logic — pure
  voice.js              dictation → editable task lines
  inbox.js              capture, extraction, the verbatim-quote gate
  ask.js                intent router; model only for the long tail
  sources.js            GitHub + open tabs → captures
  ics.js                calendar feed parser (incl. weekly recurrence)
  ai.js                 OpenAI + Anthropic, behind one interface
  sync.js               local-first store + Firebase REST overlay
  ui.js / ui.css        renderers and one design system for all surfaces
extension/
  setup.html/js         five-step first-run wizard
  now.html/js           RIGHT NOW — what the pinned tab shows
  newtab.html/js        full briefing: plan, voice, reminders, inbox, goals, ask
  popup.html/js         toolbar: current task, timer, next up
  options.html/js       everything the wizard set, editable
  background.js         pinned tab, arrival notification, reminder firing, badge
pwa/
  index.html, app.js    Now / Capture / Plan / Setup
  sw.js                 offline shell
test/engine.test.mjs    80 assertions
tools/serve.mjs         the local server the launcher runs
```

```bash
node test/engine.test.mjs
```

---

## Known limits

- **A phone browser can't notify you when it's closed.** The extension covers the
  PC. [IOS.md](IOS.md) covers fixing this properly.
- **A `TZID` time in a calendar feed is read as local time.** Exact when the
  calendar's timezone matches the device's, off by the offset difference when it
  doesn't. `Z` times convert properly.
- **Recurring events**: weekly and daily `RRULE`s expand; monthly and yearly fall
  through as their single original occurrence.
- **PDF text extraction is a scrape**, not pdf.js. Exported/text PDFs work;
  compressed streams and scans don't — the app says so and tells you to
  screenshot it instead.
- **Sync is last-writer-wins on one document.** Editing on both devices inside the
  same 45-second poll window means one edit loses. Fine for one person.
- **GitHub anonymous API is 60 requests/hour.** A token raises it.
- **`gpt-5.1` is the default model id, not a verified one.** If your key can't
  reach it, **Test** says so immediately and you type a different id. Nothing
  else in the app depends on it.
