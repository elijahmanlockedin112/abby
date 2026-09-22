/* =====================================================================
   Locked In — the phone.

   What a phone is actually for here:
     3:00, walking out of class   -> Capture
     any time you wonder          -> Now
     checking the shape of it     -> Plan
   ===================================================================== */

import {
  MIN, SHORTDAY, fmtClock, fmtDur, todayKey, daysBetween,
  parseList, makeTask, buildPlan, stripBullet, effectiveDue
} from "../shared/engine.js";
import * as E from "../shared/engine.js";
import { openStore, cloudGet, cloudStatusText } from "../shared/sync.js";
import { fetchCalendar } from "../shared/ics.js";
import { makeAI, PROVIDERS } from "../shared/ai.js";
import {
  makeCapture, extractDeterministic, extractWithModel, mergeCandidates,
  readImage, readPDF, pdfReasonText
} from "../shared/inbox.js";
import { makeGoal } from "../shared/goals.js";
import { parseReminder, whenWord, standing, overdueNote } from "../shared/reminders.js";
import * as A from "../shared/abby.js";
import {
  isNative, syncNotifications, flushOverdue, onNotificationTap,
  onResume, askNotifications, notificationsAllowed, haptic
} from "../shared/native.js";

/* A phone browser can only notify while the page is alive. The extension's
   background worker is what fires when nothing is open — see background.js.
   Fire once per reminder per session; the extension owns `firedAt`. */
const notified = new Set();
function notifyDue(state, now) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const r of standing(state, now)) {
    if (notified.has(r.id)) continue;
    notified.add(r.id);
    try {
      new Notification(r.text, {
        body: overdueNote(r, now) || `Due ${whenWord(r, now)}.`,
        tag: "lockedin-" + r.id
      });
    } catch { /* blocked or unsupported — the in-app alert still shows it */ }
  }
}
import {
  $, renderBriefing, renderRail, renderBlocks, renderSpill, renderLedger,
  renderSource, renderInbox, renderGoals, wireAsk, makeVoicePanel,
  renderReminders, renderReminderAlert, wireNotifyPermission,
  initTheme, RULES_HTML
} from "../shared/ui.js";

let store = null, ai = null, events = [], lastMin = -1, tab = "now";
let lastAck = null;
const who = () => (store && store.config && store.config.name || "").trim();

const ctx = () => ({ state: store.state, now: new Date(), events, ai });

/* --------------------------------------------------------------- render */

function render() {
  const now = new Date();
  lastMin = now.getMinutes();
  const state = store.state;
  const plan = buildPlan(state, now, events);

  $("clock").textContent = fmtClock(now);
  renderNow(state, now, plan);

  renderBriefing({ hdr: $("hdr"), hdrTime: $("hdrTime"), say: $("say") }, state, now, plan, false);
  renderRail($("rail"), $("railStart"), $("railEnd"), state, now, plan);
  renderBlocks($("blocks"), state, now, plan, handlers, { emptyHint: "Nothing sent yet today." });
  renderSpill($("spill"), plan);
  renderLedger($("ledger"), state, plan);
  renderSource($("srclist"), state);
  renderInbox($("inboxList"), state, inboxHandlers);
  renderGoals($("goalList"), state, now, events, goalHandlers);
  renderReminders($("remList"), state, now, remHandlers);
  renderReminderAlert($("remAlert"), state, now, remHandlers);
  notifyDue(state, now);

  const open = (state.inbox || []).filter(c => c.status !== "dismissed" && (c.candidates || []).some(x => !x.accepted)).length;
  $("inboxCount").hidden = !open;
  $("inboxCount").textContent = String(open);
  $("inboxCount").className = "chip acc";

  const st = store.status;
  $("syncChip").hidden = st.cloud === "off";
  $("syncChip").textContent = st.cloud === "ok" ? "synced" : st.cloud === "pending" ? "…" : "sync error";
  $("syncChip").className = "chip " + (st.cloud === "ok" ? "ok" : st.cloud === "error" ? "crit" : "");

  $("planNote").textContent = plan.segs.some(s => s.type === "task") ? `rebuilt from ${fmtClock(now)}` : "";
}

