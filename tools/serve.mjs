/* Dev-only static server. ES modules can't load over file://, so use this
   to look at the pages outside Chrome:  node tools/serve.mjs  */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

// fileURLToPath, not .pathname — a space in the path stays %20 otherwise.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = process.env.PORT || 8931;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function lanAddresses() {
  const out = [];
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found: " + p);
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(e));
  }
}).listen(PORT, "0.0.0.0", () => {
  const lan = lanAddresses();
  console.log("");
  console.log("  Locked In is running.");
  console.log("");
  console.log("  On this PC:");
  console.log(`    Setup        http://localhost:${PORT}/extension/setup.html`);
  console.log(`    Right now    http://localhost:${PORT}/extension/now.html`);
  console.log(`    Full brief   http://localhost:${PORT}/extension/newtab.html`);
  console.log("");
  if (lan.length) {
    console.log("  On your phone (same Wi-Fi):");
    for (const ip of lan) console.log(`    http://${ip}:${PORT}/pwa/`);
    console.log("");
    console.log("  Note: over plain http the phone app works but can't cache for offline");
    console.log("  use, and Add to Home Screen is limited. Host it on GitHub Pages for");
    console.log("  the full install — see the README.");
  } else {
    console.log("  No LAN address found, so the phone can't reach this PC right now.");
  }
  console.log("");
  console.log("  Ctrl+C to stop.");
  console.log("");
});
