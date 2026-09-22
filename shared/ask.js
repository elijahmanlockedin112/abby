/* =====================================================================
   Locked In — "What am I supposed to be doing right now?"

   The questions you actually ask every day are answered by looking them
   up, not by asking a model: they have exact answers and a model would
   only add a way to get them wrong. The router handles those. Anything
   it doesn't recognise goes to the model with the context packed in —
   and only if you've set a key.
   ===================================================================== */

import {
  MIN, SHORTDAY, fmtClock, fmtDur, todayKey, daysBetween,
  buildPlan, effectiveDue, escapeHtml, unfinishedOn, minutesOn
} from "./engine.js";
import { trajectory, paceSentence, adjustmentSentence, weekPressure, targetWord } from "./goals.js";

const P = s => `<p>${s}</p>`;
const UL = items => items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>` : "";

const INTENTS = [
  { name: "now",       re: /\b(right now|what now|what should i (be )?(do|doing|work on)|what.?s next|next up|start with)\b/i },
  { name: "unfinished",re: /\b(unfinished|didn.?t finish|did ?n.?t i finish|left ?over|leftover|yesterday|last night|still need)\b/i },
  { name: "week",      re: /\b(this week|coming up|upcoming|worry|worried|worrying|ahead of me|on my plate)\b/i },
  { name: "pace",      re: /\b(behind|on pace|on track|pace|trajectory|going to (make|finish)|will i finish)\b/i },
  { name: "time",      re: /\b(how (much|long).*(time|left)|time (do i have|left)|how long until bed)\b/i },
  { name: "today",     re: /\b(what did i (do|get done)|today so far|how.?d today go|progress today)\b/i },
  { name: "list",      re: /\b(what.?s on (the|my) list|whole list|everything|show (me )?the list)\b/i }
];

export function classify(q) {
  const s = String(q || "");
  for (const i of INTENTS) if (i.re.test(s)) return i.name;
  return null;
}

/* ----------------------------------------------------------- lookups */

function answerNow(state, now, plan) {
  if (!state.tasks.length) return P("Nothing on tonight's list. Add one and this fills in.");
  if (plan.end <= now) return P(`It's past your bedtime of <b>${fmtClock(plan.end)}</b>. Whatever's left rolls to tomorrow.`);

  const active = state.active && state.tasks.find(t => t.id === state.active.id);
  if (active && active.status === "pending") {
    const elapsed = (now - state.active.startedAt) / MIN;
    const over = elapsed > active.est;
    return P(
      `You're on <b>${escapeHtml(active.title)}</b> — ` +
      (over ? `${fmtDur(elapsed - active.est)} past the ${fmtDur(active.est)} you gave it.`
            : `${fmtDur(active.est - elapsed)} left of ${fmtDur(active.est)}.`)
    );
  }

  const first = plan.segs.find(s => s.type === "task");
  if (!first) {
    const busyNow = plan.segs.find(s => s.type === "busy" && s.s <= now && s.e > now);
    if (busyNow) return P(`You're booked — <b>${escapeHtml(busyNow.title)}</b> until ${fmtClock(new Date(busyNow.e))}.`);
    return P("Nothing left to schedule tonight. The list is clear.");
  }

  const t = first.task;
  const due = effectiveDue(t);
  const why = due
    ? `${t.dueKind || "Due"} ${daysBetween(now, due) <= 0 ? "today" : daysBetween(now, due) === 1 ? "tomorrow" : SHORTDAY[due.getDay()]}.`
    : "Nothing on the list has a deadline, so your own order stands.";

  const rest = plan.segs.filter(s => s.type === "task").slice(1, 3);
  return P(`<b>${escapeHtml(t.title)}</b> — ${fmtDur(t.est)}, starting now. ${why}`) +
    (rest.length ? P("Then: " + rest.map(s => `${escapeHtml(s.task.title)} (${fmtDur(s.task.est)})`).join(", then ") + ".") : "") +
    P(`<span class="dim">${fmtDur((plan.end - now) / MIN)} until bedtime.</span>`);
}

function answerUnfinished(state, now) {
  const y = todayKey(new Date(now.getTime() - 86400000));
  const left = unfinishedOn(state, y);
  const mins = minutesOn(state, y);
  const head = mins
    ? P(`Yesterday you logged <b>${fmtDur(mins)}</b>.`)
    : P("Nothing was logged yesterday.");
  if (!left.length) return head + P("Nothing was left hanging.");
  return head + P("Still open from then:") +
    UL(left.map(x => `${escapeHtml(x.title)} <span class="dim">— ${x.why}</span>`));
}

