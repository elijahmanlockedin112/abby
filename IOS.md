# Making Locked In a real iOS app

You asked whether this could become an actual iPhone app. Yes — and there's a
specific reason it's worth doing, which is the thing you just said: **notifications
are the entire idea.**

That's exactly where the web app hits a wall, so this isn't a vanity port.

---

## Why the web app can't fully do notifications

A web page can only fire a notification **while it's open**. Close the tab, lock
the phone, and nothing happens. The Chrome extension gets around this because its
background worker keeps running — but only while Chrome is open, on your PC.

So today:

| | fires when the app is closed? |
|---|---|
| Chrome extension | **Yes**, whenever Chrome is running |
| iPhone PWA | **No** — only while you're looking at it |
| Native iOS app | **Yes**, always |

For "remind me on November 30", the PC covers you. The phone doesn't. That's the
gap a native app closes.

---

## Three paths, cheapest first

### 1. Web Push on the PWA — no native code

iOS 16.4+ **does** support push for PWAs added to the Home Screen. It needs three
things you don't have yet: VAPID keys, a service worker push handler, and
something server-side to actually send the push on the right day.

- **Effort:** a weekend. Mostly a ~50-line serverless function plus a free cron
  service to poke it daily.
- **Cost:** free tier on Vercel/Cloudflare/Deno Deploy.
- **Gets you:** real notifications on a locked phone.
- **Doesn't get you:** widgets, Siri, share sheet.
- **Catch:** it breaks the project's current "no backend" property. You'd be
  running a server.

### 2. Capacitor — wrap what you already built ★ recommended

[Capacitor](https://capacitorjs.com) takes this exact web app and produces a real
Xcode project. Your `shared/` folder — the engine, the scheduler, the ledger, the
trajectory math, all 80 tests — ports with **zero changes**. You'd swap the
browser Notification API for `@capacitor/local-notifications`, which schedules
real iOS notifications on the device with no server at all.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/local-notifications
npx cap init "Locked In" com.elijah.lockedin --web-dir=pwa
npx cap add ios
```

- **Effort:** a day to get it running, a week to make it feel native.
- **Gets you:** real local notifications with no backend, app icon, splash
  screen, share sheet, camera — and a base you can bolt widgets onto.
- **The Windows problem:** compiling iOS needs macOS. But **GitHub Actions gives
  free macOS runners**, so you can build the `.ipa` in the cloud from Windows.
  Codemagic and Expo EAS do the same with a nicer UI.

### 3. Native Swift — start over

A full rewrite in SwiftUI. Best possible result, and you'd learn the most, but
you'd be reimplementing an engine that already works and is already tested.

- **Effort:** weeks.
- **Worth it if** the point is learning Swift, not shipping this.

---

## The real prize: widgets and Siri

Once you're native (path 2 or 3), the two things that make this feel like a
product rather than a website:

**Lock-screen / Home-screen widget** — the RIGHT NOW screen, but it's just *there*
when you pick up your phone:

```
RIGHT NOW
Biology ch 4 review · 35m
```

WidgetKit, and it reads the same state. This is the single biggest upgrade
available to this project.

**Siri Shortcuts** — "Hey Siri, add to Locked In" and you talk. No unlocking, no
app, no typing, walking out of class with your hands full. It's the voice feature
you asked for, minus the part where you have to open something.

**Share sheet target** — screenshot the whiteboard → Share → Locked In → it's in
the inbox. Right now you have to open the app and pick the file.

---

## What it costs

- **Free** to build and run on your own iPhone via Xcode with a free Apple ID —
  but the app **expires after 7 days** and you have to reinstall it.
- **$99/year** for the Apple Developer Program: no expiry, TestFlight, and the
  App Store if you ever want to put it out there.
- A cloud macOS build (GitHub Actions) is free for public repos.

---

## What I'd actually do

1. **Now:** use the PWA and the extension. The extension already gives you real
   notifications on the PC, which covers most of the day.
2. **When it starts annoying you that your phone stays quiet:** Capacitor + local
   notifications. One day of work, no server, and you reuse everything.
3. **Then:** add a widget. That's the moment it stops being a website.

Say the word and I'll set up the Capacitor project and the GitHub Actions macOS
build — you won't need a Mac to get an installable app out of it.
