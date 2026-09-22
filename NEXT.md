# Tomorrow

Picking up from 21 Sep. In order of what actually blocks him.

---

## 1. SYNC IS BROKEN — do this first

**Symptom:** the phone shows 3 items, the extension shows nothing.

**Cause, and it's a design mistake not a bug in the sync code.** There are
three separate stores and only one of them was ever configured:

| Surface | Where its settings live |
|---|---|
| `Start Locked In.cmd` → `localhost:8931` | `localStorage` on that origin |
| Chrome extension | `chrome.storage.local` |
| Phone (GitHub Pages / iOS) | `localStorage` on that origin |

He ran the setup wizard at **localhost**, so the Firebase URL and key landed
in localhost's `localStorage`. The extension never saw them and has no cloud
config at all — which is exactly why it "does nothing".

`test/sync.test.mjs` proves the merge logic converges correctly, so this is
purely about getting the same two values into all three places.

**The fix to build: a link code.**

- One base64 string encoding `{cloudUrl, cloudKey, salt, passphrase}`
- Extension Options: **Copy link code**
- Phone Setup + localhost Setup: **Paste link code** → fills every field
- Show a loud "not linked" state anywhere the cloud config is empty
  (the phone already does this; the extension does not)

Also worth doing: when the extension has no cloud config but localhost does,
the extension can't read localhost's storage — so the link code is genuinely
the only clean path. Don't try to be clever about it.

**Then verify end to end:** add something on the phone, confirm it appears in
the extension within 45s, and vice versa.

---

## 2. Finish tap-to-edit

Mostly done and working — tapping a row opens an editor with title, minutes,
due date, and a **Make it a reminder** / **Make it a task** button.

Left to do:
- Test the reminder editor (only the task one was exercised)
- Test both conversions actually move the item
- `~35m` marks an estimate Abby guessed; confirm that reads clearly on device

---

## 3. Talk to Abby instead of typing

> *"Hey, add this to the list."*

`shared/voice.js` already has a working dictation wrapper (`startDictation`,
`splitDictation`, `dictationToLines`) with tests, and the Chrome extension
still uses it. It was dropped from the phone during the simplification.

- Mic button beside **Snap your list**
- Route the transcript through `triage()` — same path a photo takes — so one
  utterance can produce both tasks and reminders
- Strip wake-phrasing first (`hey abby`, `add this to the list`,
  `remind me to`) with rules, not a model
- iOS caveat: `webkitSpeechRecognition` can be flaky inside a Capacitor
  webview. If so use `@capacitor-community/speech-recognition`.

**Estimate:** a couple of hours.

---

## 4. Siri Shortcuts

> *"Hey Siri, add this to my Abby list."*

The real prize: hands full, phone in pocket, walking out of class.

1. **App Intents** (iOS 16+) in Swift — `AddToAbbyIntent`, one string parameter
2. Shared **App Group** container: Swift appends to a pending-items file,
   `app.js` drains it on launch and on resume (`onResume` in
   `shared/native.js` already fires at the right moment)
3. Donate the shortcut so Siri suggests it

Capacitor doesn't expose App Intents, so this is a small custom plugin or
direct Swift in `ios/App/App/`. **Needs Xcode to test** — the GitHub Actions
runner can build it but can't exercise Siri.

**Estimate:** a day.

---

## Fixed on 21 Sep, for reference

- Regex lookbehind in `inbox.js` — SyntaxError on iOS < 16.4 that silently
  killed every module importing it. The app loaded and did nothing.
- Bare import specifiers in the iOS bundle (`shared/x.js` instead of
  `./shared/x.js`) — the webview refused every import.
- `CODE_SIGNING_ALLOWED=NO` left the app and all 7 frameworks unsigned, so
  Sideloadly couldn't re-sign them. Ad-hoc signing now, and the build fails
  if signatures are missing.
- **Service worker was cache-first with a fixed cache name** — it served a
  stale `app.js` forever, so installing an update showed the old app. Now
  network-first with cache as fallback only.
- `build-ios.mjs` now hard-fails on lookbehinds, bare specifiers, and a
  missing boot watchdog.

## Known good

179 tests across 6 suites: engine, crypto, map, fire, sync, triage.
`npm test` runs them all.
