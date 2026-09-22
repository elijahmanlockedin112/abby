/* =====================================================================
   Locked In — the toolbar popup. The same plan, compressed to what you
   need mid-session: what you're on, how long is left, what's next.
   ===================================================================== */

import { MIN, fmtClock, todayKey, makeTask, buildPlan, stripBullet, logFinish } from "../shared/engine.js";
import { openStore } from "../shared/sync.js";
import { fetchCalendar } from "../shared/ics.js";
import {
  $, renderBriefing, renderRail, renderBlocks, initTheme, timerText
} from "../shared/ui.js";

let store = null;
let events = [];
let lastMin = -1;

const byId = id => store.state.tasks.find(t => t.id === id);

function render() {
  const now = new Date();
  lastMin = now.getMinutes();
  const plan = buildPlan(store.state, now, events);

  $("clock").textContent = fmtClock(now);
  renderBriefing({ hdr: $("hdr"), hdrTime: $("hdrTime"), say: $("say") }, store.state, now, plan, false);
  renderRail($("rail"), $("railStart"), $("railEnd"), store.state, now, plan);
  renderBlocks($("blocks"), store.state, now, plan, handlers, {
    compact: true, limit: 3,
    emptyHint: "No list for tonight yet."
  });
}

const handlers = {
  start: id => store.commit(s => { s.active = { id, startedAt: Date.now() }; }).then(render),
  stop: () => store.commit(s => { s.active = null; }).then(render),
  finish: (id, how) => store.commit(s => {
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
  }).then(render)
  // no bump / restore here — the popup stays small on purpose
};

(async function boot() {
  initTheme();
  store = await openStore();
  store.onChange(render);
  render();

  if (store.config.cloudUrl && store.config.cloudKey) {
    store.pull().then(render);
  }
  if (store.config.icsUrl) {
    const r = await fetchCalendar(store.config.icsUrl, Date.now() - 2 * 3600000, Date.now() + 2 * 86400000);
    if (r.ok) { events = r.events; render(); }
  }

  setInterval(() => {
    const now = new Date();
    $("clock").textContent = fmtClock(now);
    if (now.getMinutes() !== lastMin) { render(); return; }
    if (store.state.active) {
      const lt = document.getElementById("liveTimer");
      const at = byId(store.state.active.id);
      if (lt && at) {
        const over = (now - store.state.active.startedAt) / MIN > at.est;
        lt.className = "timer" + (over ? " over" : "");
        lt.textContent = timerText(store.state, at, now);
      }
    }
  }, 1000);

  $("addBtn").addEventListener("click", add);
  $("addBox").addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  // Reuse the pinned tab. Opening a second copy of a planner is how you
  // end up with six of them.
  $("openBtn").addEventListener("click", async () => {
    const target = chrome.runtime.getURL("extension/newtab.html");
    try {
      const mine = chrome.runtime.getURL("extension/");
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find(t => t.url && t.url.startsWith(mine) && !t.url.includes("setup.html"));
      if (existing) {
        await chrome.tabs.update(existing.id, { url: target, active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: target, pinned: true, index: 0 });
      }
    } catch {
      chrome.tabs.create({ url: target });
    }
    window.close();
  });

  async function add() {
    const v = $("addBox").value;
    if (!stripBullet(v)) return;
    await store.commit(s => {
      s.tasks.push(makeTask(v, s.tasks.length, s.defaultEst, new Date(), Date.now()));
      s.date = todayKey();
    });
    $("addBox").value = "";
    render();
  }
})();
