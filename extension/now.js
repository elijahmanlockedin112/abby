/* =====================================================================
   Locked In — RIGHT NOW.

   One task, one duration, one reason, and the two things after it.
   Every bit of machinery in this project exists so that this screen can
   be three lines long.
   ===================================================================== */

import {
  MIN, SHORTDAY, fmtClock, fmtDur, todayKey, daysBetween,
  buildPlan, effectiveDue, logFinish
} from "../shared/engine.js";
import { openStore } from "../shared/sync.js";
import { fetchCalendar } from "../shared/ics.js";
import { $, initTheme, renderReminderAlert } from "../shared/ui.js";
import { parseReminder, whenWord } from "../shared/reminders.js";

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
const ARRIVAL = "lockedin.arrival";

let store = null, events = [], lastMin = -1;

function go(url) {
  location.href = hasChrome && chrome.runtime ? chrome.runtime.getURL("extension/" + url) : url;
}

function show(id, on) { const e = $(id); if (e) e.hidden = !on; }

function setPrimary(label, cls, fn) {
  const b = $("primary");
  b.hidden = false;
  b.className = (cls || "go") + " nowbtn";
  b.textContent = label;
  b.onclick = fn;
}
function setSecondary(label, fn) {
  const b = $("secondary");
  b.hidden = false;
  b.className = "ghost nowbtn";
  b.textContent = label;
  b.onclick = fn;
}

function render() {
  const now = new Date();
  lastMin = now.getMinutes();
  const state = store.state;
  const plan = buildPlan(state, now, events);

  $("clock").textContent = fmtClock(now);
  renderReminderAlert($("remAlert"), state, now, remHandlers);
  $("primary").hidden = true;
  $("secondary").hidden = true;

  const leftMin = (plan.end - now) / MIN;
  $("left").innerHTML = leftMin > 0
    ? `${fmtDur(leftMin)}<small>until bedtime</small>`
    : `—<small>past bedtime</small>`;

  /* ---- nothing to plan ---- */
  if (!state.tasks.length) {
    $("eyebrow").textContent = "Right now";
    $("task").textContent = "Nothing on tonight's list.";
    $("dur").textContent = "";
    $("why").textContent = "Send it from your phone, or add it here. Nothing gets added for you.";
    show("then", false);
    setPrimary("Add tonight's list", "go", () => go("newtab.html"));
    return;
  }

  if (leftMin <= 0) {
    const pend = state.tasks.filter(t => t.status === "pending").length;
    $("eyebrow").textContent = "Past bedtime";
    $("task").textContent = pend ? "Call it." : "You're done.";
    $("dur").textContent = "";
    $("why").textContent = pend
      ? `${pend} item${pend === 1 ? "" : "s"} didn't get done. They're still on the list for tomorrow.`
      : "The list is clear.";
    show("then", false);
    setSecondary("Full briefing", () => go("newtab.html"));
    return;
  }

  /* ---- mid-session ---- */
  const active = state.active && state.tasks.find(t => t.id === state.active.id);
  if (active && active.status === "pending") {
    const elapsed = (now - state.active.startedAt) / MIN;
    const over = elapsed > active.est;
    $("eyebrow").textContent = over ? "Running over" : "In session";
    $("task").textContent = active.title;
    $("dur").textContent = over
      ? `${fmtDur(elapsed - active.est)} past ${fmtDur(active.est)}`
      : `${fmtDur(active.est - elapsed)} left`;
    $("dur").style.color = over ? "var(--warn)" : "";
    $("why").textContent = `Started at ${fmtClock(new Date(state.active.startedAt))}. ${fmtDur(elapsed)} elapsed.`;
    renderThen(plan, now, 0);
    setPrimary("Done", "fin", () => finish(active.id, "done"));
    setSecondary("Stop without finishing", () => store.commit(s => { s.active = null; }).then(render));
    return;
  }

  /* ---- booked by the calendar ---- */
  const busyNow = plan.segs.find(s => s.type === "busy" && s.s <= now.getTime() && s.e > now.getTime());
  if (busyNow) {
    $("eyebrow").textContent = "Right now";
    $("task").textContent = busyNow.title;
    $("dur").textContent = `until ${fmtClock(new Date(busyNow.e))}`;
    $("dur").style.color = "";
    $("why").textContent = "From your calendar. The plan picks up after this.";
    renderThen(plan, now, -1);
    setSecondary("Full briefing", () => go("newtab.html"));
    return;
  }

  /* ---- the normal case ---- */
  const tasks = plan.segs.filter(s => s.type === "task");
  if (!tasks.length) {
    $("eyebrow").textContent = "Right now";
    $("task").textContent = "You're done for today.";
    $("dur").textContent = "";
    $("why").textContent = plan.spill.length
      ? `${plan.spill.length} item${plan.spill.length === 1 ? "" : "s"} wouldn't fit before bedtime.`
      : "Everything on the list is finished.";
    show("then", false);
    setSecondary("Full briefing", () => go("newtab.html"));
    return;
  }

  const t = tasks[0].task;
  const due = effectiveDue(t);
  $("eyebrow").textContent = "Right now";
  $("task").textContent = t.title;
  $("dur").textContent = fmtDur(t.est);
  $("dur").style.color = "";
  $("why").textContent = due
    ? `${t.dueKind || "Due"} ${daysBetween(now, due) <= 0 ? "today" : daysBetween(now, due) === 1 ? "tomorrow" : SHORTDAY[due.getDay()]}. ` +
      `Nearest deadline on your list.`
    : `No deadline on this one — it's #${t.ord + 1} in the order you wrote.`;

  renderThen(plan, now, 0);
  setPrimary(`▶ Start ${fmtDur(t.est)}`, "go", () => start(t.id));
  setSecondary("Full briefing", () => go("newtab.html"));
}

