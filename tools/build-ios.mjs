/* =====================================================================
   Assemble dist/ for Capacitor.

   Capacitor wants one self-contained web root. The PWA lives in pwa/ and
   imports ../shared/, which would climb out of that root — so this copies
   both in and rewrites the paths. No bundler, no transpile: the same
   source files that run in the browser run in the app.
   ===================================================================== */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

const TEXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg"]);

function copyTree(from, to, rewrite) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) { copyTree(src, dst, rewrite); continue; }
    if (rewrite && TEXT.has(extname(name).toLowerCase())) {
      writeFileSync(dst, rewrite(readFileSync(src, "utf8"), name));
    } else {
      copyFileSync(src, dst);
    }
  }
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// pwa/ becomes the root; ../shared/ becomes ./shared/
copyTree(join(ROOT, "pwa"), DIST, src => src.split("../shared/").join("shared/"));
copyTree(join(ROOT, "shared"), join(DIST, "shared"), src => src);

// The app is Abby, and it is not a browser tab.
const indexPath = join(DIST, "index.html");
let index = readFileSync(indexPath, "utf8");
index = index
  .replace("<title>Locked In</title>", "<title>Abby</title>")
  .replace('content="Locked In"', 'content="Abby"')
  .replace(">Locked In<", ">Abby<");
// A service worker inside a native webview only gets in the way.
index = index.replace(/<link rel="manifest"[^>]*>\s*/g, "");
writeFileSync(indexPath, index);

let app = readFileSync(join(DIST, "app.js"), "utf8");
app = app.replace(/if \("serviceWorker" in navigator\) \{[\s\S]*?\}\s*$/m, "");
writeFileSync(join(DIST, "app.js"), app);

const count = (function walk(d) {
  let n = 0;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    n += statSync(p).isDirectory() ? walk(p) : 1;
  }
  return n;
})(DIST);

console.log(`dist/ built — ${count} files, web root for Capacitor`);
console.log("next:  npx cap sync ios   (needs the npm install to have run)");
