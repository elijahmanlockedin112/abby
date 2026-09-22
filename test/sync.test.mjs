/* Do a PC and a phone actually end up with the same list — including
   bedtime, which is where the 1-hour discrepancy showed up? */
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const E = await import("../shared/engine.js");
const C = await import("../shared/crypto.js");

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };

/* A stand-in for the Firebase record: one slot both devices read and write. */
let CLOUD = null;

/* The merge rule sync.js uses, isolated so it can be tested without fetch. */
function mergeInto(local, incoming) {
  if (!incoming || !Array.isArray(incoming.tasks)) return local;
  const inc = E.hydrate(incoming);
  if ((inc.updatedAt || 0) <= (local.updatedAt || 0)) return local;
  return inc;
}
function push(state) { CLOUD = E.serialize(state); }
function pull(local) { return mergeInto(local, CLOUD); }

console.log("\nTWO DEVICES, ONE LIST");
const now = new Date(2026, 8, 21, 18, 0);

let pc = E.emptyState();
pc.bedtime = "21:00";
pc.tasks = E.parseList("Biology ch 4 review 35m\nFFA quiz prep 45m", 30, now);
pc.updatedAt = 1000;
push(pc);

let phone = E.emptyState();
phone.updatedAt = 0;
phone = pull(phone);

t("the phone gets the PC's tasks", phone.tasks.length === 2, String(phone.tasks.length));
t("and the PC's bedtime", phone.bedtime === "21:00", phone.bedtime);

console.log("\nBEDTIME CHANGED ON THE PHONE");
phone.bedtime = "20:30";
phone.updatedAt = 2000;
push(phone);
pc = pull(pc);
t("the PC picks it up", pc.bedtime === "20:30", pc.bedtime);
t("without losing the tasks", pc.tasks.length === 2, String(pc.tasks.length));

console.log("\nTHE 1-HOUR BUG: A DEVICE THAT NEVER PULLED");
const stranded = E.emptyState();        // fresh install, default bedtime
stranded.updatedAt = 0;
t("starts on the 9pm default", stranded.bedtime === "21:00", stranded.bedtime);
t("and disagrees with a PC set to 22:00",
  (() => { const other = E.emptyState(); other.bedtime = "22:00";
    return Math.abs(E.bedtimeAt(other, now) - E.bedtimeAt(stranded, now)) === 3600000; })(),
  "should be exactly 1h apart");
const joined = pull(stranded);
t("one pull fixes it", joined.bedtime === "20:30", joined.bedtime);

console.log("\nOLDER WRITE DOESN'T CLOBBER NEWER");
const stale = E.hydrate(E.serialize(joined));
stale.bedtime = "23:00";
stale.updatedAt = 500;                  // older than what's in the cloud
const after = mergeInto(joined, E.serialize(stale));
t("a stale copy is rejected", after.bedtime === "20:30", after.bedtime);

console.log("\nENCRYPTED, IT STILL CONVERGES");
const phrase = C.suggestPassphrase();
const v1 = await C.openVault({ passphrase: phrase });
const sealed = await v1.seal(E.serialize(joined));
t("what's stored is unreadable", !JSON.stringify(sealed).includes("Biology"));
const v2 = await C.openVault({ passphrase: phrase, salt: sealed.salt });
const opened = E.hydrate(await v2.open(sealed));
t("the other device opens it", opened.tasks.length === 2, String(opened.tasks.length));
t("with the same bedtime", opened.bedtime === "20:30", opened.bedtime);

console.log("\nA WRONG PASSPHRASE CAN'T SILENTLY HALF-WORK");
const bad = await C.openVault({ passphrase: "wrong-words-entirely", salt: sealed.salt });
let refused = false;
try { await bad.open(sealed); } catch { refused = true; }
t("it fails outright rather than returning junk", refused);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
