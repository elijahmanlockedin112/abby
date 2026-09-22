/* =====================================================================
   Abby — how she talks.

   These are templates, not model output, for three reasons: they're
   instant, they cost nothing, and they can't say something that isn't
   true. Abby only ever tells you what actually happened.

   The tone: someone who was already paying attention. Short. Uses your
   name when it lands, not every line — nothing reads as fake faster
   than an assistant saying your name in every sentence.
   ===================================================================== */

import { fmtDur, fmtClock } from "./engine.js";
import { whenWord } from "./reminders.js";

/** Deterministic per call-site so the same action doesn't reshuffle wording. */
let seq = 0;
const pick = arr => arr[(seq++) % arr.length];

const withName = (s, name) => name ? s.replace("{n}", ", " + name) : s.replace("{n}", "");

/* ------------------------------------------------------------ the lines */

export function ackList(tasks, name, { replaced = true } = {}) {
  const n = tasks.length;
  if (!n) return withName("Nothing in that one{n}.", name);
  const first = [...tasks].sort((a, b) => a.ord - b.ord)[0];
  const total = tasks.reduce((a, t) => a + t.est, 0);

  const opener = pick([
    withName("Got it{n}.", name),
    withName("Got it{n}.", name),
    "Locked in."
  ]);
  return `${opener} ${n} thing${n === 1 ? "" : "s"}, ${fmtDur(total)} of work. ` +
    `${first.title} goes first${replaced ? "" : " once the rest are done"}.`;
}

export function ackAppend(tasks, name) {
  const n = tasks.length;
  return withName(`Added{n}. ${n} more on the list — replanning around ${n === 1 ? "it" : "them"} now.`, name);
}

export function ackReminder(r, name, now = new Date()) {
  return withName(
    pick([
      `Got it{n}. ${r.text} — ${whenWord(r, now)}. I'll tell you.`,
      `Noted{n}. I'll bring up ${r.text.toLowerCase()} ${whenWord(r, now)}.`
    ]),
    name
  );
}

export function ackCapture(cap, found, dropped, name) {
  if (!found) {
    return withName("Read it{n} — nothing in there looked like work you have to do.", name);
  }
  const base = withName(
    pick([`Read it{n}.`, withName("Got it{n}.", name), "Read it."]),
    name
  );
  return `${base} ${found} thing${found === 1 ? "" : "s"} worth a look — nothing goes on your list until you say so.` +
    (dropped ? ` (Threw out ${dropped} that didn't quote your own material.)` : "");
}

export function ackVoice(lines, by, dropped, name) {
  const n = lines.length;
  if (!n) return withName("Didn't catch anything usable{n} — try again a bit slower?", name);
  return withName(
    `Heard you{n}. ${n} thing${n === 1 ? "" : "s"}${by === "model" ? "" : ""}. ` +
    `Check I got the wording right, then send it.`,
    name
  ) + (dropped ? ` (Dropped ${dropped} that didn't match what you said.)` : "");
}

export function ackStart(task, name) {
  return withName(
    pick([
      `${fmtDur(task.est)} on ${task.title}. Go.`,
      `Clock's running{n} — ${fmtDur(task.est)} on ${task.title}.`
    ]),
    name
  );
}

export function ackDone(task, mins, name) {
  if (mins == null) return withName("Done{n}.", name);
  const diff = mins - task.est;
  if (Math.abs(diff) < 5) return withName(`Done{n} — right on your ${fmtDur(task.est)}.`, name);
  if (diff < 0) return withName(`Done{n}, ${fmtDur(-diff)} early. Rest of the evening just moved up.`, name);
  return withName(`Done{n} — ${fmtDur(diff)} over. Rebuilt the rest around it.`, name);
}

export function ackGoal(goal, name) {
  return withName(`Tracking it{n}. ${fmtDur(goal.totalMin)} by ${goal.targetDate}. I'll tell you when you fall behind.`, name);
}

export function ackMap(nodes, edges, name) {
  if (!nodes) return withName("Nothing nameable in there yet{n}.", name);
  return withName(`Mapped it{n}. ${nodes} thing${nodes === 1 ? "" : "s"}, ${edges} connection${edges === 1 ? "" : "s"} — all traced back to your own words.`, name);
}

/* ---------------------------------------------------------- the greeting */

export function greeting(state, now, plan, name) {
  const h = now.getHours();
  const time = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  const pending = state.tasks.filter(t => t.status === "pending").length;

  if (!state.tasks.length) {
    return withName(`${time}{n}. Nothing on tonight's list yet.`, name);
  }
  if (plan.end <= now) {
    return withName(pending
      ? `That's the night{n}. ${pending} left over for tomorrow.`
      : `That's the night{n}. List's clear.`, name);
  }
  if (!pending) return withName(`All done{n}. ${fmtDur((plan.end - now) / 60000)} to yourself.`, name);

  return withName(`${time}{n}. ${pending} thing${pending === 1 ? "" : "s"} and ${fmtDur((plan.end - now) / 60000)} to do ${pending === 1 ? "it" : "them"} in.`, name);
}

export function homeGreeting(state, name, hour) {
  const pending = state.tasks.filter(t => t.status === "pending").length;
  const h12 = `${hour % 12 || 12}${hour >= 12 ? "pm" : "am"}`;
  const opener = name ? `Welcome home, ${name}.` : "Welcome home.";
  if (!pending) return `${opener} Nothing on the list yet — send it over when you know.`;
  const first = [...state.tasks.filter(t => t.status === "pending")].sort((a, b) => a.ord - b.ord)[0];
  return `${opener} First time you've been on since ${h12}. ${pending} thing${pending === 1 ? "" : "s"} tonight — ${first.title} first.`;
}

/** A line for the encryption state, because vagueness here is worse than silence. */
export function privacyLine(encrypted, syncOn) {
  if (!syncOn) return "Everything stays on this device. Nothing is sent anywhere.";
  if (encrypted) return "Encrypted before it leaves this device. The database holds ciphertext — no one can read it without your passphrase, including whoever hosts it.";
  return "Sync is on but NOT encrypted. Set a passphrase so what leaves this device is unreadable.";
}
