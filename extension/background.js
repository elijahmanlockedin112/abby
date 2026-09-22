/* =====================================================================
   Locked In — the background worker.

   Two jobs: keep one pinned tab alive, and wake up when something is due.

   It deliberately does NOT own your new tab page. An earlier version
   did, and every new tab turning into a planner is the opposite of
   staying out of the way. A pinned tab sits at the far left of the
   strip as a single favicon, survives restarts, and is one click away
   without ever interrupting anything.
   ===================================================================== */

import { todayKey, hydrate, serialize } from "../shared/engine.js";
import { dueNow, overdueNote, whenWord, nextFireTime, markFired } from "../shared/reminders.js";

const ARRIVAL = "lockedin.arrival";
const STATE = "lockedin.state";
const CFG = "lockedin.config";

async function get(key, fallback) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? fallback;
}

async function cfg() {
  return await get(CFG, { arriveHour: 14, pinTab: true, name: "" });
}

/* ------------------------------------------------------------ the tab
   One pinned tab, reused. Never a second one, and never forced back if
   you deliberately close it — it comes back on the next browser start,
   which is what a pinned tab is supposed to do. */

const NOW_URL = () => chrome.runtime.getURL("extension/now.html");

async function findOurTab() {
  try {
    const tabs = await chrome.tabs.query({});
    const mine = chrome.runtime.getURL("extension/");
    return tabs.find(t => t.url && t.url.startsWith(mine) && !t.url.includes("setup.html")) || null;
  } catch { return null; }
}

async function ensurePinnedTab({ focus = false, create = true } = {}) {
  const c = await cfg();
  if (c.pinTab === false && !focus) return null;

  let tab = await findOurTab();
  try {
    if (tab) {
      if (!tab.pinned && c.pinTab !== false) await chrome.tabs.update(tab.id, { pinned: true });
      if (focus) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return tab;
    }
    if (!create) return null;
    return await chrome.tabs.create({
      url: NOW_URL(),
      pinned: c.pinTab !== false,
      active: focus,
      index: 0
    });
  } catch { return null; }
}

chrome.commands?.onCommand?.addListener(cmd => {
  if (cmd === "open-locked-in") ensurePinnedTab({ focus: true });
});

/** Arm the briefing once per day, the first time you're active after the
 *  arrival hour. Never re-arms the same day, so it can't nag. */
async function checkArrival(reason) {
  const c = await cfg();
  const now = new Date();
  const today = todayKey(now);
  const a = await get(ARRIVAL, {});

  let armedNow = false;
  if (a.date !== today) {
    const armed = now.getHours() >= (c.arriveHour ?? 14);
    armedNow = armed;
    await chrome.storage.local.set({
      [ARRIVAL]: { date: today, pending: armed, briefed: false, notified: false, armedAt: armed ? Date.now() : null, reason }
    });
  } else if (!a.briefed && !a.pending && now.getHours() >= (c.arriveHour ?? 14)) {
    armedNow = true;
    await chrome.storage.local.set({
      [ARRIVAL]: { ...a, pending: true, armedAt: Date.now(), reason }
    });
  }

  if (armedNow) await notifyArrival(c, now);
  await paintBadge();
}

/**
 * The one interruption of the day. It replaced hijacking the new tab:
 * a notification you can ignore beats a page you didn't ask for.
 */
async function notifyArrival(c, now) {
  const a = await get(ARRIVAL, {});
  if (a.notified) return;

  const state = await readState();
  const pending = state.tasks.filter(t => t.status === "pending");
  const stale = state.date !== todayKey(now);
  const name = (c.name || "").trim();

  let message;
  if (stale || !pending.length) {
    message = "No list for tonight yet.";
  } else {
    const first = [...pending].sort((x, y) => x.ord - y.ord)[0];
    message = `${pending.length} thing${pending.length === 1 ? "" : "s"} tonight. ${first.title} first.`;
  }

  try {
    await chrome.notifications.create("lockedin-home", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("extension/icons/icon128.png"),
      title: name ? `Welcome home, ${name}.` : "Welcome home.",
      message,
      contextMessage: "Locked In",
      priority: 1
    });
  } catch { /* notifications off is not a failure */ }

  await chrome.storage.local.set({ [ARRIVAL]: { ...a, notified: true } });
}

