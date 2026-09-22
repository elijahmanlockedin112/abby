# Next — voice, for tomorrow

Two things Elijah asked for on 21 Sep, explicitly **not** to be built that day.

---

## 1. Talk to Abby instead of typing

> *"Hey, add this to the list."*

Hold a button, say it, done — no keyboard, no photo.

**Most of this already exists.** `shared/voice.js` has a working dictation
wrapper (`startDictation`, `splitDictation`, `dictationToLines`) with tests,
and the Chrome extension still uses it. It was dropped from the phone when
that got simplified to one screen.

What's left:

- A mic button beside **Snap your list** on `pwa/index.html`
- Route the transcript through `triage()` — the same path a photo takes — so
  one utterance can produce both tasks and reminders:
  *"add biology review and remind me to bring my lab notebook tomorrow"*
- Strip the wake-phrasing first: `hey abby`, `add this to the list`,
  `remind me to`. Rules, not a model — instant and free.
- iOS caveat: `webkitSpeechRecognition` works in Safari 14.1+, but inside a
  Capacitor webview it can be unreliable. If it is, use
  `@capacitor-community/speech-recognition`, which uses the native engine and
  is better anyway.

**Estimate:** a couple of hours. Mostly wiring; the hard part is written.

---

## 2. Siri Shortcuts

> *"Hey Siri, add this to my Abby list."*

This is the real prize — hands full, phone in your pocket, walking out of
class. No unlocking, no app.

Needs native work:

1. **App Intents** (iOS 16+) in the Swift layer — an `AddToAbbyIntent` with a
   spoken phrase and one string parameter.
2. The intent writes into the same store the webview reads. Cleanest path is
   a **shared App Group** container: the Swift side appends to a small
   pending-items file, and `app.js` drains it on launch and on resume
   (`onResume` in `shared/native.js` already fires at the right moment).
3. Donate the shortcut so Siri suggests it.

**Watch out for:** Capacitor doesn't expose App Intents, so this is a small
custom plugin or direct Swift in `ios/App/App/`. Once written it survives
`cap sync` as long as it lives outside the generated files.

**Estimate:** a day, and it needs Xcode to test properly — the GitHub Actions
runner can build it but can't exercise Siri.

---

## Order

Do **voice in the app** first. It's cheap, it's mostly done, and it delivers
most of the value. Siri is the polish on top, and it's worth doing only after
the plain version is something he actually uses daily.
