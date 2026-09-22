/* =====================================================================
   Locked In — the Future Me engine.

   "You're 2.5 hours behind the pace required to finish by October 20"
   is arithmetic, not a judgement call, so no model is involved. Every
   number here traces to two things you can check: minutes you actually
   logged, and evenings that actually exist after your calendar takes
   its cut.
   ===================================================================== */

import {
  MIN, SHORTDAY, uid, todayKey, daysBetween, dayStart, fmtDur, bedtimeAt, calBusy
} from "./engine.js";

/* When the evening can actually start. Overridden by state.homeBy, which
   setup asks for — the difference between 3:30 and a guessed 4:30 is a
   whole hour per evening, and Future Me's pace math is only as honest as
   this number. */
const DEFAULT_HOME_H = 15, DEFAULT_HOME_M = 30;

function homeTime(state, day) {
  const [h, m] = String(state.homeBy || "15:30").split(":");
  const d = new Date(day);
  d.setHours(parseInt(h, 10) || DEFAULT_HOME_H, parseInt(m, 10) || DEFAULT_HOME_M, 0, 0);
  return d;
}

export function makeGoal({ title, targetDate, totalMin, match }) {
  return {
    id: uid(),
    title: String(title || "").trim(),
    targetDate,                       // "YYYY-MM-DD"
    totalMin: Math.max(15, Math.round(totalMin || 60)),
    match: (match || firstStrongWord(title) || "").toLowerCase(),
    createdAt: Date.now(),
    archived: false
  };
}

