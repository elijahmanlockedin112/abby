/* The stream parser, against the frame shapes Firebase actually sends. */
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };

/* Stand in for the network: hand the stream a scripted body. */
function fakeFetchFactory(chunks, { fail: shouldFail = false } = {}) {
  return async () => {
    if (shouldFail) throw new Error("network down");
    let i = 0;
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (i >= chunks.length) return { done: true, value: undefined };
              return { done: false, value: new TextEncoder().encode(chunks[i++]) };
            }
          };
        }
      }
    };
  };
}

const realFetch = globalThis.fetch;
const S = await import("../shared/sync.js");

console.log("\nPLATFORM CHECK");
t("streaming is possible here", S.cloudStreamSupported());

const cfg = { cloudUrl: "https://x-default-rtdb.firebaseio.com", cloudKey: "k" };

async function collect(chunks, ms = 120) {
  const got = [];
  globalThis.fetch = fakeFetchFactory(chunks);
  const h = S.cloudStream(cfg, { onData: d => got.push(d), onStatus: () => {} });
  await new Promise(r => setTimeout(r, ms));
  h && h.close();
  globalThis.fetch = realFetch;
  return got;
}

console.log("\nA ROOT PUT — the whole record");
const record = { v: 2, tasks: [{ id: "a", title: "Biology" }], reminders: [] };
let got = await collect([
  "event: put\ndata: " + JSON.stringify({ path: "/", data: record }) + "\n\n"
]);
t("one update delivered", got.length === 1, String(got.length));
t("and it's the record itself", got[0] && got[0].tasks && got[0].tasks[0].title === "Biology",
  JSON.stringify(got[0]).slice(0, 60));

console.log("\nSPLIT ACROSS PACKETS");
const frame = "event: put\ndata: " + JSON.stringify({ path: "/", data: record }) + "\n\n";
got = await collect([frame.slice(0, 18), frame.slice(18, 40), frame.slice(40)]);
t("reassembled from three chunks", got.length === 1, String(got.length));
t("intact", got[0] && got[0].tasks.length === 1);

console.log("\nSEVERAL FRAMES IN ONE PACKET");
got = await collect([
  "event: put\ndata: " + JSON.stringify({ path: "/", data: { tasks: [], n: 1 } }) + "\n\n" +
  "event: put\ndata: " + JSON.stringify({ path: "/", data: { tasks: [], n: 2 } }) + "\n\n"
]);
t("both delivered", got.length === 2, String(got.length));
t("in order", got[0].n === 1 && got[1].n === 2);

console.log("\nA PARTIAL CHANGE ASKS FOR A RE-PULL");
got = await collect([
  "event: patch\ndata: " + JSON.stringify({ path: "/tasks/0", data: { title: "changed" } }) + "\n\n"
]);
t("signalled as null, not a bogus record", got.length === 1 && got[0] === null,
  JSON.stringify(got));

console.log("\nNOISE IS IGNORED");
got = await collect([
  "event: keep-alive\ndata: null\n\n",
  "event: auth_revoked\ndata: null\n\n",
  ": a comment line\n\n",
  "event: put\ndata: " + JSON.stringify({ path: "/", data: { tasks: [], ok: true } }) + "\n\n"
]);
t("only the real put came through", got.length === 1 && got[0].ok === true,
  JSON.stringify(got));

console.log("\nMALFORMED DATA DOESN'T KILL THE STREAM");
got = await collect([
  "event: put\ndata: {not json at all\n\n",
  "event: put\ndata: " + JSON.stringify({ path: "/", data: { tasks: [], after: true } }) + "\n\n"
]);
t("bad frame skipped, next one still lands", got.length === 1 && got[0].after === true,
  JSON.stringify(got));

console.log("\nNO CONFIG, NO STREAM");
t("missing key returns null", S.cloudStream({ cloudUrl: "https://x.firebaseio.com" }, { onData(){} }) === null);
t("missing url returns null", S.cloudStream({ cloudKey: "k" }, { onData(){} }) === null);

console.log("\nA DROPPED CONNECTION REPORTS ITSELF");
globalThis.fetch = fakeFetchFactory([], { fail: true });
let sawDrop = false;
const h = S.cloudStream(cfg, { onData(){}, onStatus: st => { if (st.live === false) sawDrop = true; } });
await new Promise(r => setTimeout(r, 120));
h && h.close();
globalThis.fetch = realFetch;
t("status says not live", sawDrop, "a silent dead stream is the worst outcome");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
