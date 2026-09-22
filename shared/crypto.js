/* =====================================================================
   Abby — end-to-end encryption for anything that leaves your device.

   WHAT THIS ACTUALLY PROTECTS, stated plainly because a vague promise
   about encryption is worse than none:

   Encrypted, unreadable to anyone but you:
     · the record in your Firebase database — the one real exposure,
       since test-mode rules let anyone who learns the path read it
     · anything in transit between your phone and your PC

   NOT encrypted, and no library can change that:
     · what's stored on your own device (it's yours; your OS guards it)
     · anything you send to OpenAI or Anthropic — a screenshot you ask
       them to read is read by them. That's what the key buys.
     · anything you paste into a chat with an assistant

   The passphrase never leaves the device and is never synced. Lose it
   and the cloud copy is genuinely unrecoverable — that's the point.

   AES-256-GCM, key from PBKDF2-SHA256 at 310,000 iterations, random
   salt per vault and random IV per write. All WebCrypto, no library.
   ===================================================================== */

const ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAGIC = "abby1";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function cryptoAvailable() {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";
}

function b64(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** A readable passphrase is one you'll actually keep. Six words is plenty. */
const WORDS = ("amber anchor apple arrow autumn bacon badge bamboo banjo barley beacon birch bishop " +
  "bison blossom bramble bronze bucket cactus candle canyon cedar cellar cherry chisel cinder clover " +
  "cobalt comet copper coral cotton cricket crimson crystal cypress dahlia daisy denim domino drift " +
  "ember fable falcon fennel fern fiddle flint forest fossil galley garnet ginger granite gravel " +
  "harbor harvest hazel heron hickory hollow indigo ivory jasper juniper kernel lantern lattice ledger " +
  "lichen lilac linen lumber maple marble marsh meadow mesa mica mint moss nectar nickel nutmeg " +
  "oaken ochre olive onyx opal orchard osprey otter paddle pebble pewter pine pivot plume poplar " +
  "prairie quarry quartz quill radish raven reef ridge rowan rust saffron sage salt sandal sequoia " +
  "shale silo slate sorrel spruce stone summit sumac tamarind teal thistle thorn timber topaz " +
  "trellis tundra umber valley velvet vessel walnut willow window winter yarrow yonder zenith").split(/\s+/);

export function suggestPassphrase(words = 6) {
  const pick = new Uint32Array(words);
  crypto.getRandomValues(pick);
  return Array.from(pick, n => WORDS[n % WORDS.length]).join("-");
}

export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * @returns {{v:string, salt:string, iv:string, ct:string}} safe to store anywhere
 */
export async function encryptJSON(value, key, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value))
  );
  return { v: MAGIC, salt: saltB64, iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(blob, key) {
  if (!isEncrypted(blob)) throw new Error("not an encrypted record");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(blob.iv) },
    key,
    unb64(blob.ct)
  );
  return JSON.parse(dec.decode(plain));
}

export function isEncrypted(blob) {
  return !!blob && typeof blob === "object" && blob.v === MAGIC &&
    typeof blob.salt === "string" && typeof blob.iv === "string" && typeof blob.ct === "string";
}

/**
 * A vault ties a passphrase to a salt. Both devices need the same pair,
 * which is why setup shows you the salt alongside the passphrase.
 */
export async function openVault({ passphrase, salt }) {
  if (!cryptoAvailable()) return { ok: false, reason: "unavailable" };
  if (!passphrase) return { ok: false, reason: "nopass" };
  const s = salt || randomSalt();
  try {
    const key = await deriveKey(passphrase, s);
    return {
      ok: true,
      salt: s,
      seal: value => encryptJSON(value, key, s),
      open: blob => decryptJSON(blob, key)
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export function vaultReasonText(reason) {
  switch (reason) {
    case "unavailable": return "This browser can't do WebCrypto, so encryption is off. Sync would be plaintext — leave it off, or use a current browser.";
    case "nopass": return "No passphrase set. Sync is plaintext until you set one.";
    case "failed": return "Couldn't build a key from that passphrase.";
    case "wrongpass": return "That passphrase doesn't open the record in the cloud. Check it matches the other device exactly, including the dashes.";
    default: return "Encryption isn't set up.";
  }
}
