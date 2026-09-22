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

// Guard against the boot watchdog being lost in a future edit.
const built = readFileSync(indexPath, "utf8");
if (!built.includes("__abbyFatal")) {
  console.error("WARNING: the boot watchdog is missing from index.html");
  process.exitCode = 1;
}

console.log(`dist/ built — ${count} files, web root for Capacitor`);
console.log("next:  npx cap sync ios   (needs the npm install to have run)");

/* iOS Safari before 16.4 throws a SyntaxError on a regex lookbehind, and a
   SyntaxError in one ES module silently kills every module importing it.
   That cost a whole debugging round once; it does not get to happen twice. */
const RISKY = [
  [/\(\?<[=!]/, "regex lookbehind (?<= or (?<!) — SyntaxError on iOS < 16.4"],
  [/\bObject\.hasOwn\b/, "Object.hasOwn — iOS 15.4+"],
  [/\bstructuredClone\b/, "structuredClone — iOS 15.4+"],
  [/\bArray\.fromAsync\b/, "Array.fromAsync — very new"]
];
const offenders = [];
(function scan(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (!name.endsWith(".js")) continue;
    const src = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const [re, why] of RISKY) if (re.test(src)) offenders.push(`${p}: ${why}`);
  }
})(DIST);

if (offenders.length) {
  console.error("\nBlocked — syntax iOS may refuse:\n  " + offenders.join("\n  "));
  process.exit(1);
}
console.log("iOS syntax check: clean");