function answerWeek(state, now, events) {
  const out = [];
  const soon = state.tasks
    .filter(t => t.status === "pending" && effectiveDue(t))
    .map(t => ({ t, d: daysBetween(now, effectiveDue(t)) }))
    .filter(x => x.d <= 7)
    .sort((a, b) => a.d - b.d);

  if (soon.length) {
    out.push(P("Deadlines inside a week:"));
    out.push(UL(soon.map(x =>
      `<b>${escapeHtml(x.t.title)}</b> — ${x.t.dueKind || "due"} ${x.d <= 0 ? "today" : x.d === 1 ? "tomorrow" : `in ${x.d} days`}`)));
  }

  const press = weekPressure(state, now, events);
  if (press.length) {
    out.push(P("Goals under pressure:"));
    out.push(UL(press.map(p => `<b>${escapeHtml(p.goal.title)}</b> — ${p.pace.text} ${p.adj}`)));
  }

  const weekEnd = now.getTime() + 7 * 86400000;
  const big = (events || []).filter(e => e.start > now.getTime() && e.start < weekEnd).slice(0, 5);
  if (big.length) {
    out.push(P("On the calendar:"));
    out.push(UL(big.map(e => {
      const d = new Date(e.start);
      return `${escapeHtml(e.title)} <span class="dim">— ${SHORTDAY[d.getDay()]} ${e.allDay ? "all day" : fmtClock(d)}</span>`;
    })));
  }

  if (!out.length) return P("Nothing with a deadline inside a week, and no goal is behind. Quiet week.");
  return out.join("");
}

function answerPace(state, now, events) {
  const live = (state.goals || []).filter(g => !g.archived);
  if (!live.length) return P("No goals set. Add one and this tracks whether you're actually on pace for it.");
  return live.map(g => {
    const tr = trajectory(state, g, now, events);
    const pace = paceSentence(tr, now);
    const adj = adjustmentSentence(tr, now);
    return P(`<b>${escapeHtml(g.title)}</b> — ${fmtDur(tr.doneMin)} of ${fmtDur(g.totalMin)} logged (${tr.pct}%), due ${targetWord(g)}.`) +
      P(`<span class="tone-${pace.tone}">${pace.text}</span>${adj ? " " + adj : ""}`);
  }).join("");
}

function answerTime(state, now, plan) {
  const left = (plan.end - now) / MIN;
  if (left <= 0) return P(`Past bedtime (${fmtClock(plan.end)}).`);
  const work = plan.segs.filter(s => s.type === "task").reduce((a, s) => a + (s.e - s.s) / MIN, 0);
  return P(`<b>${fmtDur(left)}</b> until bedtime at ${fmtClock(plan.end)}.`) +
    P(`${fmtDur(work)} of that is planned work${plan.freeMin >= 10 ? `, ${fmtDur(plan.freeMin)} is free` : ""}${plan.busy.length ? `, and the calendar takes ${fmtDur(plan.busy.reduce((a, b) => a + (b.e - b.s) / MIN, 0))}` : ""}.`);
}

function answerToday(state, now) {
  const today = todayKey(now);
  const done = (state.log || []).filter(e => e.date === today && e.status === "done");
  const mins = minutesOn(state, today);
  if (!done.length) return P("Nothing finished yet today.");
  return P(`<b>${fmtDur(mins)}</b> logged across ${done.length} session${done.length === 1 ? "" : "s"}:`) +
    UL(done.map(e => `${escapeHtml(e.title)} <span class="dim">— ${fmtDur(e.minutes || 0)}${e.est ? ` (est ${fmtDur(e.est)})` : ""}</span>`));
}

function answerList(state) {
  if (!state.tasks.length) return P("The list is empty.");
  const sorted = [...state.tasks].sort((a, b) => a.ord - b.ord);
  return P(`${state.tasks.length} item${state.tasks.length === 1 ? "" : "s"}, in the order you gave them:`) +
    UL(sorted.map(t =>
      `${escapeHtml(t.title)} <span class="dim">— ${fmtDur(t.est)}${t.status !== "pending" ? `, ${t.status}` : ""}</span>`));
}

/* ------------------------------------------------------ model fallback */