/** The same RIGHT NOW logic as the extension, sized for a thumb. */
function renderNow(state, now, plan) {
  const leftMin = (plan.end - now) / MIN;
  $("nowLeft").innerHTML = leftMin > 0
    ? `${fmtDur(leftMin)}<small>until bedtime</small>`
    : `—<small>past bedtime</small>`;

  const set = (eyebrow, task, dur, why) => {
    $("eyebrow").textContent = eyebrow;
    $("nowTask").textContent = task;
    $("nowDur").textContent = dur;
    $("nowWhy").textContent = why;
  };

  if (!state.tasks.length) {
    set("Right now", "Nothing on tonight's list.", "", "Send it over on the Capture tab.");
    $("nowThen").hidden = true;
    return;
  }
  if (leftMin <= 0) {
    const pend = state.tasks.filter(t => t.status === "pending").length;
    set("Past bedtime", pend ? "Call it." : "You're done.", "",
      pend ? `${pend} item${pend === 1 ? "" : "s"} roll to tomorrow.` : "The list is clear.");
    $("nowThen").hidden = true;
    return;
  }

  const active = state.active && state.tasks.find(t => t.id === state.active.id);
  if (active && active.status === "pending") {
    const elapsed = (now - state.active.startedAt) / MIN;
    const over = elapsed > active.est;
    set(over ? "Running over" : "In session", active.title,
      over ? `${fmtDur(elapsed - active.est)} past ${fmtDur(active.est)}` : `${fmtDur(active.est - elapsed)} left`,
      `Started ${fmtClock(new Date(state.active.startedAt))}.`);
    $("nowDur").style.color = over ? "var(--warn)" : "";
    renderThen(plan, 0);
    return;
  }

  const busyNow = plan.segs.find(s => s.type === "busy" && s.s <= now.getTime() && s.e > now.getTime());
  if (busyNow) {
    set("Right now", busyNow.title, `until ${fmtClock(new Date(busyNow.e))}`, "From your calendar.");
    $("nowDur").style.color = "";
    renderThen(plan, -1);
    return;
  }

  const tasks = plan.segs.filter(s => s.type === "task");
  if (!tasks.length) {
    set("Right now", "You're done for today.", "",
      plan.spill.length ? `${plan.spill.length} didn't fit before bedtime.` : "Everything on the list is finished.");
    $("nowThen").hidden = true;
    return;
  }

  const t = tasks[0].task;
  const due = effectiveDue(t);
  set("Right now", t.title, fmtDur(t.est),
    due ? `${t.dueKind || "Due"} ${daysBetween(now, due) <= 0 ? "today" : daysBetween(now, due) === 1 ? "tomorrow" : SHORTDAY[due.getDay()]}. Nearest deadline on your list.`
        : `No deadline on this one — it's #${t.ord + 1} in the order you wrote.`);
  $("nowDur").style.color = "";
  renderThen(plan, 0);
}

function renderThen(plan, skip) {
  const rest = plan.segs.filter(s => s.type === "task").slice(skip + 1);
  $("nowThen").hidden = false;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  if (!rest.length) {
    $("then1").textContent = "You're done for today.";
    $("then2wrap").hidden = true;
    return;
  }
  $("then1").innerHTML = `${esc(rest[0].task.title)}<span class="m">${fmtDur(rest[0].task.est)}</span>`;
  $("then2wrap").hidden = false;
  $("then2").innerHTML = rest.length > 1
    ? `${esc(rest[1].task.title)}<span class="m">${fmtDur(rest[1].task.est)}</span>`
    : "You're done for today.";
}

function setTab(name) {
  tab = name;
  for (const [b, v, n] of [["tabNow", "viewNow", "now"], ["tabCapture", "viewCapture", "capture"],
                           ["tabPlan", "viewPlan", "plan"], ["tabSetup", "viewSetup", "setup"]]) {
    $(b).setAttribute("aria-selected", n === name ? "true" : "false");
    $(v).hidden = n !== name;
  }
  $("stickybar").hidden = name !== "capture";
  scrollTo({ top: 0, behavior: "instant" });
}

