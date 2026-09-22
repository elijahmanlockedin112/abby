/* =====================================================================
   Abby — one photo in, a sorted checklist out.

   You snap your paper list. This decides, per line, whether it's work to
   do tonight or a thing that has to surface on a day, and files it.

   It does NOT ask you to approve each one. You see the whole checklist
   and can delete anything with one tap — the list is the review. What it
   still won't do is invent: every item has to quote a line that's
   actually in what it read, or it's dropped before you see it.
   ===================================================================== */

import { uid, todayKey, parseEst, parseDue, stripBullet, escapeHtml } from "./engine.js";
import { verifyCandidates, extractDeterministic } from "./inbox.js";
import { makeReminder, parseReminder, looksLikeReminder } from "./reminders.js";

const PROMPT = `You are reading a photo of a student's handwritten or printed to-do list. Today is {TODAY}.

Sort what you find into two buckets:

TASKS — work they sit down and do: homework, studying, practice, a project.
REMINDERS — a thing that has to happen on a specific day and takes no real work: an appointment, a form to hand in, cancelling a subscription, bringing something.

HARD RULES:
- "quote" must be copied CHARACTER FOR CHARACTER from the text below. It is checked; anything whose quote is not found verbatim is thrown away.
- Only list something that is actually written there. Never invent, never infer an extra step.
- Do not split one line into two items, and do not merge two lines into one.
- "minutes": your estimate of focused work, integer 5-180, or null.
- "due"/"date": "YYYY-MM-DD" only if the line names a day or date. Otherwise null. Never guess a date.
- Skip headings, dates written as titles, and page numbers.
- SKIP ANYTHING ALREADY DONE. On a paper list that means: a line prefixed [DONE], struck through, scribbled over, crossed out, highlighted out, ticked, checked, or marked in any way that reads as finished. Leave it out entirely — do not list it as a task or a reminder. If you're unsure whether a mark means finished, leave it out.

Reply with only JSON:
{"tasks":[{"title":string,"minutes":number|null,"due":string|null,"quote":string}],
 "reminders":[{"text":string,"date":string|null,"quote":string}]}

TEXT:
`;

/**
 * Is this line already done?
 *
 * On paper you cross things off, so a crossed-off line must never come
 * back as a task. The vision pass prefixes those with [DONE]; this also
 * catches the typed equivalents. Deliberately generous — re-adding
 * something you already finished is worse than missing it, because you
 * can always add it back.
 */
export function isCrossedOff(line) {
  const s = String(line || "");
  if (/^\s*\[done\]/i.test(s)) return true;                 // from the vision pass
  if (/^\s*~~[\s\S]+~~\s*$/.test(s)) return true;           // ~~strikethrough~~
  if (/^\s*\[\s*[xX✓✔]\s*\]/.test(s)) return true;          // [x] checkbox
  if (/^\s*[✓✔✗✘☑☒×]\s+/.test(s)) return true;              // leading tick or cross
  if (/^\s*[xX]\s+\S/.test(s) && !/^\s*x-?ray/i.test(s)) return true;
  // Combining strikethrough/overlay applied across the characters.
  if (/[̵̶̷̸]/.test(s)) return true;
  return false;
}

/** Strip the marker so the words are clean if it's kept for any reason. */
function unmark(line) {
  return String(line)
    .replace(/^\s*\[done\]\s*/i, "")
    .replace(/^\s*~~([\s\S]+)~~\s*$/, "$1")
    .trim();
}

/** The no-key path: rules only, and it still sorts. */
export function triageLocally(text, defaultEst = 30, now = new Date()) {
  // Drop finished lines before anything else looks at them — stripBullet
  // would otherwise turn "[x] math pset" into a live task.
  const live = String(text || "")
    .split(/\r?\n/)
    .filter(l => !isCrossedOff(l))
    .join("\n");

  const cands = extractDeterministic({ text: live }, now);
  const tasks = [], reminders = [];

  for (const c of cands) {
    if (looksLikeReminder(c.title, now)) {
      const r = parseReminder(c.title, now);
      if (r) { r.quote = c.quote; reminders.push(r); continue; }
    }
    tasks.push(taskFrom(c.title, c.est || defaultEst, c.due, c.quote, now));
  }
  return { tasks, reminders, by: "rules", dropped: 0, error: null };
}

