/* Does the thing that leaves your device actually leave unreadable? */
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const C = await import("../shared/crypto.js");
const E = await import("../shared/engine.js");

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
};

console.log("\nENCRYPTION");
t("WebCrypto is available", C.cryptoAvailable());

const phrase = C.suggestPassphrase();
t("a passphrase is 6 readable words", phrase.split("-").length === 6, phrase);
t("two passphrases differ", C.suggestPassphrase() !== C.suggestPassphrase());
console.log("       -> " + phrase);

const vault = await C.openVault({ passphrase: phrase });
t("the vault opens", vault.ok);
t("and carries a salt", !!vault.salt);

// Realistic payload: a real evening plus something private.
const now = new Date(2026, 8, 21, 16, 37);
const state = E.emptyState();
state.tasks = E.parseList("Biology ch 4 review 35m\nTherapy appointment Thursday\nFFA quiz prep 45m", 30, now);
state.reminders = [{ id: "r1", text: "Cancel Spotify", at: "2026-11-30", time: null, raw: "", createdAt: 1, firedAt: null, done: false }];

const sealed = await vault.seal(E.serialize(state));
t("the sealed record is recognised as encrypted", C.isEncrypted(sealed));

const wire = JSON.stringify(sealed);
console.log("\nWHAT THE DATABASE ACTUALLY HOLDS");
console.log("       " + wire.slice(0, 96) + "…");

t("'Biology' is NOT in the stored bytes", !wire.includes("Biology"));
t("'Therapy' is NOT in the stored bytes", !wire.includes("Therapy"));
t("'Spotify' is NOT in the stored bytes", !wire.includes("Spotify"));
t("no task title leaks", state.tasks.every(x => !wire.includes(x.title)));
t("the payload is opaque base64", /^[A-Za-z0-9+/=]+$/.test(sealed.ct));

const back = await vault.open(sealed);
t("it comes back intact", back.tasks.length === 3, String(back.tasks.length));
t("titles survive exactly", back.tasks[0].title === state.tasks[0].title, back.tasks[0].title);
t("reminders survive", back.reminders[0].text === "Cancel Spotify");

console.log("\nWRONG PASSPHRASE");
const wrong = await C.openVault({ passphrase: "not-the-right-words-at-all", salt: vault.salt });
let refused = false;
try { await wrong.open(sealed); } catch { refused = true; }
t("a wrong passphrase cannot open it", refused);

console.log("\nSAME WORDS, DIFFERENT SALT");
const other = await C.openVault({ passphrase: phrase, salt: C.randomSalt() });
let saltRefused = false;
try { await other.open(sealed); } catch { saltRefused = true; }
t("a different salt cannot open it either", saltRefused);
t("which is why the salt rides along with the record", sealed.salt === vault.salt);

console.log("\nTWO DEVICES, SAME WORDS + SALT");
const phone = await C.openVault({ passphrase: phrase, salt: sealed.salt });
const onPhone = await phone.open(sealed);
t("the phone reads what the PC wrote", onPhone.tasks[0].title === state.tasks[0].title);

console.log("\nEVERY WRITE IS DIFFERENT");
const a = await vault.seal({ x: 1 });
const b = await vault.seal({ x: 1 });
t("identical data seals to different bytes", a.ct !== b.ct);
t("because the IV is fresh each time", a.iv !== b.iv);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