/* -------------------------------------------------------------- actions */

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
    E.logFinish(s, t, how, mins);
    lastAck = how === "done" ? A.ackDone(t, mins, who()) : null;
  }).then(() => { haptic("light"); render(); }),
  restore: id => store.commit(s => {
    const t = s.tasks.find(x => x.id === id);
    if (t) { t.status = "pending"; t.actual = null; }
    s.log = s.log.filter(e => e.taskId !== id);
  }).then(render)
};

const goalHandlers = {
  addTask(goalId) {
    const g = store.state.goals.find(x => x.id === goalId);
    if (!g) return;
    return store.commit(s => {
      const t = makeTask(g.title, s.tasks.length, 45, new Date(), Date.now());
      t.goalId = g.id;
      s.tasks.push(t);
      s.date = todayKey();
    }).then(render);
  },
  archive(goalId) {
    return store.commit(s => {
      const g = s.goals.find(x => x.id === goalId);
      if (g) g.archived = true;
    }).then(render);
  }
};


/* ------------------------------------------------------------ reminders */

const remHandlers = {
  done: id => store.commit(s => {
    const r = s.reminders.find(x => x.id === id);
    if (r) { r.done = true; r.firedAt = r.firedAt || Date.now(); }
  }).then(render),
  remove: id => store.commit(s => {
    s.reminders = s.reminders.filter(x => x.id !== id);
  }).then(render),
  snooze: id => store.commit(s => {
    const r = s.reminders.find(x => x.id === id);
    if (!r) return;
    const d = new Date(); d.setDate(d.getDate() + 1);
    r.at = todayKey(d);
    r.firedAt = null;
  }).then(render)
};

async function addReminder(line) {
  const m = $("remMsg");
  m.hidden = false;
  const r = parseReminder(line, new Date());
  if (!r) {
    m.className = "msg err";
    m.textContent = "No date in that. Try “cancel spotify on November 30”, “pay dues Friday”, or “in 2 weeks”.";
    return false;
  }
  await store.commit(s => { s.reminders.push(r); });
  m.className = "msg";
  m.textContent = `Set: ${r.text} — ${whenWord(r, new Date())}.`;
  render();
  return true;
}

/* ---------------------------------------------------------------- inbox */

function capMsg(text, bad) {
  const m = $("capMsg");
  m.hidden = false;
  m.className = "msg" + (bad ? " err" : "");
  m.textContent = text;
}

async function addCapture(cap) {
  await store.commit(s => { s.inbox.push(cap); });
  render();
  return cap.id;
}

const inboxHandlers = {
  async extract(capId) {
    const cap = store.state.inbox.find(c => c.id === capId);
    if (!cap) return;
    const now = new Date();
    const ruleCands = extractDeterministic(cap, now);
    let modelCands = [], dropped = 0, err = null;
    if (ai.hasKey()) {
      capMsg("Reading it…");
      const r = await extractWithModel(cap, ai, now);
      modelCands = r.candidates; dropped = r.dropped; err = r.error;
    }
    await store.commit(s => {
      const c = s.inbox.find(x => x.id === capId);
      if (!c) return;
      c.candidates = mergeCandidates(ruleCands, modelCands);
      c.droppedCount = dropped;
      c.status = "extracted";
    });
    render();
    if (err) capMsg(err, true);
    else if (dropped) capMsg(`${dropped} thrown out for quoting something that isn't there.`);
    else $("capMsg").hidden = true;
  },

  accept(capId, candId) {
    return store.commit(s => {
      const c = s.inbox.find(x => x.id === capId);
      const cd = c && c.candidates.find(x => x.id === candId);
      if (!cd || cd.accepted) return;
      const t = makeTask(cd.title, s.tasks.length, s.defaultEst, new Date(), Date.now());
      if (cd.est) { t.est = cd.est; t.estGuessed = false; }
      if (cd.due) { t.due = cd.due; t.dueKind = cd.dueKind || "Due"; t.dueSrc = "inbox"; }
      t.fromInbox = { capId, source: c.source, quote: cd.quote };
      s.tasks.push(t);
      s.date = todayKey();
      cd.accepted = true;
      if (c.candidates.every(x => x.accepted)) c.status = "filed";
    }).then(render);
  },

  acceptAll(capId) {
    const c = store.state.inbox.find(x => x.id === capId);
    if (!c) return;
    return c.candidates.filter(x => !x.accepted).map(x => x.id)
      .reduce((p, id) => p.then(() => inboxHandlers.accept(capId, id)), Promise.resolve());
  },

  dismiss(capId) {
    return store.commit(s => {
      const c = s.inbox.find(x => x.id === capId);
      if (c) c.status = "dismissed";
    }).then(render);
  }
};

