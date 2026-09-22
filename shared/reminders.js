/* =====================================================================
   Locked In — reminders.

   "cancel spotify subscription on november 30" and on November 30 you
   get told. That's a different animal from a task: it isn't work to
   schedule into an evening, it's a thing that has to surface on a day.
   So it lives in its own lane and never touches the evening plan.

   The firing itself is in the extension's background worker, because
   that is the only part of this that can wake up on its own.
   ===================================================================== */

import { uid, todayKey, dayStart, daysBetween, parseDatePhrase, MONTHS, SHORTDAY } from "./engine.js";

/* Two chances, because one is easy to miss:
     06:40 — before you leave the house at 7, while you can still grab a thing
     17:00 — home and settled, while you can still act on it
   A reminder that names its own time uses that instead. */
export const DEFAULT_FIRE_TIMES = ["06:40", "17:00"];
export const DEFAULT_FIRE_TIME = DEFAULT_FIRE_TIMES[0];

export function makeReminder({ text, at, time, raw }) {
  return {
    id: uid(),
    text: String(text || "").trim(),
    at,                                  // "YYYY-MM-DD"
    time: time || null,                  // "HH:MM" or null -> fires at the default
    raw: raw ?? text,
    createdAt: Date.now(),
    firedAt: null,
    firedSlots: [],      // which of the day's slots have already shown
    done: false
  };
}

