/* =====================================================================
   Abby — the link code.

   Three surfaces, three separate settings stores, and no way for any of
   them to read another's:

     Start Abby.cmd -> localhost   localStorage on that origin
     Chrome extension              chrome.storage.local
     Phone (Pages or iOS)          localStorage on that origin

   Configuring Firebase in one of them left the other two blind, which is
   exactly how the phone ended up with three items and the extension with
   nothing. Nothing clever fixes that — the browser will not let one
   origin read another's storage, and it shouldn't.

   So: one string you copy from a configured device and paste into the
   others. It carries the database URL, the shared key, the encryption
   salt and the passphrase, because a link that gets you a connection but
   not the ability to decrypt is worse than no link at all.

   TREAT IT LIKE A PASSWORD. Anyone holding it can read your list.
   ===================================================================== */

const PREFIX = "abby-";
const VERSION = 1;

/* base64url so it survives a paste through anything. */
function toB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * @param {{cloudUrl:string, cloudKey:string, salt?:string, passphrase?:string}} cfg
 * @returns {string|null} null when there's nothing worth sharing
 */
export function encodeLink(cfg) {
  const c = cfg || {};
  if (!c.cloudUrl || !c.cloudKey) return null;

  // Short field names: the whole thing has to be pasteable on a phone.
  const payload = { v: VERSION, u: c.cloudUrl.trim(), k: c.cloudKey.trim() };
  if (c.salt) payload.s = c.salt;
  if (c.passphrase) payload.p = c.passphrase;

  return PREFIX + toB64url(JSON.stringify(payload));
}

/**
 * @returns {{ok:true, config:object} | {ok:false, reason:string}}
 */
export function decodeLink(code) {
  const raw = String(code || "").trim().replace(/\s+/g, "");
  if (!raw) return { ok: false, reason: "empty" };
  if (!raw.startsWith(PREFIX)) return { ok: false, reason: "notacode" };

  let obj;
  try {
    obj = JSON.parse(fromB64url(raw.slice(PREFIX.length)));
  } catch {
    return { ok: false, reason: "garbled" };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "garbled" };
  if (obj.v !== VERSION) return { ok: false, reason: "version" };
  if (!obj.u || !obj.k) return { ok: false, reason: "incomplete" };
  if (!/^https?:\/\//i.test(obj.u)) return { ok: false, reason: "badurl" };

  const config = { cloudUrl: String(obj.u), cloudKey: String(obj.k) };
  if (obj.s) config.salt = String(obj.s);
  if (obj.p) config.passphrase = String(obj.p);
  return { ok: true, config };
}

export function linkReasonText(reason) {
  switch (reason) {
    case "empty": return "Paste the code from your other device first.";
    case "notacode": return "That doesn't look like a link code — they start with “abby-”.";
    case "garbled": return "That code is damaged. Copy it again, whole, without spaces.";
    case "version": return "That code is from a different version of Abby.";
    case "incomplete": return "That code is missing the database details.";
    case "badurl": return "The database address in that code doesn't look right.";
    default: return "Couldn't read that code.";
  }
}

/** What the code will carry, so it can be said out loud before copying. */
export function describeLink(cfg) {
  const c = cfg || {};
  const bits = [];
  if (c.cloudUrl && c.cloudKey) bits.push("database + key");
  if (c.passphrase) bits.push("encryption passphrase");
  if (!bits.length) return "Nothing to share yet — set up sync first.";
  return "Carries your " + bits.join(" and ") + ". Treat it like a password.";
}