async function ingestFile(file) {
  if (file.type.startsWith("image/")) {
    capMsg(`Reading ${file.name || "photo"}…`);
    const r = await readImage(file, ai);
    if (!r.ok) {
      capMsg(r.reason === "nokey"
        ? "Photos need an API key — there's no OCR on the phone. Add one under Setup."
        : r.reason === "toobig" ? "That photo is over 4.5MB. Try a tighter crop."
        : "Couldn't read that image.", true);
      return;
    }
    if (!r.text) { capMsg("No text found in that photo.", true); return; }
    const id = await addCapture(makeCapture({
      kind: "image", source: file.name || `Photo · ${fmtClock(new Date())}`, text: r.text
    }));
    await inboxHandlers.extract(id);
    return;
  }
  if (/\.pdf$/i.test(file.name || "") || file.type === "application/pdf") {
    capMsg("Opening the PDF…");
    const r = await readPDF(file);
    if (!r.ok) { capMsg(pdfReasonText(r.reason), true); return; }
    const id = await addCapture(makeCapture({ kind: "pdf", source: file.name, text: r.text }));
    await inboxHandlers.extract(id);
    return;
  }
  const text = await file.text();
  if (!text.trim()) { capMsg("That file was empty.", true); return; }
  const id = await addCapture(makeCapture({ kind: "file", source: file.name, text }));
  await inboxHandlers.extract(id);
}

/* ----------------------------------------------------------------- boot */

