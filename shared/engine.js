/* =====================================================================
   Locked In — the engine.
   Pure functions. No DOM, no storage, no network, no model.

   The contract this file exists to keep:
     buildPlan() can only ever emit tasks that were handed to it.
     There is no code path that creates a task. Not one.
   ===================================================================== */

export const MIN = 60000;
export const DAYNAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
export const SHORTDAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* ---------------------------------------------------------------- time */

const pad = n => (n < 10 ? "0" : "") + n;

export function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function fmtClock(d) {
  let h = d.getHours();
  const m = d.getMinutes(), ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + pad(m) + " " + ap;
}

export function fmtDur(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return h + "h " + m + "m";
  if (h) return h + "h";
  return m + "m";
}

export function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function daysBetween(a, b) { return Math.round((dayStart(b) - dayStart(a)) / 86400000); }

export function uid() {
  return "t" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

/* ------------------------------------------------------------- parsing
   Narrow on purpose. It reads metadata off a line and never rewrites it.
   Everything it understands is documented in the UI, so nothing is magic. */

export function stripBullet(line) {
  return line.replace(/^\s*(?:[-*•–—]+\s+|\[\s*[xX ]?\s*\]\s*|\d+[.)]\s+)/, "").trim();
}

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];
const MONTH_RE = MONTHS.map(m => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join("|");

/**
 * Find a date (and optionally a time) stated anywhere in a line, and say
 * exactly which characters said it — so the caller can cut the phrase out
 * and keep the rest as the actual text.
 *
 * Understands: November 30 · Nov 30th · 30 November · 11/30 · Thursday ·
 * next Friday · today · tonight · tomorrow · in 3 days · in 2 weeks,
 * each optionally followed by "at 9am" / "at 3:15pm".
 *
 * @returns {{date:Date, time:string|null, matched:string, index:number}|null}
 */
export function parseDatePhrase(text, now = new Date()) {
  const s = String(text || "");
  const low = s.toLowerCase();

  const hit = (date, index, length) => {
    let time = null;
    // A time may trail the date phrase, or sit anywhere if the date didn't eat it.
    const after = s.slice(index + length);
    const tm = (after.match(/^\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
             || s.match(/\b(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
             || s.match(/\b(?:at\s+)(\d{1,2}):(\d{2})\b/i));
    if (tm) {
      let h = parseInt(tm[1], 10);
      const mi = tm[2] ? parseInt(tm[2], 10) : 0;
      const ap = (tm[3] || "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) time = pad(h) + ":" + pad(mi);
      if (after.startsWith(tm[0])) length += tm[0].length;
    }
    return { date, time, matched: s.substr(index, length), index };
  };

  const rollForward = d => {
    // A bare month/day that has already gone by means next year.
    if (daysBetween(now, d) < -30) d.setFullYear(d.getFullYear() + 1);
    return d;
  };

  // "on November 30", "Nov 30th", "November 30 2026"
  let m = low.match(new RegExp(`\\b(?:on\\s+|by\\s+|due\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (m) {
    const mo = MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3)));
    const da = parseInt(m[2], 10);
    if (mo >= 0 && da >= 1 && da <= 31) {
      const d = new Date(m[3] ? parseInt(m[3], 10) : now.getFullYear(), mo, da);
      if (d.getMonth() === mo) return hit(m[3] ? d : rollForward(d), m.index, m[0].length);
    }
  }

  // "30 November", "30th of Nov"
  m = low.match(new RegExp(`\\b(?:on\\s+|by\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?\\b`));
  if (m) {
    const mo = MONTHS.findIndex(x => x.startsWith(m[2].slice(0, 3)));
    const da = parseInt(m[1], 10);
    if (mo >= 0 && da >= 1 && da <= 31) {
      const d = new Date(now.getFullYear(), mo, da);
      if (d.getMonth() === mo) return hit(rollForward(d), m.index, m[0].length);
    }
  }

  // "in 3 days", "in 2 weeks", "in a month"
  m = low.match(/\bin\s+(a|an|\d{1,3})\s+(day|week|month)s?\b/);
  if (m) {
    const n = /^(a|an)$/.test(m[1]) ? 1 : parseInt(m[1], 10);
    const d = dayStart(now);
    if (m[2] === "day") d.setDate(d.getDate() + n);
    else if (m[2] === "week") d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return hit(d, m.index, m[0].length);
  }

  if ((m = low.match(/\b(today|tonight)\b/))) return hit(dayStart(now), m.index, m[0].length);
  if ((m = low.match(/\btomorrow\b/))) {
    const d = dayStart(now); d.setDate(d.getDate() + 1);
    return hit(d, m.index, m[0].length);
  }

  // Slash date — never a hyphen, which school text uses for ranges.
  m = low.match(/(?:^|[^\d.\/])((\d{1,2})\/(\d{1,2}))(?![\d.\/])/);
  if (m) {
    const mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const d = new Date(now.getFullYear(), mo - 1, da);
      if (d.getMonth() === mo - 1) return hit(rollForward(d), low.indexOf(m[1], m.index), m[1].length);
    }
  }

  // Day names, with an optional "next".
  for (let i = 0; i < 7; i++) {
    const full = DAYNAMES[i], ab = full.slice(0, 3);
    const re = new RegExp(`\\b(?:(?:on|by|next)\\s+)?(${full}|${ab})\\b`, "i");
    const dm = low.match(re);
    if (dm) return hit(nextDow(i, now), dm.index, dm[0].length);
  }
  return null;
}

export function parseEst(line) {
  let m = line.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = line.match(/\((\d+)\s*(?:m|min|mins|minute|minutes)?\)/i);
  if (m) return parseInt(m[1], 10);
  m = line.match(/\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function nextDow(target, from) {
  const d = dayStart(from);
  let delta = (target - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;           // "Thursday" said on a Thursday means the next one
  d.setDate(d.getDate() + delta);
  return d;
}

export function parseDue(line, now = new Date()) {
  const low = line.toLowerCase();
  let kind = "Due";
  const km = low.match(/\b(test|quiz|exam|presentation|competition|comp|meet|due|deadline|interview)\b/);
  if (km) {
    const k = km[1];
    kind = (k === "due" || k === "deadline") ? "Due" : k.charAt(0).toUpperCase() + k.slice(1);
  }
  const hit = parseDatePhrase(line, now);
  return hit ? { due: hit.date, kind } : null;
}

export function makeTask(rawLine, ord, defaultEst, now = new Date(), addedAt = null) {
  const title = stripBullet(rawLine);
  const est = parseEst(title);
  const due = parseDue(title, now);
  return {
    id: uid(),
    raw: rawLine,
    title,
    est: est || defaultEst,
    estGuessed: !est,
    due: due ? todayKey(due.due) : null,
    dueKind: due ? due.kind : null,
    dueSrc: due ? "line" : null,
    status: "pending",
    actual: null,
    addedAt,
    ord
  };
}

export function parseList(text, defaultEst = 30, now = new Date()) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!stripBullet(line)) continue;
    out.push(makeTask(line, out.length, defaultEst, now));
  }
  return out;
}

/* ------------------------------------------------------------ calendar
   Two jobs, and only two: take time away, and flag a deadline.
   Neither one can produce a task. */

const STOPWORDS = new Set([
  "with","this","that","from","work","time","finish","start","review","study",
  "todo","need","prep","make","take","read","write","week","then","some","more","done"
]);

export function calMatch(task, events) {
  const words = (task.title.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !STOPWORDS.has(w));
  let best = null;
  for (const ev of events) {
    const en = (ev.title || "").toLowerCase();
    for (const w of words) {
      if (en.includes(w)) { if (!best || ev.start < best.start) best = ev; break; }
    }
  }
  return best;
}

export function calBusy(events, from, to) {
  const raw = [];
  for (const ev of events) {
    if (ev.allDay || !ev.end) continue;
    const s = Math.max(ev.start, from), e = Math.min(ev.end, to);
    if (e - s >= 5 * MIN) raw.push({ s, e, title: ev.title });
  }
  raw.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b.s <= last.e) { last.e = Math.max(last.e, b.e); last.title += " + " + b.title; }
    else merged.push({ s: b.s, e: b.e, title: b.title });
  }
  return merged;
}

/* -------------------------------------------------------------- engine */

export function bedtimeAt(state, now) {
  const [hh, mm] = (state.bedtime || "22:00").split(":");
  const b = new Date(now);
  b.setHours(parseInt(hh, 10) || 22, parseInt(mm, 10) || 0, 0, 0);
  return b;
}

export function effectiveDue(t) {
  if (t.due) return new Date(t.due + "T00:00:00");
  if (t._calFlag) return new Date(t._calFlag.start);
  return null;
}

function rankOf(t, now) {
  const due = effectiveDue(t);
  if (!due) return 3;
  const d = daysBetween(now, due);
  if (d <= 1) return 0;
  if (d <= 3) return 1;
  if (d <= 7) return 2;
  return 3;
}

/**
 * The whole scheduler.
 *   order  = deadline bucket, then the order you typed it. That is the only tiebreak.
 *   layout = first-fit into the gaps the calendar leaves, between now and bedtime.
 *   nothing is compressed to fit; what doesn't fit is returned in `spill`.
 */
export function buildPlan(state, now = new Date(), events = []) {
  const end = bedtimeAt(state, now);
  const busy = calBusy(events, now.getTime(), end.getTime());

  for (const t of state.tasks) t._calFlag = t.due ? null : calMatch(t, events);

  let pending = state.tasks.filter(t => t.status === "pending");
  pending.sort((a, b) => {
    const ra = rankOf(a, now), rb = rankOf(b, now);
    if (ra !== rb) return ra - rb;
    const da = effectiveDue(a), dbb = effectiveDue(b);
    if (da && dbb && +da !== +dbb) return da - dbb;
    return a.ord - b.ord;
  });

  let gaps = [];
  let walk = now.getTime();
  for (const b of busy) {
    if (b.s > walk) gaps.push({ s: walk, e: b.s });
    walk = Math.max(walk, b.e);
  }
  if (walk < end.getTime()) gaps.push({ s: walk, e: end.getTime() });

  const segs = [], spill = [];

  // Whatever you're running right now keeps its real slot, at the front.
  let activeSeg = null;
  if (state.active) {
    const at = state.tasks.find(t => t.id === state.active.id);
    if (at && at.status === "pending") {
      const planEnd = state.active.startedAt + at.est * MIN;
      const realEnd = Math.max(planEnd, now.getTime());
      activeSeg = { type: "task", s: state.active.startedAt, e: realEnd, task: at,
                    running: true, over: now.getTime() > planEnd };
      pending = pending.filter(t => t.id !== at.id);
      for (const g of gaps) if (g.s < realEnd) g.s = Math.min(Math.max(g.s, realEnd), g.e);
      gaps = gaps.filter(g => g.e > g.s);
    }
  }

  for (const t of pending) {
    const len = t.est * MIN;
    let placed = false;
    for (const g of gaps) {
      if (g.e - g.s >= len) { segs.push({ type: "task", s: g.s, e: g.s + len, task: t }); g.s += len; placed = true; break; }
    }
    if (!placed) spill.push(t);
  }

  for (const b of busy) segs.push({ type: "busy", s: b.s, e: b.e, title: b.title });
  for (const g of gaps) if (g.e - g.s >= 5 * MIN) segs.push({ type: "free", s: g.s, e: g.e });
  if (activeSeg) segs.push(activeSeg);
  segs.sort((a, b) => a.s - b.s);

  const freeMin = segs.filter(s => s.type === "free").reduce((a, s) => a + (s.e - s.s) / MIN, 0);
  return { segs, spill, end, busy, freeMin, horizon: Math.max(0, end - now) };
}

export function taskNumber(plan, task) {
  let n = 0;
  for (const s of plan.segs) {
    if (s.type !== "task") continue;
    n++;
    if (s.task.id === task.id) return n;
  }
  return n;
}

/* -------------------------------------------------------- reason lines
   Templates over the data. Every clause is checkable against the list.
   No model writes these, which is why they can never drift from the truth. */

export function reasonFor(t, now, state, position) {
  const bits = [];
  if (t.due) {
    const due = effectiveDue(t), d = daysBetween(now, due);
    const when = d === 0 ? "today" : d === 1 ? "tomorrow" : `${SHORTDAY[due.getDay()]} (${d} days out)`;
    bits.push(`${t.dueKind || "Due"} ${when}.`);
  } else if (t._calFlag) {
    const f = t._calFlag, fd = daysBetween(now, new Date(f.start));
    const when = fd === 0 ? "today" : fd === 1 ? "tomorrow"
      : `${SHORTDAY[new Date(f.start).getDay()]}, ${fd} days out`;
    bits.push(`Calendar: “${f.title}” ${when}.`);
  } else {
    bits.push(`<em>No deadline written on this line. Holding your list order (#${t.ord + 1}).</em>`);
  }

  if (position === 0 && (t.due || t._calFlag)) {
    const others = state.tasks.filter(x => x.status === "pending" && x.id !== t.id && effectiveDue(x));
    bits.push(others.length ? "Nearest deadline on the list, so it goes first."
                            : "The only thing on the list with a deadline.");
  }
  if (t.addedAt) bits.push(`<em>You added this at ${fmtClock(new Date(t.addedAt))}.</em>`);
  if (t.estGuessed) bits.push(`<em>${t.est}m is the default — no time was written on the line.</em>`);
  return bits.join(" ");
}

export function briefing(state, now, plan) {
  const left = Math.max(0, (plan.end - now) / MIN);
  const total = state.tasks.length;
  const pend = state.tasks.filter(t => t.status === "pending").length;
  const done = state.tasks.filter(t => t.status === "done").length;
  const planned = plan.segs.filter(s => s.type === "task").length;

  if (!total) return "No list yet. Drop tonight's tasks in and this fills itself — it won't invent any.";
  if (left <= 0) {
    return `Past your bedtime of ${fmtClock(plan.end)}. ` +
      (pend ? `${pend} item${pend === 1 ? "" : "s"} didn't get done; ${pend === 1 ? "it's" : "they're"} still on the list.`
            : "The list is clear.");
  }

  const s = [`<b>${fmtDur(left)}</b> before bedtime at ${fmtClock(plan.end)}.`];
  s.push(state.uploadedAt
    ? `${total} item${total === 1 ? "" : "s"} came in at ${fmtClock(new Date(state.uploadedAt))};`
    : `${total} item${total === 1 ? "" : "s"} on the list;`);
  if (done) s.push(`<b>${done} done</b>,`);
  s.push(`<b>${planned}</b> fit${planned === 1 ? "s" : ""} tonight` +
    (plan.spill.length ? `, <b>${plan.spill.length} ${plan.spill.length === 1 ? "doesn't" : "don't"}</b>.` : "."));

  if (plan.busy.length) {
    const bm = plan.busy.reduce((a, b) => a + (b.e - b.s) / MIN, 0);
    s.push(`Calendar takes ${fmtDur(bm)} out of the middle.`);
  }

  const first = plan.segs.find(x => x.type === "task");
  if (first) {
    const t = first.task;
    if (t.due || t._calFlag) {
      const d = daysBetween(now, effectiveDue(t));
      s.push(`<b>${escapeHtml(t.title)}</b> goes first — ` +
        (d <= 0 ? "it's due today" : d === 1 ? "it's due tomorrow" : `it's the nearest deadline, ${d} days out`) + ".");
    } else {
      s.push(`<b>${escapeHtml(t.title)}</b> goes first — nothing on the list has a deadline, so your own order stands.`);
    }
  }
  if (plan.freeMin >= 20) s.push(`That leaves <b>${fmtDur(plan.freeMin)}</b> free.`);
  return s.join(" ");
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ----------------------------------------------------------- the ledger
   Counted, not asserted. If `invented` is ever non-zero the app is lying
   and the number says so on screen. */

export function ledger(state, plan) {
  const uploaded = state.tasks.filter(t => !t.addedAt).length;
  const added = state.tasks.filter(t => !!t.addedAt).length;
  const accounted = plan.segs.filter(s => s.type === "task").length
    + state.tasks.filter(t => t.status !== "pending").length
    + plan.spill.length;
  return { uploaded, added, accounted, invented: accounted - state.tasks.length };
}

/* ------------------------------------------------------------ defaults */

export function emptyState() {
  return {
    v: 2,
    date: todayKey(),
    tasks: [],
    inbox: [],      // captured material, not yet anything
    reminders: [],  // dated things that surface on a day, not evening work
    map: { nodes: [], edges: [], updatedAt: 0 },  // the context map
    calEvents: [],  // pulled by the extension, shared so the phone has them too
    calAt: 0,
    goals: [],      // Future Me targets
    log: [],        // finished sessions, for history questions and pace
    bedtime: "22:00",
    homeBy: "15:30",
    defaultEst: 30,
    uploadedAt: null,
    active: null,
    updatedAt: Date.now()
  };
}

const LOG_DAYS = 45;
const INBOX_MAX = 60;

/** Strip derived fields, and anything too big to sync, before storing. */
export function serialize(state) {
  const cutoff = todayKey(new Date(Date.now() - LOG_DAYS * 86400000));
  return {
    v: 2,
    date: state.date,
    bedtime: state.bedtime,
    homeBy: state.homeBy || "15:30",
    defaultEst: state.defaultEst,
    uploadedAt: state.uploadedAt ?? null,
    active: state.active ?? null,
    updatedAt: state.updatedAt || Date.now(),
    tasks: (state.tasks || []).map((t, i) => ({
      id: t.id, raw: t.raw, title: t.title, est: t.est, estGuessed: !!t.estGuessed,
      due: t.due ?? null, dueKind: t.dueKind ?? null, dueSrc: t.dueSrc ?? null,
      status: t.status, actual: t.actual ?? null, addedAt: t.addedAt ?? null,
      goalId: t.goalId ?? null, fromInbox: t.fromInbox ?? null,
      ord: t.ord == null ? i : t.ord
    })),
    // `preview` is kept (it's what you see); raw image bytes never sync.
    inbox: (state.inbox || []).slice(-INBOX_MAX).map(c => ({
      id: c.id, kind: c.kind, source: c.source, at: c.at,
      text: (c.text || "").slice(0, 4000),
      preview: (c.preview || "").slice(0, 400),
      status: c.status, candidates: (c.candidates || []).slice(0, 20)
    })),
    reminders: (state.reminders || []).slice(-200).map(r => ({
      id: r.id, text: r.text, at: r.at, time: r.time ?? null, raw: r.raw ?? r.text,
      createdAt: r.createdAt, firedAt: r.firedAt ?? null,
      firedSlots: Array.isArray(r.firedSlots) ? r.firedSlots.slice(-4) : [],
      done: !!r.done
    })),
    map: {
      nodes: ((state.map && state.map.nodes) || []).map(n => ({
        id: n.id, name: n.name, type: n.type, seen: n.seen,
        firstSeen: n.firstSeen, lastSeen: n.lastSeen,
        evidence: (n.evidence || []).slice(0, 6)
      })),
      edges: ((state.map && state.map.edges) || []).map(e => ({
        id: e.id, a: e.a, b: e.b, kind: e.kind, weight: e.weight,
        lastSeen: e.lastSeen ?? null, evidence: (e.evidence || []).slice(0, 6)
      })),
      updatedAt: (state.map && state.map.updatedAt) || 0
    },
    calEvents: (state.calEvents || []).slice(0, 150).map(v => ({
      title: v.title, start: v.start, end: v.end, allDay: !!v.allDay
    })),
    calAt: state.calAt || 0,
    goals: (state.goals || []).map(g => ({
      id: g.id, title: g.title, targetDate: g.targetDate,
      totalMin: g.totalMin, match: g.match, createdAt: g.createdAt, archived: !!g.archived
    })),
    log: (state.log || []).filter(e => e.date >= cutoff)
  };
}

export function hydrate(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return s;
  s.date = raw.date || s.date;
  s.bedtime = raw.bedtime || s.bedtime;
  s.homeBy = raw.homeBy || s.homeBy;
  s.defaultEst = raw.defaultEst || s.defaultEst;
  s.uploadedAt = raw.uploadedAt ?? null;
  s.active = raw.active ?? null;
  s.updatedAt = raw.updatedAt || 0;
  s.tasks = raw.tasks.map((t, i) => ({ ...t, ord: t.ord == null ? i : t.ord }));
  s.inbox = Array.isArray(raw.inbox) ? raw.inbox : [];
  s.reminders = Array.isArray(raw.reminders) ? raw.reminders : [];
  s.calEvents = Array.isArray(raw.calEvents) ? raw.calEvents : [];
  s.calAt = raw.calAt || 0;
  s.map = (raw.map && Array.isArray(raw.map.nodes))
    ? { nodes: raw.map.nodes, edges: Array.isArray(raw.map.edges) ? raw.map.edges : [], updatedAt: raw.map.updatedAt || 0 }
    : { nodes: [], edges: [], updatedAt: 0 };
  s.goals = Array.isArray(raw.goals) ? raw.goals : [];
  s.log = Array.isArray(raw.log) ? raw.log : [];
  return s;
}

/* ------------------------------------------------------------- the log
   Every finished session is written down. This is what makes "what did I
   leave unfinished yesterday" answerable without asking a model. */

export function logFinish(state, task, status, minutes) {
  state.log.push({
    date: todayKey(),
    at: Date.now(),
    taskId: task.id,
    title: task.title,
    status,                       // "done" | "skipped"
    minutes: minutes ?? null,
    est: task.est,
    goalId: task.goalId ?? null
  });
}

/** Everything that was on a day's list and did not get finished. */
export function unfinishedOn(state, dateKey) {
  const touched = new Set(state.log.filter(e => e.date === dateKey && e.status === "done").map(e => e.taskId));
  const seen = state.log.filter(e => e.date === dateKey);
  const out = [];
  for (const e of seen) {
    if (e.status === "skipped" && !touched.has(e.taskId)) out.push({ title: e.title, why: "skipped" });
  }
  // Tasks still pending from that day's list, if that list is still loaded.
  if (state.date === dateKey) {
    for (const t of state.tasks) if (t.status === "pending") out.push({ title: t.title, why: "never started" });
  }
  return out;
}

export function minutesOn(state, dateKey) {
  return state.log
    .filter(e => e.date === dateKey && e.status === "done" && e.minutes)
    .reduce((a, e) => a + e.minutes, 0);
}
