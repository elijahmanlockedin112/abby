/* =====================================================================
   Locked In — the Life Context Engine.

   You throw material in. It comes out as CANDIDATES, never as tasks.
   Every candidate carries the exact line it came from, and a candidate
   only becomes a task when you accept it. That is the whole reason this
   file can exist alongside the "invented: 0" ledger.

   The deterministic extractor always runs. The model, if you've given it
   a key, runs as well and has exactly one extra privilege: proposing a
   candidate whose quote is verbatim in the source. A candidate whose
   quote isn't found is dropped before you ever see it.
   ===================================================================== */

import { uid, todayKey, parseEst, parseDue, stripBullet } from "./engine.js";

export const KINDS = {
  note:   { label: "Note",        icon: "✎" },
  image:  { label: "Screenshot",  icon: "▣" },
  pdf:    { label: "PDF",         icon: "⌸" },
  voice:  { label: "Voice memo",  icon: "◉" },
  github: { label: "GitHub",      icon: "⌥" },
  page:   { label: "Web page",    icon: "⌘" },
  file:   { label: "File",        icon: "◫" }
};

export function makeCapture({ kind = "note", source = "", text = "", preview = "" }) {
  const body = String(text || "");
  return {
    id: uid(),
    kind: KINDS[kind] ? kind : "note",
    source: source || KINDS[kind]?.label || "Note",
    at: Date.now(),
    text: body,
    preview: preview || body.replace(/\s+/g, " ").trim().slice(0, 240),
    status: "new",
    candidates: []
  };
}

/* ------------------------------------------------- deterministic pass
   Conservative by design. It would rather miss a task than invent one,
   because everything it proposes you have to read anyway. */

const ACTION_WORDS = /\b(read|write|study|review|finish|complete|submit|turn in|hand in|prepare|prep|practice|memorize|draft|revise|outline|solve|answer|watch|build|fix|email|bring|print|sign|pay|order|pack)\b/i;
const SCHOOL_WORDS = /\b(chapter|ch\.?\s*\d|pp?\.\s*\d|pages?\s*\d|problems?\s*\d|section \d|unit \d|worksheet|packet|lab|essay|quiz|test|exam|assignment|homework|hw|due|project|presentation|study guide)\b/i;
const NOISE = /^(?:https?:\/\/|www\.)|^\W*$|^(?:page \d+|\d+\s*\/\s*\d+)$/i;

function looksLikeTask(line) {
  const s = line.trim();
  if (s.length < 4 || s.length > 180) return false;
  if (NOISE.test(s)) return false;
  const bulleted = /^\s*(?:[-*•–—]\s+|\[\s*[xX ]?\s*\]\s*|\d+[.)]\s+)/.test(line);
  return bulleted || ACTION_WORDS.test(s) || SCHOOL_WORDS.test(s);
}

/**
 * Split pasted material into candidate lines.
 *
 * Deliberately written without a regex lookbehind: `(?<=…)` is a SyntaxError
 * on iOS Safari before 16.4, and a SyntaxError in one ES module takes down
 * every module that imports it — which here is the entire app, silently.
 */
function splitChunks(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    let rest = line;
    let m;
    // Two or more spaces after a . or ; is a soft line break in pasted text.
    while ((m = rest.match(/([.;])[ \t]{2,}/))) {
      out.push(rest.slice(0, m.index + 1));
      rest = rest.slice(m.index + m[0].length);
    }
    out.push(rest);
  }
  return out;
}

export function extractDeterministic(capture, now = new Date()) {
  const out = [];
  const seen = new Set();
  for (const raw of splitChunks(capture.text)) {
    if (!looksLikeTask(raw)) continue;
    const title = stripBullet(raw);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const due = parseDue(title, now);
    out.push({
      id: uid(),
      title,
      est: parseEst(title),
      due: due ? todayKey(due.due) : null,
      dueKind: due ? due.kind : null,
      quote: raw.trim(),
      by: "rules",
      accepted: false
    });
    if (out.length >= 15) break;
  }
  return out;
}

/* ------------------------------------------------------------- the check
   The only gate that matters: a candidate must quote the source verbatim.
   Normalized for whitespace and curly quotes, nothing else. */