function packContext(state, now, events, plan) {
  const L = [];
  L.push(`Now: ${now.toString()}`);
  L.push(`Bedtime: ${fmtClock(plan.end)} (${fmtDur(Math.max(0, (plan.end - now) / MIN))} away)`);

  L.push("\nTONIGHT'S LIST (this is the complete list; there is nothing else):");
  if (!state.tasks.length) L.push("  (empty)");
  for (const t of [...state.tasks].sort((a, b) => a.ord - b.ord)) {
    L.push(`  ${t.ord + 1}. ${t.title} — ${t.est}m, ${t.status}${t.due ? `, ${t.dueKind || "due"} ${t.due}` : ""}`);
  }

  L.push("\nTONIGHT'S PLAN (computed, in order):");
  for (const s of plan.segs.slice(0, 12)) {
    const when = `${fmtClock(new Date(s.s))}-${fmtClock(new Date(s.e))}`;
    L.push(`  ${when} ${s.type === "task" ? s.task.title : s.type === "busy" ? "[calendar] " + s.title : "[free]"}`);
  }
  if (plan.spill.length) L.push(`  Doesn't fit tonight: ${plan.spill.map(t => t.title).join(", ")}`);

  if (state.goals?.length) {
    L.push("\nGOALS:");
    for (const g of state.goals.filter(g => !g.archived)) {
      const tr = trajectory(state, g, now, events);
      L.push(`  ${g.title} — ${Math.round(tr.doneMin)}m of ${g.totalMin}m done, due ${g.targetDate}, ${tr.behind > 0 ? `${Math.round(tr.behind)}m behind pace` : "on or ahead of pace"}`);
    }
  }

  const recent = (state.log || []).slice(-25);
  if (recent.length) {
    L.push("\nRECENT SESSIONS:");
    for (const e of recent) L.push(`  ${e.date} ${e.title} — ${e.status}${e.minutes ? `, ${e.minutes}m` : ""}`);
  }

  const soon = (events || []).filter(e => e.start > now.getTime() && e.start < now.getTime() + 7 * 86400000).slice(0, 12);
  if (soon.length) {
    L.push("\nCALENDAR (next 7 days):");
    for (const e of soon) L.push(`  ${new Date(e.start).toDateString()} ${e.allDay ? "all day" : fmtClock(new Date(e.start))} — ${e.title}`);
  }

  const inbox = (state.inbox || []).filter(c => c.status !== "dismissed").slice(-8);
  if (inbox.length) {
    L.push("\nINBOX (captured, not yet on the list):");
    for (const c of inbox) L.push(`  [${c.kind}] ${c.source}: ${(c.preview || "").slice(0, 120)}`);
  }

  return L.join("\n").slice(0, 12000);
}

const SYSTEM = `You are the assistant inside "Locked In", a planning app for a high school student.

You are answering a question about THEIR OWN DATA, which is given to you below. Rules:
- Answer only from that data. If it doesn't contain the answer, say so plainly.
- Never invent a task, a deadline, or a commitment. The list you are shown is the complete list.
- Do not suggest new work unless they asked for suggestions.
- Be short. Two or three sentences, or a short list. No preamble, no sign-off, no encouragement.
- Plain text only. No markdown headers, no bold.`;

/**
 * @returns {Promise<{html:string, by:"rules"|"model", intent:string|null}>}
 */
export async function answer(question, { state, now = new Date(), events = [], ai } = {}) {
  const plan = buildPlan(state, now, events);
  const intent = classify(question);

  switch (intent) {
    case "now":        return { html: answerNow(state, now, plan), by: "rules", intent };
    case "unfinished": return { html: answerUnfinished(state, now), by: "rules", intent };
    case "week":       return { html: answerWeek(state, now, events), by: "rules", intent };
    case "pace":       return { html: answerPace(state, now, events), by: "rules", intent };
    case "time":       return { html: answerTime(state, now, plan), by: "rules", intent };
    case "today":      return { html: answerToday(state, now), by: "rules", intent };
    case "list":       return { html: answerList(state), by: "rules", intent };
  }

  if (!ai || !ai.hasKey()) {
    return {
      html: P("That one needs a model, and no API key is set.") +
        P("Without a key these all work: <em>what should I do right now</em>, <em>what did I leave unfinished yesterday</em>, <em>what do I need to worry about this week</em>, <em>am I on pace</em>, <em>how much time do I have</em>, <em>what did I get done today</em>, <em>what's on the list</em>."),
      by: "rules", intent: null
    };
  }

  const text = await ai.ask(
    packContext(state, now, events, plan) + "\n\nQUESTION: " + String(question || "").slice(0, 500),
    { system: SYSTEM, maxTokens: 600 }
  );
  return {
    html: String(text).split(/\n{2,}/).map(p => P(escapeHtml(p).replace(/\n/g, "<br>"))).join(""),
    by: "model", intent: null
  };
}

export const SUGGESTED = [
  "What should I do right now?",
  "What did I leave unfinished yesterday?",
  "What do I need to worry about this week?",
  "Am I on pace?",
  "How much time do I have?"
];
