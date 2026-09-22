/* Locked In — offline shell.
   Cache-first for the app's own files so it opens on the bus with no
   signal; network-first for everything else so a stale build never
   sticks around. Sync and calendar calls are never cached. */

const CACHE = "lockedin-v1";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "../shared/ui.css",
  "../shared/engine.js",
  "../shared/sync.js",
  "../shared/ics.js",
  "../shared/ui.js",
  "../shared/inbox.js",
  "../shared/goals.js",
  "../shared/ai.js",
  "../shared/sources.js",
  "../shared/ask.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // One bad URL must not fail the whole install.
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache the things that must be live.
  if (/firebaseio\.com|firebasedatabase\.app|api\.anthropic\.com|api\.github\.com|calendar\.google\.com/.test(url.hostname)) return;

  const sameOrigin = url.origin === location.origin;

  e.respondWith((async () => {
    if (sameOrigin) {
      const hit = await caches.match(req);
      if (hit) {
        // Serve instantly, refresh quietly for next time.
        fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
    }
    try {
      const res = await fetch(req);
      if (sameOrigin && res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      // Fonts are decoration; let the fallback stacks do their job.
      if (url.hostname.includes("fonts.")) return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
      throw err;
    }
  })());
});
