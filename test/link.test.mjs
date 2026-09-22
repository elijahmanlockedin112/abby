/* The link code is the only thing that can join three separate stores. */
const L = await import("../shared/linkcode.js");

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };

const real = {
  cloudUrl: "https://default-gemini-project-default-rtdb.firebaseio.com",
  cloudKey: "9k2m4x7p1q8w3e6r5t0y",
  salt: "pMWdJCXHIEiZIBv11Ca+zw==",
  passphrase: "hazel-bacon-thistle-yarrow-sorrel-walnut"
};

console.log("\nROUND TRIP");
const code = L.encodeLink(real);
t("a code is produced", !!code, String(code));
t("it is recognisable", code.startsWith("abby-"));
t("it survives a paste (no whitespace-sensitive chars)", !/[+/=\s]/.test(code.slice(5)), code.slice(0, 40));
console.log("       " + code.slice(0, 72) + "…  (" + code.length + " chars)");

const back = L.decodeLink(code);
t("it decodes", back.ok);
t("database url intact", back.config.cloudUrl === real.cloudUrl);
t("key intact", back.config.cloudKey === real.cloudKey);
t("salt intact", back.config.salt === real.salt);
t("passphrase intact", back.config.passphrase === real.passphrase,
  "without this the other device connects but can't decrypt");

console.log("\nSURVIVES REAL-WORLD PASTING");
t("leading/trailing space", L.decodeLink("  " + code + "  ").ok);
t("a line break in the middle",
  L.decodeLink(code.slice(0, 20) + "\n" + code.slice(20)).ok,
  "messaging apps wrap long strings");

console.log("\nREFUSES JUNK, AND SAYS WHY");
for (const [input, reason] of [
  ["", "empty"],
  ["hello there", "notacode"],
  ["abby-!!!!not-base64!!!!", "garbled"],
  [L.encodeLink({ cloudUrl: "ftp://nope", cloudKey: "x" }) || "abby-x", "notacode"]
]) {
  const r = L.decodeLink(input);
  t(`"${String(input).slice(0, 22)}" -> refused`, !r.ok, "was accepted");
  if (!r.ok) t(`  ...with a real message`, L.linkReasonText(r.reason).length > 20, L.linkReasonText(r.reason));
}

console.log("\nNOTHING TO SHARE YET");
t("no url/key -> no code", L.encodeLink({ cloudUrl: "", cloudKey: "" }) === null);
t("and it says so", L.describeLink({}).includes("set up sync first"), L.describeLink({}));

console.log("\nWORKS WITHOUT ENCRYPTION SET UP");
const plain = L.encodeLink({ cloudUrl: real.cloudUrl, cloudKey: real.cloudKey });
const plainBack = L.decodeLink(plain);
t("sync-only code decodes", plainBack.ok);
t("and carries no passphrase", !plainBack.config.passphrase);
t("description warns it's a secret", L.describeLink(real).includes("password"), L.describeLink(real));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
