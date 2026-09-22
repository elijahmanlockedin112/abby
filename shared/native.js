/* =====================================================================
   Abby — the native bridge.

   Inside the iOS app, Capacitor injects `window.Capacitor` with its
   plugins already attached, so none of this needs a bundler. On the web
   every function here degrades to the browser equivalent or a no-op,
   which is why the same files run in both places.

   The one thing this unlocks that a web page genuinely cannot do:
   a notification that fires when the app is closed and the phone is
   locked. That is the entire reason the iOS app exists.
   ===================================================================== */

import { fireSlots, fireAt, overdueNote, whenWord, pendingSlot } from "./reminders.js";

const cap = () => (typeof window !== "undefined" && window.Capacitor) || null;

export function isNative() {
  const c = cap();
  return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
}

export function platform() {
  const c = cap();
  return (c && typeof c.getPlatform === "function") ? c.getPlatform() : "web";
}

const plugin = name => {
  const c = cap();
  return (c && c.Plugins && c.Plugins[name]) || null;
};

/* ------------------------------------------------------- notifications */

export async function notificationsAllowed() {
  const LN = plugin("LocalNotifications");
  if (LN) {
    try {
      const r = await LN.checkPermissions();
      return r.display === "granted";
    } catch { return false; }
  }
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted";
}

export async function askNotifications() {
  const LN = plugin("LocalNotifications");
  if (LN) {
    try {
      const r = await LN.requestPermissions();
      return r.display === "granted";
    } catch { return false; }
  }
  if (typeof Notification === "undefined") return false;
  try { return (await Notification.requestPermission()) === "granted"; } catch { return false; }
}

/** iOS wants a stable 32-bit int per notification, not our string ids. */
function numericId(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = ((h << 5) - h + String(str).charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000;
}

/**
 * Hand every future reminder to iOS so the OS fires it whether or not
 * Abby is running. Called after any change to the reminder list.
 */
export async function syncNotifications(state, now = new Date()) {
  const LN = plugin("LocalNotifications");
  if (!LN) return { ok: false, reason: "web" };

  try {
    // Clear what we scheduled before, so edits and deletions take effect.
    const pending = await LN.getPending();
    if (pending && pending.notifications && pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    }

    // One iOS notification per slot, so the 6:40 and the 5pm both land.
    const upcoming = [];
    for (const r of state.reminders || []) {
      if (r.done) continue;
      const already = new Set(r.firedSlots || []);
      fireSlots(r).forEach((ts, i) => {
        if (ts <= now.getTime() || already.has(ts)) return;
        upcoming.push({
          id: numericId(r.id + ":" + i),
          title: r.text,
          body: `Due ${whenWord(r, now)}.`,
          schedule: { at: new Date(ts), allowWhileIdle: true },
          extra: { reminderId: r.id }
        });
      });
      if (upcoming.length >= 60) break;
    }

    if (upcoming.length) await LN.schedule({ notifications: upcoming });
    return { ok: true, scheduled: upcoming.length };
  } catch (e) {
    return { ok: false, reason: "failed", error: (e && e.message) || "" };
  }
}

/** Anything already overdue is shown the moment the app opens. */
export async function flushOverdue(state, now = new Date()) {
  const LN = plugin("LocalNotifications");
  if (!LN) return { ok: false, reason: "web" };
  const late = (state.reminders || []).filter(r => !r.done && pendingSlot(r, now) != null);
  if (!late.length) return { ok: true, shown: 0 };
  try {
    await LN.schedule({
      notifications: late.slice(0, 10).map(r => ({
        id: numericId(r.id + "-late"),
        title: r.text,
        body: overdueNote(r, now) || `Due ${whenWord(r, now)}.`,
        extra: { reminderId: r.id }
      }))
    });
    return { ok: true, shown: late.length };
  } catch { return { ok: false, reason: "failed" }; }
}

export function onNotificationTap(handler) {
  const LN = plugin("LocalNotifications");
  if (!LN || !LN.addListener) return () => {};
  try {
    const h = LN.addListener("localNotificationActionPerformed", ev => {
      const id = ev && ev.notification && ev.notification.extra && ev.notification.extra.reminderId;
      handler(id || null);
    });
    return () => { try { h.then(x => x.remove()); } catch {} };
  } catch { return () => {}; }
}

/* ------------------------------------------------------------- polish */

export async function haptic(style = "medium") {
  const H = plugin("Haptics");
  if (!H) return;
  try { await H.impact({ style }); } catch {}
}

export async function styleStatusBar(dark) {
  const S = plugin("StatusBar");
  if (!S) return;
  try { await S.setStyle({ style: dark ? "DARK" : "LIGHT" }); } catch {}
}

/** Re-check the world when iOS hands the app back after a spell asleep. */
export function onResume(handler) {
  const A = plugin("App");
  if (!A || !A.addListener) {
    if (typeof document !== "undefined") {
      const h = () => { if (document.visibilityState === "visible") handler(); };
      document.addEventListener("visibilitychange", h);
      return () => document.removeEventListener("visibilitychange", h);
    }
    return () => {};
  }
  try {
    const h = A.addListener("appStateChange", s => { if (s.isActive) handler(); });
    return () => { try { h.then(x => x.remove()); } catch {} };
  } catch { return () => {}; }
}