/** "Then:" and "After that:" — and the honest ending when there's nothing. */
function renderThen(plan, now, skip) {
  const tasks = plan.segs.filter(s => s.type === "task");
  const rest = tasks.slice(skip + 1);
  show("then", true);

  if (!rest.length) {
    $("then1").innerHTML = `You're done for today.`;
    show("then2wrap", false);
    return;
  }
  $("then1").innerHTML =
    `${escape(rest[0].task.title)}<span class="m">${fmtDur(rest[0].task.est)}</span>`;

  if (rest.length > 1) {
    show("then2wrap", true);
    $("then2").innerHTML =
      `${escape(rest[1].task.title)}<span class="m">${fmtDur(rest[1].task.est)}</span>`;
  } else {
    show("then2wrap", true);
    $("then2").innerHTML = `You're done for today.`;
  }
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ------------------------------------------------------------ reminders */

const remHandlers = {
  done: id => store.commit(s => {
    const r = s.reminders.find(x => x.id === id);
    if (r) { r.done = true; r.firedAt = r.firedAt || Date.now(); }
  }).then(render),
  snooze: id => store.commit(s => {
    const r = s.reminders.find(x => x.id === id);
    if (!r) return;
    const d = new Date(); d.setDate(d.getDate() + 1);
    r.at = todayKey(d);
    r.firedAt = null;
  }).then(render)
};

/* -------------------------------------------------------------- actions */

function start(id) {
  store.commit(s => { s.active = { id, startedAt: Date.now() }; }).then(render);
}

function finish(id, how) {
  store.commit(s => {
    const t = s.tasks.find(x => x.id === id);
    if (!t) return;
    let mins = null;
    if (s.active && s.active.id === id) {
      mins = Math.max(1, Math.round((Date.now() - s.active.startedAt) / MIN));
      t.actual = mins;
      s.active = null;
    }
    t.status = how;
    logFinish(s, t, how, mins);
  }).then(render);
}

/* ----------------------------------------------------------------- boot */

(async function boot() {
  initTheme();
  store = await openStore();

  // A different new-tab preference sends you straight to the full page.
  if (store.config.newTabMode === "full") { go("newtab.html"); return; }

  store.onChange(render);
  render();

  if (hasChrome) {
    const got = await chrome.storage.local.get(ARRIVAL);
    const a = got[ARRIVAL] || {};
    if (a.date === todayKey() && a.pending && !a.briefed) {
      $("homeChip").hidden = false;
      $("homeChip").className = "chip acc";
      const name = (store.config.name || "").trim();
      if (name) $("homeChip").textContent = `welcome home, ${name.toLowerCase()}`;
      await chrome.storage.local.set({ [ARRIVAL]: { ...a, pending: false, briefed: true, briefedAt: Date.now() } });
    }
  }

  if (store.config.cloudUrl && store.config.cloudKey) {
    store.pull().then(render);
    store.startPolling(45000);
  }
  if (store.config.icsUrl) {
    const r = await fetchCalendar(store.config.icsUrl, Date.now() - 2 * 3600000, Date.now() + 3 * 86400000);
    if (r.ok) { events = r.events; render(); }
  }

  $("fullBtn").addEventListener("click", () => go("newtab.html"));

  setInterval(() => {
    const now = new Date();
    $("clock").textContent = fmtClock(now);
    if (now.getMinutes() !== lastMin) render();
  }, 1000);
})();
