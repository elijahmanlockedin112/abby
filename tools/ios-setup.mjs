/* =====================================================================
   Post-`cap add ios` touches that Capacitor doesn't do for you:
   the usage strings iOS demands, portrait-only, and the app icon set.
   Safe to run repeatedly.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLIST = join(ROOT, "ios/App/App/Info.plist");

if (!existsSync(PLIST)) {
  console.error("No iOS project yet. Run:  npx cap add ios");
  process.exit(1);
}

let p = readFileSync(PLIST, "utf8");

const entries = [
  ["NSMicrophoneUsageDescription",
    "Abby uses the microphone so you can say tonight's list instead of typing it."],
  ["NSSpeechRecognitionUsageDescription",
    "Abby turns what you say into a list of tasks, on this device."],
  ["NSCameraUsageDescription",
    "Abby reads a photo of the board or an assignment sheet so you don't have to retype it."],
  ["NSPhotoLibraryUsageDescription",
    "Abby reads screenshots you pick so you don't have to retype them."],
  ["ITSAppUsesNonExemptEncryption", null] // handled below as a <false/>
];

for (const [key, value] of entries) {
  if (p.includes(`<key>${key}</key>`)) continue;
  const block = value === null
    ? `\t<key>${key}</key>\n\t<false/>\n`
    : `\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  p = p.replace("</dict>\n</plist>", block + "</dict>\n</plist>");
}

// Portrait only — this is a phone app you glance at, not a canvas.
p = p.replace(
  /<key>UISupportedInterfaceOrientations<\/key>\s*<array>[\s\S]*?<\/array>/,
  "<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>"
);

writeFileSync(PLIST, p);
console.log("Info.plist: usage strings + portrait-only");

/* ---- app icon set ---- */
const ICONSET = join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
mkdirSync(ICONSET, { recursive: true });

const src = join(ROOT, "ios/icon-1024.png");
if (existsSync(src)) {
  writeFileSync(join(ICONSET, "AppIcon-512@2x.png"), readFileSync(src));
  writeFileSync(join(ICONSET, "Contents.json"), JSON.stringify({
    images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
    info: { author: "xcode", version: 1 }
  }, null, 2));
  console.log("AppIcon.appiconset: 1024 icon installed");
} else {
  console.log("AppIcon: ios/icon-1024.png missing — run tools/make-icons first");
}