function taskFrom(title, est, due, quote, now) {
  const t = {
    id: uid(),
    raw: title,
    title: stripBullet(title),
    est: est || 30,
    estGuessed: !est,
    due: due || null,
    dueKind: due ? "Due" : null,
    dueSrc: due ? "photo" : null,
    status: "pending",
    actual: null,
    addedAt: null,
    ord: 0,
    quote: quote || title
  };
  if (!t.due) {
    const d = parseDue(t.title, now);
    if (d) { t.due = todayKey(d.due); t.dueKind = d.kind; t.dueSrc = "line"; }
  }
  return t;
}

/**
 * The full path. Rules first so there's always something, then the model
 * sorts properly — and everything it returns passes the same quote check.
 * @returns {Promise<{tasks:array, reminders:array, by:string, dropped:number, error:string|null}>}
 */
export async function triage(text, ai, defaultEst = 30, now = new Date()) {
  const body = String(text || "").slice(0, 10000);
  if (!body.trim()) return { tasks: [], reminders: [], by: "rules", dropped: 0, error: null };

  const local = triageLocally(body, defaultEst, now);
  if (!ai || !ai.hasKey()) return local;

  try {
    const reply = await ai.askJSON(PROMPT.replace("{TODAY}", todayKey(now)) + body, { maxTokens: 1600 });
    const rawTasks = Array.isArray(reply?.tasks) ? reply.tasks : [];
    const rawRems = Array.isArray(reply?.reminders) ? reply.reminders : [];
    if (!rawTasks.length && !rawRems.length) return local;

    const tProp = rawTasks.slice(0, 30)
      .map(r => ({ title: String(r.title || "").trim(), quote: String(r.quote || ""), raw: r }))
      .filter(x => x.title);
    const rProp = rawRems.slice(0, 30)
      .map(r => ({ title: String(r.text || "").trim(), quote: String(r.quote || ""), raw: r }))
      .filter(x => x.title);

    const tOk = verifyCandidates(tProp, body);
    const rOk = verifyCandidates(rProp, body);

    // Belt and braces: even if the model lists a finished line, drop it.
    const liveOnly = kept => kept.filter(x => !isCrossedOff(x.quote) && !isCrossedOff(x.title));
    const tLive = liveOnly(tOk.kept);
    const rLive = liveOnly(rOk.kept);
    const dropped = tOk.dropped.length + rOk.dropped.length +
      (tOk.kept.length - tLive.length) + (rOk.kept.length - rLive.length);
    tOk.kept = tLive;
    rOk.kept = rLive;

    const tasks = tOk.kept.map((x, i) => {
      const mins = Number(x.raw.minutes);
      const due = typeof x.raw.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.raw.due) ? x.raw.due : null;
      const t = taskFrom(unmark(x.title), mins >= 5 && mins <= 180 ? Math.round(mins) : defaultEst, due, x.quote, now);
      t.estGuessed = !(mins >= 5 && mins <= 180);
      t.ord = i;
      return t;
    });

    const reminders = rOk.kept.map(x => {
      const date = typeof x.raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.raw.date) ? x.raw.date : null;
      if (date) {
        const r = makeReminder({ text: x.title, at: date, raw: x.quote });
        r.quote = x.quote;
        return r;
      }
      // No date given — try to read one out of the line itself.
      const parsed = parseReminder(x.title, now);
      if (parsed) { parsed.quote = x.quote; return parsed; }
      // Still nothing: it's really a task, not a reminder.
      return null;
    }).filter(Boolean);

    // Anything the model called a dateless reminder becomes a task instead.
    const strays = rOk.kept.length - reminders.length;
    if (strays > 0) {
      for (const x of rOk.kept) {
        if (!parseReminder(x.title, now) && !reminders.some(r => r.text === x.title)) {
          tasks.push(taskFrom(x.title, defaultEst, null, x.quote, now));
        }
      }
    }

    tasks.forEach((t, i) => { t.ord = i; });
    if (!tasks.length && !reminders.length) return local;
    return { tasks, reminders, by: "model", dropped, error: null };
  } catch (e) {
    return { ...local, error: (e && e.message) || "The model call failed." };
  }
}

/** One plain line about what just happened. */
export function triageSummary(res, name) {
  const t = res.tasks.length, r = res.reminders.length;
  const who = name ? `, ${name}` : "";
  if (!t && !r) return `Read it${who} — nothing on there looked like something to do.`;

  const bits = [];
  if (t) bits.push(`${t} thing${t === 1 ? "" : "s"} to do`);
  if (r) bits.push(`${r} reminder${r === 1 ? "" : "s"}`);
  return `Got it${who}. ${bits.join(" and ")}.` +
    (res.dropped ? ` (Dropped ${res.dropped} that didn't match the page.)` : "");
}

export { escapeHtml };