/** Words that mark a line as a reminder rather than tonight's work. */
const REMIND_RE = /\b(?:remind me(?:\s+to)?|reminder|don'?t forget(?:\s+to)?|remember(?:\s+to)?)\b/i;

export function looksLikeReminder(line, now = new Date()) {
  if (REMIND_RE.test(line)) return true;
  const hit = parseDatePhrase(line, now);
  if (!hit) return false;
  // A dated thing with no work in it, more than a week out, is a reminder —
  // nobody blocks out evening time for "cancel Spotify".
  const d = daysBetween(now, hit.date);
  const hasDuration = /\b\d+\s*(?:m|h|min|mins|minutes?|hours?)\b/i.test(line);
  return d > 7 && !hasDuration;
}

/**
 * "remind me to cancel spotify subscription on november 30 at 9am"
 *   -> { text: "Cancel spotify subscription", at: "2026-11-30", time: "09:00" }
 * @returns {object|null}
 */
/**
 * A bare time with no day — "remind me at 4pm to call mom".
 * Means today if it hasn't passed yet, otherwise tomorrow.
 */
function parseTimeOnly(text, now) {
  const m = String(text).match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
         || String(text).match(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (!m) return null;

  let h = parseInt(m[1], 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;

  const when = new Date(now);
  when.setHours(h, mi, 0, 0);
  if (when <= now) when.setDate(when.getDate() + 1);

  const hh = String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  return { date: when, time: hh, matched: m[0], index: m.index };
}

export function parseReminder(line, now = new Date()) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const hit = parseDatePhrase(raw, now) || parseTimeOnly(raw, now);
  if (!hit) return null;

  // Cut the date phrase out, then the "remind me to" preamble, then tidy.
  let text = (raw.slice(0, hit.index) + " " + raw.slice(hit.index + hit.matched.length))
    .replace(/\s{2,}/g, " ")
    .trim();
  text = text.replace(REMIND_RE, "").trim();
  text = text.replace(/^(?:to|that|about)\s+/i, "").trim();
  text = text.replace(/[\s,]*\b(?:on|by|at|before)\s*$/i, "").trim();
  text = text.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();

  if (!text) return null;
  return makeReminder({
    text: text.charAt(0).toUpperCase() + text.slice(1),
    at: todayKey(hit.date),
    time: hit.time,
    raw
  });
}

/* ------------------------------------------------------------- firing */

function slotAt(dateKey, hhmm) {
  const [h, m] = String(hhmm).split(":");
  const d = new Date(dateKey + "T00:00:00");
  d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, 0, 0);
  return d.getTime();
}

/** Every moment this reminder could surface, earliest first. */
export function fireSlots(r, fireTimes) {
  const times = r.time ? [r.time] : (fireTimes && fireTimes.length ? fireTimes : DEFAULT_FIRE_TIMES);
  return times.map(t => slotAt(r.at, t)).sort((a, b) => a - b);
}

/** The first moment it could surface — used for sorting and for wording. */
export function fireAt(r, fireTimes) {
  return fireSlots(r, fireTimes)[0];
}

/**
 * The slot that should fire right now, or null.
 * If several have passed unfired (set it this morning, looking at 6pm),
 * that's the LATEST one — so a missed morning and a due evening are one
 * notification, not a pile of them.
 */
export function pendingSlot(r, now = new Date(), fireTimes) {
  const slots = fireSlots(r, fireTimes);
  const already = new Set(r.firedSlots || []);

  // Reminders saved before slots existed only have `firedAt`. Everything
  // that had already passed by then was covered by that one notification,
  // so don't resurrect it as a second alert now.
  // (An empty array is truthy, so check length — not just presence.)
  if (!already.size && r.firedAt) {
    for (const ts of slots) if (ts <= r.firedAt) already.add(ts);
  }

  const passed = slots.filter(ts => ts <= now.getTime() && !already.has(ts));
  return passed.length ? passed[passed.length - 1] : null;
}

/** Mark everything already passed as handled, so it can't re-fire. */
export function markFired(r, now = new Date(), fireTimes) {
  const set = new Set(r.firedSlots || []);
  for (const ts of fireSlots(r, fireTimes)) if (ts <= now.getTime()) set.add(ts);
  r.firedSlots = [...set].sort((a, b) => a - b);
  r.firedAt = Date.now();
  return r;
}

/** Everything with a slot that has come due and not been shown yet. */
export function dueNow(state, now = new Date(), fireTimes) {
  return (state.reminders || [])
    .filter(r => !r.done && pendingSlot(r, now, fireTimes) != null)
    .sort((a, b) => fireAt(a, fireTimes) - fireAt(b, fireTimes));
}

/** Already fired but not dismissed — still worth showing on screen. */
export function standing(state, now = new Date()) {
  return (state.reminders || [])
    .filter(r => !r.done && fireAt(r) <= now.getTime())
    .sort((a, b) => fireAt(a) - fireAt(b));
}

export function upcoming(state, now = new Date(), days = 60) {
  const limit = now.getTime() + days * 86400000;
  return (state.reminders || [])
    .filter(r => !r.done && fireAt(r) > now.getTime() && fireAt(r) <= limit)
    .sort((a, b) => fireAt(a) - fireAt(b));
}

/** The next moment anything needs to fire, or null. For scheduling a wake-up. */
export function nextFireTime(state, now = new Date(), fireTimes) {
  const future = [];
  for (const r of state.reminders || []) {
    if (r.done) continue;
    const already = new Set(r.firedSlots || []);
    for (const ts of fireSlots(r, fireTimes)) {
      if (ts > now.getTime() && !already.has(ts)) future.push(ts);
    }
  }
  future.sort((a, b) => a - b);
  return future.length ? future[0] : null;
}

/* ---------------------------------------------------------- wording */

export function whenWord(r, now = new Date()) {
  const d = new Date(r.at + "T00:00:00");
  const diff = daysBetween(now, d);
  const time = r.time ? " at " + fmt12(r.time) : "";

  if (diff === 0) return "today" + time;
  if (diff === 1) return "tomorrow" + time;
  if (diff === -1) return "yesterday" + time;
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  if (diff < 7) return SHORTDAY[d.getDay()] + time;
  return `${MONTHS[d.getMonth()].slice(0, 3).replace(/^./, c => c.toUpperCase())} ${d.getDate()}${time}`;
}

export function fmt12(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
}

/** One line for a fired reminder, including how late it is. */
export function overdueNote(r, now = new Date()) {
  const late = daysBetween(new Date(r.at + "T00:00:00"), now);
  if (late <= 0) return "";
  return late === 1 ? "This was due yesterday." : `This was due ${late} days ago.`;
}
