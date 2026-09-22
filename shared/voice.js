/* =====================================================================
   Locked In — voice.

   You say: "biology chapter four review thirty five minutes then FFA
   quiz prep forty five minutes and finish the github project an hour"

   You get four editable lines, with the durations already in the shape
   the parser wants. You read them, fix anything wrong, and send.

   The split is deterministic. A model, if you've set a key, gets one
   shot at doing it better — and every line it returns must quote the
   transcript verbatim or it's thrown out, same gate as the inbox.
   ===================================================================== */

import { verifyCandidates } from "./inbox.js";

/* ------------------------------------------------- spoken → numeric
   Only inside a duration phrase. Converting every "one" and "two" in
   free speech does more damage than it fixes. */

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const ONES_RE = Object.keys(ONES).join("|");
const TENS_RE = Object.keys(TENS).join("|");
const UNIT_MIN = "minutes?|mins?|minute";
const UNIT_HR = "hours?|hrs?|hour";

function wordsToNumber(s) {
  const t = s.trim().toLowerCase().replace(/-/g, " ");
  const pair = t.match(new RegExp(`^(${TENS_RE})\\s+(${ONES_RE})$`));
  if (pair) return TENS[pair[1]] + ONES[pair[2]];
  if (TENS[t] != null) return TENS[t];
  if (ONES[t] != null) return ONES[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/** "thirty five minutes" -> "35m", "an hour and a half" -> "90m" */
export function normalizeDurations(text) {
  let s = " " + text + " ";
  const NUM = `(?:\\d+|(?:${TENS_RE})(?:[\\s-](?:${ONES_RE}))?|(?:${ONES_RE}))`;

  s = s.replace(new RegExp(`\\b(?:an?|one)\\s+hour\\s+and\\s+a\\s+half\\b`, "gi"), " 90m ");
  s = s.replace(new RegExp(`\\bhalf\\s+an?\\s+hour\\b`, "gi"), " 30m ");
  s = s.replace(new RegExp(`\\ban?\\s+(?:${UNIT_HR})\\b`, "gi"), " 1h ");

  s = s.replace(new RegExp(`\\b(${NUM})\\s+and\\s+a\\s+half\\s+(?:${UNIT_HR})\\b`, "gi"),
    (_, n) => { const v = wordsToNumber(n); return v ? ` ${v * 60 + 30}m ` : _; });

  s = s.replace(new RegExp(`\\b(${NUM})\\s*(?:${UNIT_HR})\\b`, "gi"),
    (_, n) => { const v = wordsToNumber(n); return v ? ` ${v}h ` : _; });

  s = s.replace(new RegExp(`\\b(${NUM})\\s*(?:${UNIT_MIN})\\b`, "gi"),
    (_, n) => { const v = wordsToNumber(n); return v ? ` ${v}m ` : _; });

  return s.replace(/\s{2,}/g, " ").trim();
}

/* ---------------------------------------------------------- splitting */

const BREAKS = /\b(?:and then|then|next up|next|after that|after which|also|plus|and also|number \w+)\b/gi;
const FILLER_WORD = "um+|uh+|er+|ah+|ok(?:ay)?|so|alright|right|yeah|yep|like|and|then|also|plus|next|well|hmm+";
const FILLER = new RegExp(`^(?:${FILLER_WORD})$`, "i");
// Speech recognisers put the throat-clearing at the FRONT of a phrase, so a
// line has to be stripped word by word, not just discarded when it's all filler.
const LEADING_FILLER = new RegExp(`^(?:(?:${FILLER_WORD})[\\s,]+)+`, "i");
const PREPOSITIONS = /^(?:on|of|for|to|with|about|from|in|at|into|doing|working|studying|reviewing)\b/i;

/**
 * Turn one run-on transcript into separate task lines.
 * @returns {string[]}
 */
export function splitDictation(raw) {
  let s = normalizeDurations(String(raw || ""));
  if (!s.trim()) return [];

  // Whatever punctuation the recogniser produced is a break.
  s = s.replace(/\s*[.;!?]+\s*/g, "\n");
  s = s.replace(/\bcomma\b/gi, "\n");
  s = s.replace(/\s*,\s*/g, "\n");
  s = s.replace(BREAKS, "\n");

  // A duration usually ends an item — unless what follows is clearly still
  // part of it ("thirty minutes of biology").
  s = s.replace(/(\b\d+\s*[mh])\s+(?!$)(\w+)/g, (m, dur, next) =>
    PREPOSITIONS.test(next) ? m : `${dur}\n${next}`);

  const out = [];
  const seen = new Set();
  for (let line of s.split("\n")) {
    line = line.replace(/\s{2,}/g, " ").trim();
    line = line.replace(LEADING_FILLER, "").trim();
    if (!line || FILLER.test(line)) continue;
    if (line.replace(/[^a-z0-9]/gi, "").length < 3) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.charAt(0).toUpperCase() + line.slice(1));
  }
  return out;
}

/* ------------------------------------------------------- model assist */

const SPLIT_PROMPT = `Below is a raw voice transcript of a high school student reading out their to-do list for tonight. It has no punctuation and may contain filler words.

Split it into the separate tasks they actually said.

HARD RULES:
- "quote" must be copied CHARACTER FOR CHARACTER from the transcript. It is checked; a line whose quote is not found verbatim is thrown away.
- Do NOT add a task they did not say. Do NOT merge two tasks into one. Do NOT invent durations or deadlines.
- "line" is the cleaned-up version of that quote: drop filler words, fix obvious mis-hearings, and write any duration as "35m" or "1h". Keep their own words otherwise.
- If they said a day ("before Thursday", "due Friday"), keep it in the line.

Reply with only a JSON array of {"line": string, "quote": string}.
Example: [{"line":"Biology ch 4 review 35m","quote":"biology chapter four review thirty five minutes"}]

TRANSCRIPT:
`;

/**
 * Rules first; the model only replaces them if it returns a clean,
 * fully-verified set. Anything less and you keep the rules output.
 * @returns {Promise<{lines:string[], by:"rules"|"model", dropped:number, error:string|null}>}
 */
export async function dictationToLines(transcript, ai) {
  const rules = splitDictation(transcript);
  if (!ai || !ai.hasKey() || !String(transcript || "").trim()) {
    return { lines: rules, by: "rules", dropped: 0, error: null };
  }

  try {
    const reply = await ai.askJSON(SPLIT_PROMPT + String(transcript).slice(0, 6000), { maxTokens: 1200 });
    if (!Array.isArray(reply) || !reply.length) return { lines: rules, by: "rules", dropped: 0, error: null };

    const proposed = reply.slice(0, 30)
      .map(r => ({ title: String(r.line || "").trim(), quote: String(r.quote || "") }))
      .filter(r => r.title);

    const { kept, dropped } = verifyCandidates(proposed, transcript);
    if (!kept.length) {
      return { lines: rules, by: "rules", dropped: dropped.length, error: null };
    }
    return { lines: kept.map(k => k.title), by: "model", dropped: dropped.length, error: null };
  } catch (e) {
    return { lines: rules, by: "rules", dropped: 0, error: (e && e.message) || "The model call failed." };
  }
}

/* ----------------------------------------------------- the recogniser */

export function speechSupported() {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Thin wrapper over the browser's own recogniser. No audio leaves the
 * device for the transcription itself.
 *
 * @param {{onText:(t:string)=>void, onEnd:(t:string)=>void, onError:(m:string)=>void}} cb
 */
export function startDictation(cb) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { cb.onError("This browser has no built-in dictation."); return null; }

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";

  let final = "";
  let stopped = false;

  rec.onresult = ev => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    cb.onText((final + interim).trim());
  };

  rec.onerror = ev => {
    const m = ev.error === "not-allowed" || ev.error === "service-not-allowed"
      ? "Microphone blocked. Allow it for this page, then try again."
      : ev.error === "no-speech" ? "Didn't hear anything."
      : ev.error === "network" ? "Dictation needs a connection."
      : "Dictation stopped: " + ev.error;
    cb.onError(m);
  };

  // Chrome ends the session on a long pause; restart until told to stop.
  rec.onend = () => {
    if (stopped) { cb.onEnd(final.trim()); return; }
    try { rec.start(); } catch { cb.onEnd(final.trim()); }
  };

  try { rec.start(); } catch (e) { cb.onError("Couldn't start the microphone."); return null; }

  return {
    stop() { stopped = true; try { rec.stop(); } catch {} },
    get transcript() { return final.trim(); }
  };
}