/** The badge is the only thing that ever interrupts you: a count, not a nag. */
async function paintBadge() {
  const raw = await get(STATE, null);
  const a = await get(ARRIVAL, {});
  const pending = raw && Array.isArray(raw.tasks)
    ? raw.tasks.filter(t => t.status === "pending").length
    : 0;

  const stale = !raw || raw.date !== todayKey();
  let text = "", color = "#D89A1E";

  const standing = (raw && Array.isArray(raw.reminders) ? raw.reminders : [])
    .filter(r => !r.done && r.firedAt).length;

  if (standing > 0) {
    text = String(standing);
    color = "#AB3434";
  } else if (pending > 0 && !stale) {
    text = String(pending);
    color = a.pending ? "#D89A1E" : "#4B5261";
  } else if (a.pending && stale) {
    text = "·";
    color = "#AB3434";
  }

  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({
      title: stale && pending === 0
        ? "Locked In — no list for today yet"
        : `Locked In — ${pending} item${pending === 1 ? "" : "s"} left tonight`
    });
  } catch { /* badge is cosmetic; never let it break the worker */ }
}

/* =====================================================================
   Reminders.

   This is the only part of Locked In that wakes up by itself, so it's
   the only part that can tell you something you didn't come looking for.

   It checks on a timer and on every browser start. If Chrome wasn't
   running at the moment a reminder came due, it fires the next time
   Chrome opens and says how late it is — that's honest, and it beats
   silently swallowing it.
   ===================================================================== */

async function readState() {
  return hydrate(await get(STATE, null));
}

async function writeState(state) {
  await chrome.storage.local.set({ [STATE]: serialize(state) });
}

async function fireDueReminders() {
  const state = await readState();
  const now = new Date();
  const times = (await cfg()).fireTimes;
  const due = dueNow(state, now, times);
  if (!due.length) { await scheduleNextReminder(state, now, times); return; }

  for (const r of due) {
    const late = overdueNote(r, now);
    try {
      await chrome.notifications.create("lockedin-rem-" + r.id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("extension/icons/icon128.png"),
        title: r.text,
        message: late || `Due ${whenWord(r, now)}.`,
        contextMessage: "Locked In",
        priority: 2,
        requireInteraction: true
      });
    } catch { /* a blocked notification must not lose the reminder */ }
    markFired(r, now, times);
  }

  state.updatedAt = Date.now();
  await writeState(state);
  await scheduleNextReminder(state, now, times);
  await paintBadge();
}

/** Wake exactly when the next one is due, instead of only on the 10-minute tick. */
async function scheduleNextReminder(state, now = new Date(), times) {
  const next = nextFireTime(state, now, times);
  try {
    if (next == null) { await chrome.alarms.clear("reminder"); return; }
    // chrome.alarms has a one-minute floor; anything sooner fires on the next tick.
    const when = Math.max(next, Date.now() + 60000);
    await chrome.alarms.create("reminder", { when });
  } catch { /* the periodic tick is the backstop */ }
}

chrome.notifications?.onClicked?.addListener(async id => {
  if (!id.startsWith("lockedin-")) return;
  await ensurePinnedTab({ focus: true });
  try { await chrome.notifications.clear(id); } catch {}
});

chrome.runtime.onInstalled.addListener(async details => {
  chrome.alarms.create("tick", { periodInMinutes: 10 });
  try { chrome.idle.setDetectionInterval(60); } catch {}
  await checkArrival("installed");
  await fireDueReminders();
  await ensurePinnedTab();

  // First install: open setup rather than dropping someone into an empty
  // new tab with no idea what to do with it.
  if (details.reason === "install") {
    const done = await get("lockedin.setupDone", null);
    if (!done) {
      try { await chrome.tabs.create({ url: chrome.runtime.getURL("extension/setup.html"), active: true }); } catch {}
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("tick", { periodInMinutes: 10 });
  try { chrome.idle.setDetectionInterval(60); } catch {}
  await checkArrival("startup");
  await fireDueReminders();
  await ensurePinnedTab();
});

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === "tick") { checkArrival("alarm"); fireDueReminders(); }
  if (a.name === "reminder") fireDueReminders();
});

// Waking the machine after school is the signal that matters most.
chrome.idle.onStateChanged.addListener(state => {
  if (state === "active") { checkArrival("idle-active"); fireDueReminders(); }
});

// Keep the badge honest when any surface writes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STATE] || changes[ARRIVAL])) paintBadge();
});