function normalize(s) {
  return String(s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function verifyCandidates(candidates, sourceText) {
  const hay = normalize(sourceText);
  const kept = [], dropped = [];
  for (const c of candidates || []) {
    const q = normalize(c.quote);
    if (q.length >= 4 && hay.includes(q)) kept.push(c);
    else dropped.push(c);
  }
  return { kept, dropped };
}

/* ---------------------------------------------------------- model pass */

const EXTRACT_PROMPT = `You are reading raw material a high school student threw into an inbox: a screenshot's text, a PDF, a note, or a voice memo transcript. Today is {TODAY}.

Find the things that are ACTIONABLE WORK FOR THIS STUDENT. Ignore everything else — headings, navigation, teacher names, page numbers, boilerplate, anything already done.

HARD RULES:
- "quote" must be copied CHARACTER FOR CHARACTER from the source below. It is checked. A candidate whose quote is not found verbatim in the source is thrown away.
- Do not combine two lines into one item. Do not invent an item that is only implied.
- "title" is a short readable version of that quote. Do not add information that is not in the quote.
- "minutes": an integer 5-180, your estimate, or null.
- "due": "YYYY-MM-DD" only if the source states a day or date for it. Otherwise null. Never guess.
- If nothing in the source is actionable, return [].

Reply with only a JSON array of {"title": string, "quote": string, "minutes": number|null, "due": string|null}.

SOURCE:
`;

/**
 * @param {object} capture
 * @param {{ask:function}} ai   the optional model client
 * @returns {Promise<{candidates:array, dropped:number, error:string|null}>}
 */
export async function extractWithModel(capture, ai, now = new Date()) {
  const text = String(capture.text || "").slice(0, 12000);
  if (!text.trim()) return { candidates: [], dropped: 0, error: null };

  try {
    const reply = await ai.askJSON(
      EXTRACT_PROMPT.replace("{TODAY}", todayKey(now)) + text,
      { maxTokens: 1500 }
    );
    if (!Array.isArray(reply)) return { candidates: [], dropped: 0, error: "The reply wasn't a list." };

    const proposed = reply.slice(0, 20).map(r => {
      const due = typeof r.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null;
      const mins = Number(r.minutes);
      return {
        id: uid(),
        title: String(r.title || "").slice(0, 180).trim(),
        est: mins >= 5 && mins <= 180 ? Math.round(mins) : null,
        due,
        dueKind: due ? "Due" : null,
        quote: String(r.quote || "").slice(0, 300),
        by: "model",
        accepted: false
      };
    }).filter(c => c.title);

    const { kept, dropped } = verifyCandidates(proposed, text);
    return { candidates: kept, dropped: dropped.length, error: null };
  } catch (e) {
    return { candidates: [], dropped: 0, error: (e && e.message) || "The model call failed." };
  }
}

/** Rules first, model second, deduplicated by quote. Rules always win. */
export function mergeCandidates(ruleCands, modelCands) {
  const out = [...ruleCands];
  const have = new Set(ruleCands.map(c => normalize(c.quote)));
  for (const c of modelCands) {
    const k = normalize(c.quote);
    if (have.has(k)) continue;
    have.add(k);
    out.push(c);
  }
  return out;
}

/* ------------------------------------------------------- image + pdf text
   Both paths end in plain text, which is what the extractor eats. */

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Screenshots go to the model's vision input; there is no local OCR. */
export async function readImage(blob, ai) {
  if (!ai || !ai.hasKey()) {
    return { ok: false, reason: "nokey", text: "" };
  }
  if (blob.size > 4.5 * 1024 * 1024) return { ok: false, reason: "toobig", text: "" };
  try {
    const b64 = await blobToBase64(blob);
    const text = await ai.askVision(
      "Transcribe every piece of text visible in this image, in reading order. " +
      "Keep list structure and line breaks. Do not summarize, do not add commentary, " +
      "do not describe the image.\n\n" +
      "IMPORTANT — this is often a handwritten list where finished items are " +
      "marked off. Prefix a line with [DONE] if it is struck through, scribbled " +
      "over, crossed out, highlighted out, has a tick or check beside it, has a " +
      "filled or ticked checkbox, or is otherwise visibly marked as finished. " +
      "Still transcribe the words; just prefix the line. When you are unsure " +
      "whether a mark means finished, prefix it — a missed item is easy to add " +
      "back, a re-added finished one is annoying.\n\n" +
      "If there is no text, reply with exactly: (no text)",
      { data: b64, mediaType: blob.type || "image/png" },
      { maxTokens: 2000 }
    );
    const clean = String(text || "").trim();
    return { ok: true, text: clean === "(no text)" ? "" : clean };
  } catch (e) {
    return { ok: false, reason: "failed", text: "", error: (e && e.message) || "" };
  }
}

/** Minimal PDF text scrape: pulls the text-showing operators out of
 *  uncompressed streams. Works on exported/text PDFs, not scans —
 *  a scan has no text layer, so send it in as an image instead. */
export async function readPDF(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

  if (/\/Filter\s*\/(FlateDecode|DCTDecode)/.test(raw) && !/\bBT\b/.test(raw)) {
    return { ok: false, reason: "compressed", text: "" };
  }

  const chunks = [];
  // ( ... ) Tj   and   [ (..) -250 (..) ] TJ
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const s = m[0].slice(1, -1)
      .replace(/\\([nrt])/g, (_, c) => (c === "n" || c === "r" ? "\n" : "\t"))
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    if (s.trim()) chunks.push(s);
  }
  const text = chunks.join(" ").replace(/\s*\n\s*/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length < 20) return { ok: false, reason: "notext", text: "" };
  return { ok: true, text: text.slice(0, 20000) };
}

export function pdfReasonText(reason) {
  switch (reason) {
    case "compressed": return "That PDF's text is compressed, which this can't unpack. Open it, select all, copy, and paste it in as a note — or screenshot it.";
    case "notext": return "No text layer in that PDF — it's probably a scan. Add it as a screenshot instead so the model can read it.";
    default: return "Couldn't read that PDF.";
  }
}
