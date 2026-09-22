/* =====================================================================
   Abby — offline shell.

   NETWORK FIRST for our own files, cache only as the fallback.

   The previous version was cache-first with a fixed cache name, which
   meant that once it had a copy it served that copy forever — you could
   install an update and still be looking at last week's app, with no way
   to tell. Offline support is worth a lot less than "the app you just
   installed is the app you're running".
   ===================================================================== */

const VERSION = "abby-2026-09-21c";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "../shared/ui.css",
  "../shared/engine.js",
  "../shared/sync.js",
  "../shared/ics.js",
  "../shared/inbox.js",
  "../shared/goals.js",
  "../shared/ai.js",
  "../shared/sources.js",
  "../shared/ask.js",
  "../shared/ui.js",
  "../shared/voice.js",
  "../shared/reminders.js",
  "../shared/contextmap.js",
  "../shared/graph.js",
  "../shared/crypto.js",
  "../shared/abby.js",
  "../shared/native.js",
  "../shared/triage.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())          // take over at once
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch the things that must be live.
  if (/firebaseio\.com|firebasedatabase\.app|api\.openai\.com|api\.anthropic\.com|api\.github\.com|calendar\.google\.com/
      .test(url.hostname)) return;

  const sameOrigin = url.origin === location.origin;

  e.respondWith((async () => {
    if (sameOrigin) {
      // Fresh if we can get it, cached if we can't. Never stale-by-default.
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw new Error("offline and not cached: " + url.pathname);
      }
    }

    // Third-party (fonts): cache-first is fine, they're versioned by URL.
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      if (url.hostname.includes("fonts.")) {
        return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
      }
      throw new Error("offline: " + url.hostname);
    }
  })());
});

// Let the page force an update if it ever needs to.
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