function firstStrongWord(title) {
  const words = String(title || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const stop = new Set(["finish","prepare","project","study","review","complete","before","ready","work"]);
  return words.find(w => !stop.has(w)) || words[0] || "";
}

/** Minutes logged against this goal: explicit links first, name match second. */
export function loggedFor(state, goal) {
  let total = 0;
  for (const e of state.log || []) {
    if (e.status !== "done" || !e.minutes) continue;
    if (e.goalId === goal.id) { total += e.minutes; continue; }
    if (!e.goalId && goal.match && String(e.title || "").toLowerCase().includes(goal.match)) total += e.minutes;
  }
  return total;
}

/** Tasks on tonight's list that count toward this goal. */
export function tasksFor(state, goal) {
  return (state.tasks || []).filter(t =>
    t.goalId === goal.id ||
    (!t.goalId && goal.match && t.title.toLowerCase().includes(goal.match)));
}

/**
 * How many usable minutes a given evening holds, after the calendar.
 * `events` only covers the next week or so — days past that are marked
 * `known: false` so the UI can say the estimate is uncontested rather
 * than pretending the calendar is clear.
 */
export function eveningCapacity(state, day, events, now) {
  const start = homeTime(state, day);
  const isToday = daysBetween(new Date(), day) === 0;
  const from = isToday && now && now > start ? new Date(now) : start;

  const end = bedtimeAt(state, day);
  if (end <= from) return { min: 0, known: true };

  const covered = (events || []).some(ev =>
    Math.abs(daysBetween(new Date(ev.start), day)) === 0 || ev.start > +dayStart(day));
  const busy = calBusy(events || [], from.getTime(), end.getTime());
  const busyMin = busy.reduce((a, b) => a + (b.e - b.s) / MIN, 0);

  return { min: Math.max(0, (end - from) / MIN - busyMin), known: covered || (events || []).length > 0 };
}

/**
 * The whole trajectory for one goal.
 */
export function trajectory(state, goal, now = new Date(), events = []) {
  const target = new Date(goal.targetDate + "T23:59:59");
  const created = new Date(goal.createdAt || now);
  const doneMin = loggedFor(state, goal);
  const remainMin = Math.max(0, goal.totalMin - doneMin);
  const daysLeft = daysBetween(now, target);
  const overdue = daysLeft < 0;

  const days = [];
  for (let i = 0; i <= Math.max(0, daysLeft); i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const cap = eveningCapacity(state, d, events, i === 0 ? now : null);
    days.push({ date: todayKey(d), dow: d.getDay(), i, cap: cap.min, known: cap.known });
  }
  const usable = days.filter(d => d.cap >= 15);
  const totalCap = days.reduce((a, d) => a + d.cap, 0);

  // Where you should be by now, if the work were spread evenly from the
  // day you set the goal to the day it's due.
  const spanMs = Math.max(1, target - created);
  const elapsedMs = Math.min(Math.max(0, now - created), spanMs);
  const expected = goal.totalMin * (elapsedMs / spanMs);
  const behind = expected - doneMin;

  const perEvening = usable.length ? remainMin / usable.length : remainMin;
  const feasible = remainMin <= totalCap;

  return {
    goal, doneMin, remainMin, daysLeft, overdue, days, usable, totalCap,
    expected, behind, perEvening, feasible,
    pct: goal.totalMin ? Math.min(100, Math.round((doneMin / goal.totalMin) * 100)) : 0,
    catchUp: suggestCatchUp(days, Math.max(0, Math.min(behind, remainMin)))
  };
}

/**
 * Turn a deficit into named evenings. Earliest days first (a plan you can
 * start tomorrow beats an optimal one you can't), never more than 60% of
 * a day's room, rounded to 5 minutes, at most 3 days.
 */
export function suggestCatchUp(days, deficitMin) {
  if (deficitMin < 10) return [];
  const out = [];
  let left = deficitMin;
  for (const d of days) {
    if (left < 5 || out.length >= 3) break;
    if (d.cap < 20) continue;
    const room = Math.floor((d.cap * 0.6) / 5) * 5;
    if (room < 15) continue;
    const take = Math.min(room, Math.ceil(left / 5) * 5);
    out.push({ date: d.date, dow: d.dow, min: take, i: d.i });
    left -= take;
  }
  return out;
}

/* ------------------------------------------------------------ sentences
   Templated, like the reason lines. Every clause is a number above. */

export function dayWord(t, now = new Date()) {
  if (t.i === 0) return "today";
  if (t.i === 1) return "tomorrow";
  if (t.i < 7) return SHORTDAY[t.dow] === SHORTDAY[now.getDay()] ? "next " + SHORTDAY[t.dow] : SHORTDAY[t.dow];
  return SHORTDAY[t.dow] + " the " + new Date(t.date + "T00:00:00").getDate();
}

export function targetWord(goal) {
  const d = new Date(goal.targetDate + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function paceSentence(tr, now = new Date()) {
  const g = tr.goal;
  if (tr.remainMin <= 0) return { tone: "good", text: `Done — ${fmtDur(tr.doneMin)} logged against a ${fmtDur(g.totalMin)} target.` };
  if (tr.overdue) return { tone: "crit", text: `${targetWord(g)} has passed with ${fmtDur(tr.remainMin)} still to go.` };
  if (!tr.feasible) {
    return {
      tone: "crit",
      text: `There isn't enough evening left before ${targetWord(g)}. You need ${fmtDur(tr.remainMin)} and only about ${fmtDur(tr.totalCap)} exists after your calendar takes its cut.`
    };
  }
  if (tr.behind >= 15) {
    return { tone: "warn", text: `You're ${fmtDur(tr.behind)} behind the pace required to finish by ${targetWord(g)}.` };
  }
  if (tr.behind <= -15) {
    return { tone: "good", text: `You're ${fmtDur(-tr.behind)} ahead of the pace for ${targetWord(g)}.` };
  }
  return { tone: "ok", text: `On pace for ${targetWord(g)}.` };
}

export function adjustmentSentence(tr, now = new Date()) {
  if (tr.remainMin <= 0 || tr.overdue) return "";
  if (!tr.feasible) {
    const short = tr.remainMin - tr.totalCap;
    return `Move the date, cut about ${fmtDur(short)} of scope, or start before you normally get home.`;
  }
  if (tr.catchUp.length) {
    const parts = tr.catchUp.map(c => `${fmtDur(c.min)} ${dayWord(c, now)}`);
    return `Suggested adjustment: ${parts.join(" + ")}.`;
  }
  if (tr.usable.length) {
    return `Steady pace from here: ${fmtDur(tr.perEvening)} an evening across ${tr.usable.length} evening${tr.usable.length === 1 ? "" : "s"}.`;
  }
  return "";
}

/** One line for the "what do I need to worry about this week" answer. */
export function weekPressure(state, now = new Date(), events = []) {
  const out = [];
  for (const g of state.goals || []) {
    if (g.archived) continue;
    const tr = trajectory(state, g, now, events);
    if (tr.remainMin <= 0) continue;
    if (tr.daysLeft <= 7 || tr.behind >= 30 || !tr.feasible) {
      out.push({ goal: g, tr, pace: paceSentence(tr, now), adj: adjustmentSentence(tr, now) });
    }
  }
  out.sort((a, b) => a.tr.daysLeft - b.tr.daysLeft);
  return out;
}