(async function boot() {
 try {
  initTheme("themeBtn");
  $("rulesList").innerHTML = RULES_HTML;

  store = await openStore();
  ai = makeAI(() => store.config);

  const c = store.config;
  $("cloudUrl").value = c.cloudUrl || "";
  $("cloudKey").value = c.cloudKey || "";
  $("apiKey").value = c.apiKey || "";
  $("model").value = c.model || "";
  if (c.provider === "anthropic") $("provAnthropic").checked = true;
  $("icsUrl").value = c.icsUrl || "";
  $("bedBox").value = store.state.bedtime;
  $("estBox").value = store.state.defaultEst;
  const d14 = new Date(); d14.setDate(d14.getDate() + 14);
  $("gDate").value = todayKey(d14);

  store.onChange(render);
  render();
  setTab("now");

  wireAsk({ input: $("askBox"), askBtn: $("askBtn"), out: $("askOut"), chips: $("askChips") }, ctx);

  if (c.cloudUrl && c.cloudKey) { await store.pull(); store.startPolling(45000); render(); }
  // Google blocks .ics reads from a plain page, so try directly (works in
  // a native build) and otherwise use what the extension already pulled.
  if (c.icsUrl) {
    const r = await fetchCalendar(c.icsUrl, Date.now() - 2 * 3600000, Date.now() + 8 * 86400000);
    if (r.ok) { events = r.events; render(); }
  }
  if (!events.length && (store.state.calEvents || []).length) {
    events = store.state.calEvents;
    render();
  }

  setInterval(() => {
    const now = new Date();
    $("clock").textContent = fmtClock(now);
    if (now.getMinutes() !== lastMin) render();
  }, 1000);

  /* ---- tabs ---- */
  $("tabNow").addEventListener("click", () => setTab("now"));
  $("tabCapture").addEventListener("click", () => setTab("capture"));
  $("tabPlan").addEventListener("click", () => setTab("plan"));
  $("tabSetup").addEventListener("click", () => setTab("setup"));

  /* ---- send the list ---- */
  async function send() {
    const tasks = parseList($("listBox").value, store.state.defaultEst, new Date());
    const m = $("sendMsg");
    m.hidden = false;
    if (!tasks.length) { m.className = "msg err"; m.textContent = "Nothing to send — the box is empty."; return; }
    await store.commit(s => {
      s.tasks = tasks; s.date = todayKey(); s.uploadedAt = Date.now(); s.active = null;
    });
    m.className = "msg";
    m.textContent = store.status.cloud === "ok"
      ? `Sent — ${tasks.length} item${tasks.length === 1 ? "" : "s"}. It's on your PC.`
      : store.status.cloud === "off"
        ? `Saved on this phone — ${tasks.length} item${tasks.length === 1 ? "" : "s"}. Turn on sync in Setup to send it to your PC.`
        : `Saved here, but sync failed. ${store.status.msg}`;
    render();
  }
  $("sendBtn").addEventListener("click", send);
  $("stickyPrimary").addEventListener("click", send);

  $("loadBtn").addEventListener("click", () => {
    $("listBox").value = [...store.state.tasks].sort((a, b) => a.ord - b.ord).map(t => t.raw).join("\n");
    $("listBox").focus();
  });
  $("pullBtn").addEventListener("click", async () => { await store.pull(); render(); });

  const add = async () => {
    const v = $("addBox").value;
    if (!stripBullet(v)) return;
    await store.commit(s => {
      s.tasks.push(makeTask(v, s.tasks.length, s.defaultEst, new Date(), Date.now()));
      s.date = todayKey();
    });
    $("addBox").value = "";
    render();
  };
  $("addBtn").addEventListener("click", add);
  $("addBox").addEventListener("keydown", e => { if (e.key === "Enter") add(); });

  /* ---- capture ---- */
  $("camBtn").addEventListener("click", () => $("camInput").click());
  $("pickBtn").addEventListener("click", () => $("fileInput").click());
  for (const id of ["camInput", "fileInput"]) {
    $(id).addEventListener("change", async e => {
      for (const f of e.target.files) await ingestFile(f);
      e.target.value = "";
    });
  }
  $("noteBtn").addEventListener("click", async () => {
    const text = $("noteBox").value;
    if (!text.trim()) return;
    const id = await addCapture(makeCapture({ kind: "note", source: `Note · ${fmtClock(new Date())}`, text }));
    $("noteBox").value = "";
    await inboxHandlers.extract(id);
  });

  /* ---- voice: the 3:00 flow. Speak it, check it, send it. ---- */
  makeVoicePanel(
    { btn: $("micBtn"), transcript: $("vtext"), lines: $("vlines"), result: $("micResult"), box: $("vbox"), clear: $("micClear") },
    () => ai,
    async (lines, mode) => {
      const tasks = parseList(lines.join("\n"), store.state.defaultEst, new Date());
      if (!tasks.length) return;
      await store.commit(s => {
        if (mode === "replace") {
          s.tasks = tasks;
          s.uploadedAt = Date.now();
          s.active = null;
        } else {
          for (const t of tasks) { t.ord = s.tasks.length; t.addedAt = Date.now(); s.tasks.push(t); }
        }
        s.date = todayKey();
      });
      render();
    }
  );

  /* ---- goals ---- */
  $("gAdd").addEventListener("click", async () => {
    const title = $("gTitle").value.trim();
    const date = $("gDate").value;
    const hours = parseFloat($("gHours").value);
    if (!title || !date || !(hours > 0)) return;
    await store.commit(s => {
      s.goals.push(makeGoal({ title, targetDate: date, totalMin: Math.round(hours * 60) }));
    });
    $("gTitle").value = "";
    render();
  });

  /* ---- setup ---- */
  $("remBtn").addEventListener("click", async () => {
    if (await addReminder($("remBox").value)) $("remBox").value = "";
  });
  $("remBox").addEventListener("keydown", async e => {
    if (e.key === "Enter" && await addReminder($("remBox").value)) $("remBox").value = "";
  });
  wireNotifyPermission($("notifBtn"), $("notifState"));

  $("saveCfg").addEventListener("click", async () => {
    await store.setConfig({ cloudUrl: $("cloudUrl").value.trim(), cloudKey: $("cloudKey").value.trim() });
    $("cfgMsg").className = "msg";
    $("cfgMsg").textContent = "Saved.";
    if (store.config.cloudUrl && store.config.cloudKey) store.startPolling(45000);
    render();
  });
  $("testCloud").addEventListener("click", async () => {
    const m = $("cfgMsg");
    m.className = "msg"; m.textContent = "Checking…";
    const probe = { cloudUrl: $("cloudUrl").value.trim(), cloudKey: $("cloudKey").value.trim() };
    if (!probe.cloudUrl || !probe.cloudKey) { m.className = "msg err"; m.textContent = "Both fields are needed."; return; }
    const got = await cloudGet(probe);
    if (!got.ok) { m.className = "msg err"; m.textContent = cloudStatusText(got.reason, got.status); return; }
    m.textContent = got.data && Array.isArray(got.data.tasks)
      ? `Connected — found a list of ${got.data.tasks.length} from ${got.data.date || "an earlier day"}.`
      : "Connected — nothing stored under this key yet.";
  });
  function paintProvider() {
    const p = $("provOpenai").checked ? "openai" : "anthropic";
    $("provOpenaiL").classList.toggle("on", p === "openai");
    $("provAnthropicL").classList.toggle("on", p === "anthropic");
    $("apiKey").placeholder = PROVIDERS[p].keyHint;
    $("model").placeholder = PROVIDERS[p].defaultModel;
    const cur = $("model").value.trim();
    if (!cur || cur === PROVIDERS.openai.defaultModel || cur === PROVIDERS.anthropic.defaultModel) {
      $("model").value = PROVIDERS[p].defaultModel;
    }
  }
  for (const id of ["provOpenai", "provAnthropic"]) $(id).addEventListener("change", paintProvider);
  paintProvider();

  $("saveKey").addEventListener("click", async () => {
    const provider = $("provOpenai").checked ? "openai" : "anthropic";
    await store.setConfig({
      provider,
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || PROVIDERS[provider].defaultModel
    });
    $("keyMsg").className = "msg";
    $("keyMsg").textContent = $("apiKey").value.trim() ? "Saved on this phone." : "Cleared.";
    render();
  });

  $("testKey").addEventListener("click", async () => {
    const provider = $("provOpenai").checked ? "openai" : "anthropic";
    const probe = makeAI(() => ({
      provider, apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || PROVIDERS[provider].defaultModel
    }));
    const m = $("keyMsg");
    m.className = "msg";
    if (!probe.hasKey()) { m.className = "msg err"; m.textContent = "No key entered."; return; }
    m.textContent = "Checking…";
    try {
      const r = await probe.test();
      m.textContent = `Works — ${PROVIDERS[r.provider].label} ${r.model} answered.`;
    } catch (e) {
      m.className = "msg err";
      m.textContent = e.message || "That didn't work.";
    }
  });
  $("saveIcs").addEventListener("click", async () => {
    await store.setConfig({ icsUrl: $("icsUrl").value.trim() });
    const r = await fetchCalendar(store.config.icsUrl, Date.now(), Date.now() + 8 * 86400000);
    if (r.ok) { events = r.events; render(); }
  });
  $("bedBox").addEventListener("change", async () => {
    await store.commit(s => { s.bedtime = $("bedBox").value || "22:00"; });
    render();
  });
  $("estBox").addEventListener("change", async () => {
    const v = Math.max(5, Math.min(180, parseInt($("estBox").value, 10) || 30));
    $("estBox").value = v;
    await store.commit(s => { s.defaultEst = v; });
    render();
  });

  /* ---- native ---- */
  if (isNative()) {
    document.body.classList.add("native");
    await askNotifications();
    await flushOverdue(store.state);
    await syncNotifications(store.state);
    onNotificationTap(() => { setTab("now"); render(); });
    onResume(async () => {
      await store.pull().catch(() => {});
      await flushOverdue(store.state);
      render();
    });
  } else if (await notificationsAllowed()) {
    // web: nothing to schedule, notifyDue handles it while open
  }

  if (!isNative() && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline cache is a bonus, never required */ });
  }

  window.__abbyBooted = true;
 } catch (err) {
   // There is no console on a phone. Put it on the screen.
   if (window.__abbyFatal) {
     window.__abbyFatal("Abby hit an error starting up.",
       (err && (err.stack || err.message)) || String(err));
   } else {
     throw err;
   }
 }
})();
