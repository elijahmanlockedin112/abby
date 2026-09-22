/* =====================================================================
   Locked In — the full briefing. Everything the RIGHT NOW screen hides.
   ===================================================================== */

import { MIN, fmtClock, todayKey, parseList, makeTask, buildPlan, stripBullet, escapeHtml } from "../shared/engine.js";
import * as E from "../shared/engine.js";
import { openStore } from "../shared/sync.js";
import { fetchCalendar, calStatusText } from "../shared/ics.js";
import { makeAI } from "../shared/ai.js";
import {
  makeCapture, extractDeterministic, extractWithModel, mergeCandidates,
  readImage, readPDF, pdfReasonText
} from "../shared/inbox.js";
import { fetchGitHub, githubCapture, ghReasonText, openTabsCapture } from "../shared/sources.js";
import { makeGoal } from "../shared/goals.js";
import { parseReminder, whenWord } from "../shared/reminders.js";
import { observeLine, observeState, observeWithModel, forget as forgetNode } from "../shared/contextmap.js";
import {
  $, el, renderBriefing, renderRail, renderBlocks, renderSpill, renderLedger,
  renderSource, renderCal, renderInbox, renderGoals, wireAsk, makeVoicePanel,
  renderReminders, renderReminderAlert, makeMapPanel, mapLegend,
  initTheme, timerText, RULES_HTML
} from "../shared/ui.js";

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
const ARRIVAL = "lockedin.arrival";

let store = null, ai = null;
let cal = { state: "idle", events: [], msg: "", at: null };
let homeMode = false, lastMin = -1, tab = "tonight";
let mapPanel = null;

const byId = id => store.state.tasks.find(t => t.id === id);
const splitLines = txt => String(txt || "").split(NEWLINE);
const NEWLINE = /\r?\n/;
const ctx = () => ({ state: store.state, now: new Date(), events: cal.events, ai });

/* --------------------------------------------------------------- render */

function render() {
  const now = new Date();
  lastMin = now.getMinutes();
  const state = store.state;
  const plan = buildPlan(state, now, cal.events);

  $("clock").textContent = fmtClock(now);
  renderBriefing({ hdr: $("hdr"), hdrTime: $("hdrTime"), say: $("say") }, state, now, plan, homeMode);
  renderRail($("rail"), $("railStart"), $("railEnd"), state, now, plan);
  renderBlocks($("blocks"), state, now, plan, handlers, {
    emptyHint: "Paste tonight's list, send it from your phone, or accept a candidate from the Inbox."
  });
  renderSpill($("spill"), plan);
  renderLedger($("ledger"), state, plan);
  renderSource($("srclist"), state);
  renderCal($("calBody"), cal, state);
  renderInbox($("inboxList"), state, inboxHandlers);
  renderGoals($("goalList"), state, now, cal.events, goalHandlers);
  renderReminders($("remList"), state, now, remHandlers);
  renderReminderAlert($("remAlert"), state, now, remHandlers);

  const open = (state.inbox || []).filter(c => c.status !== "dismissed" && (c.candidates || []).some(x => !x.accepted)).length;
  $("inboxCount").hidden = !open;
  $("inboxCount").textContent = String(open);
  $("inboxCount").className = "chip acc";

  const chip = $("srcChip");
  chip.textContent = state.tasks.length
    ? `${state.tasks.length} items · ${state.uploadedAt ? fmtClock(new Date(state.uploadedAt)) : "saved"}`
    : "no list yet";
  chip.className = "chip" + (state.tasks.length ? " acc" : "");

  const st = store.status;
  $("syncChip").hidden = st.cloud === "off";
  $("syncChip").textContent = st.cloud === "ok"
    ? (store.live ? "live" : "synced")
    : st.cloud === "pending" ? "syncing…" : "sync error";
  $("syncChip").className = "chip " + (st.cloud === "ok" ? "ok" : st.cloud === "error" ? "crit" : "");
  $("syncMsg").textContent = st.cloud === "off"
    ? "Not linked to your phone. Options → Link your devices — paste the code, or copy this browser's."
    : st.msg || (st.cloud === "ok" ? "Linked — same list as your phone." : "");
  $("syncMsg").style.color = st.cloud === "off" ? "var(--warn)" : "";
  $("pullBtn").hidden = st.cloud === "off";

  $("planNote").textContent = plan.segs.some(s => s.type === "task") ? `rebuilt from ${fmtClock(now)}` : "";
  $("aiState").textContent = ai.hasKey()
    ? `A key is set (${ai.model()}). Screenshots are transcribed by the model; it may also propose candidates the rules miss, and every one of those must quote your material verbatim or it's thrown out.`
    : "No API key set, so screenshots can't be read — there's no local OCR. Text, PDFs with a text layer, GitHub and tabs all still work through the rules pass. Add a key in Options to turn on image reading.";

  const stale = state.date !== todayKey() && state.tasks.length > 0;
  $("staleBanner").hidden = !stale;
  if (stale) $("staleTxt").innerHTML = `<b>This list is from ${state.date}.</b> It's kept as-is until you replace it.`;
}

function setTab(name) {
  tab = name;
  for (const [id, view, key] of [
    ["tabTonight", "viewTonight", "tonight"],
    ["tabInbox", "viewInbox", "inbox"],
    ["tabGoals", "viewGoals", "goals"],
    ["tabMap", "viewMap", "map"]
  ]) {
    const on = key === name;
    $(id).setAttribute("aria-selected", on ? "true" : "false");
    $(view).hidden = !on;
  }
  if (name === "map" && mapPanel) { mapPanel.refresh(); mapPanel.reheat(); }
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
  }).then(render),

  restore: id => store.commit(s => {
    const t = s.tasks.find(x => x.id === id);
    if (t) { t.status = "pending"; t.actual = null; }
    s.log = s.log.filter(e => e.taskId !== id);
  }).then(render),

  bump: (id, delta) => store.commit(s => {
    const t = s.tasks.find(x => x.id === id);
    if (t) { t.est = Math.max(5, Math.min(300, t.est + delta)); t.estGuessed = false; }
  }).then(render)
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
  await store.commit(s => {
    s.reminders.push(r);
    observeLine(s.map, r.raw || r.text, "reminder");
  });
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
  await store.commit(s => {
    s.inbox.push(cap);
    for (const line of splitLines(cap.text).slice(0, 40)) {
      if (line.trim()) observeLine(s.map, line, cap.source || cap.kind);
    }
  });
  setTab("inbox");
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
    else if (dropped) capMsg(`${dropped} suggestion${dropped === 1 ? "" : "s"} were thrown out for quoting something that isn't in the source.`);
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
    const ids = c.candidates.filter(x => !x.accepted).map(x => x.id);
    return ids.reduce((p, id) => p.then(() => inboxHandlers.accept(capId, id)), Promise.resolve());
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
    capMsg(`Reading ${file.name}…`);
    const r = await readImage(file, ai);
    if (!r.ok) {
      capMsg(r.reason === "nokey"
        ? "Screenshots need an API key — there's no local OCR. Add one in Options."
        : r.reason === "toobig" ? "That image is over 4.5MB. Crop it or screenshot a smaller region."
        : "Couldn't read that image." + (r.error ? " " + r.error : ""), true);
      return;
    }
    if (!r.text) { capMsg("No text found in that image.", true); return; }
    const id = await addCapture(makeCapture({ kind: "image", source: file.name, text: r.text }));
    capMsg(`Read ${file.name}.`);
    await inboxHandlers.extract(id);
    return;
  }

  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    capMsg(`Opening ${file.name}…`);
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

/* ---------------------------------------------------------------- goals */

const goalHandlers = {
  addTask(goalId) {
    const g = store.state.goals.find(x => x.id === goalId);
    if (!g) return;
    return store.commit(s => {
      const t = makeTask(g.title, s.tasks.length, 45, new Date(), Date.now());
      t.goalId = g.id;
      s.tasks.push(t);
      s.date = todayKey();
    }).then(() => { setTab("tonight"); render(); });
  },
  archive(goalId) {
    return store.commit(s => {
      const g = s.goals.find(x => x.id === goalId);
      if (g) g.archived = true;
    }).then(render);
  },
  edit(goalId) {
    const g = store.state.goals.find(x => x.id === goalId);
    if (!g) return;
    $("gTitle").value = g.title;
    $("gDate").value = g.targetDate;
    $("gHours").value = String(Math.round((g.totalMin / 60) * 2) / 2);
    $("gMatch").value = g.match;
    goalHandlers.archive(goalId);
    $("gTitle").focus();
  }
};

/* ------------------------------------------------------------ the map */

function mapMsg(text, bad) {
  const m = $("mapMsg");
  m.hidden = false;
  m.className = "msg" + (bad ? " err" : "");
  m.textContent = text;
}

const mapHandlers = {
  forget: id => store.commit(s => { forgetNode(s.map, id); })
    .then(() => { mapPanel.focus(null); mapPanel.refresh(); })
};

async function rescanMap() {
  mapMsg("Reading back through everything…");
  let counted = { nodes: 0, edges: 0 };
  await store.commit(s => { counted = observeState(s.map, s); });
  mapPanel.refresh();
  const m = store.state.map;
  mapMsg(m.nodes.length
    ? `${m.nodes.length} thing${m.nodes.length === 1 ? "" : "s"} and ${m.edges.length} connection${m.edges.length === 1 ? "" : "s"}, all traced to something you wrote.`
    : "Nothing nameable in there yet — add a list or a note first.");
}

async function deepenMap() {
  if (!ai.hasKey()) return;
  const s = store.state;
  const material = [
    ...s.tasks.map(t => t.raw || t.title),
    ...s.reminders.map(r => r.raw || r.text),
    ...s.goals.map(g => g.title),
    ...(s.inbox || [])
      .filter(c => c.status !== "dismissed")
      .flatMap(c => splitLines(c.text).slice(0, 25))
  ].filter(x => x && x.trim()).slice(-120).join("\n");

  if (!material.trim()) { mapMsg("Nothing to read yet.", true); return; }
  mapMsg("Asking " + ai.providerLabel() + " to find connections the rules missed…");

  // observeWithModel mutates the map in place, so run it first and then
  // persist — commit takes a synchronous mutator.
  const res = await observeWithModel(store.state.map, material, "ai", ai);
  await store.commit(st => { st.map = { ...st.map }; });

  mapPanel.refresh();
  if (res.error) { mapMsg(res.error, true); return; }
  mapMsg(res.added
    ? "Added " + res.added + " connection" + (res.added === 1 ? "" : "s") +
      (res.dropped ? ", threw out " + res.dropped + " that didn't quote your own words." : ", each quoting your own words.")
    : (res.dropped ? "Nothing survived the quote check — " + res.dropped + " thrown out." : "Nothing new found."));
}

/* ------------------------------------------------------------- calendar */

async function loadCalendar() {
  const cfg = store.config;
  if (!cfg.icsUrl) {
    cal = { state: "error", events: [], msg: calStatusText("off"), at: null };
    render(); return;
  }
  cal = { ...cal, state: "loading" };
  render();
  const r = await fetchCalendar(cfg.icsUrl, Date.now() - 2 * 3600000, Date.now() + 8 * 86400000);
  if (r.ok) {
    cal = { state: "ok", events: r.events, msg: "", at: Date.now() };
    // Share it: the phone can't fetch Google directly, so this is how it
    // learns about blocked time.
    await store.commit(s => {
      s.calEvents = r.events.slice(0, 150);
      s.calAt = Date.now();
    });
  } else {
    // Fall back to whatever the last successful pull left in the state.
    const shared = store.state.calEvents || [];
    cal = shared.length
      ? { state: "ok", events: shared, msg: "", at: store.state.calAt || null }
      : { state: "error", events: [], msg: calStatusText(r.reason, r.status), at: null };
  }
  render();
}

/* -------------------------------------------------------------- arrival */

async function checkArrival() {
  if (!hasChrome) return;
  const got = await chrome.storage.local.get(ARRIVAL);
  const a = got[ARRIVAL] || {};
  if (a.date === todayKey() && a.pending && !a.briefed) {
    homeMode = true;
    const name = (store.config.name || "").trim();
    const h = store.config.arriveHour ?? 14;
    $("homeTxt").innerHTML = `<b>Welcome home${name ? ", " + escapeHtml(name) : ""}.</b> ` +
      `First time you've been on here since ${h % 12 || 12}${h >= 12 ? "pm" : "am"} today — here's the evening.`;
    $("homeBanner").hidden = false;
    await chrome.storage.local.set({ [ARRIVAL]: { ...a, pending: false, briefed: true, briefedAt: Date.now() } });
  }
}

/* ----------------------------------------------------------------- boot */

(async function boot() {
  initTheme("themeBtn");
  $("rulesList").innerHTML = RULES_HTML;

  store = await openStore();
  ai = makeAI(() => store.config);

  $("bedBox").value = store.state.bedtime;
  $("estBox").value = store.state.defaultEst;
  const d = new Date(); d.setDate(d.getDate() + 14);
  $("gDate").value = todayKey(d);

  store.onChange(() => {
    $("bedBox").value = store.state.bedtime;
    $("estBox").value = store.state.defaultEst;
    render();
  });

  render();
  await checkArrival();
  render();

  wireAsk({ input: $("askBox"), askBtn: $("askBtn"), out: $("askOut"), chips: $("askChips") }, ctx);

  /* ---- the context map ---- */
  mapLegend($("mapLegend"));
  mapPanel = makeMapPanel(
    {
      canvas: $("mapCanvas"),
      side: $("mapSide"),
      empty: $("mapEmpty"),
      stat: $("mapStat"),
      search: $("mapSearch")
    },
    () => store.state,
    mapHandlers
  );
  mapPanel.refresh();
  $("mapRecenter").addEventListener("click", () => mapPanel.recenter());
  $("mapRescan").addEventListener("click", rescanMap);
  $("mapDeepen").addEventListener("click", deepenMap);
  $("mapDeepen").hidden = !ai.hasKey();

  // First run: fold in whatever is already here so the map isn't empty.
  if (!store.state.map.nodes.length && (store.state.tasks.length || store.state.inbox.length)) {
    await rescanMap();
  }

  if (store.config.cloudUrl && store.config.cloudKey) {
    await store.pull();
    store.startLive();
  }
  loadCalendar();

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

  /* ---- tabs ---- */
  $("tabTonight").addEventListener("click", () => setTab("tonight"));
  $("tabInbox").addEventListener("click", () => setTab("inbox"));
  $("tabGoals").addEventListener("click", () => setTab("goals"));
  $("tabMap").addEventListener("click", () => setTab("map"));

  /* ---- list ---- */
  $("editBtn").addEventListener("click", () => {
    const ed = $("editor");
    ed.hidden = !ed.hidden;
    if (!ed.hidden) {
      $("listBox").value = [...store.state.tasks].sort((a, b) => a.ord - b.ord).map(t => t.raw).join("\n");
      $("listBox").focus();
    }
  });
  $("cancelList").addEventListener("click", () => { $("editor").hidden = true; });
  $("saveList").addEventListener("click", async () => {
    const tasks = parseList($("listBox").value, store.state.defaultEst, new Date());
    if (!tasks.length) return;
    await store.commit(s => {
      s.tasks = tasks; s.date = todayKey(); s.uploadedAt = Date.now(); s.active = null;
    });
    $("editor").hidden = true;
    render();
  });
  $("staleNew").addEventListener("click", () => {
    $("editor").hidden = false;
    $("listBox").value = [...store.state.tasks].sort((a, b) => a.ord - b.ord).map(t => t.raw).join("\n");
    $("listBox").focus();
  });

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

  /* ---- inbox capture ---- */
  $("noteBtn").addEventListener("click", async () => {
    const text = $("noteBox").value;
    if (!text.trim()) return;
    const id = await addCapture(makeCapture({
      kind: "note", source: `Note · ${fmtClock(new Date())}`, text
    }));
    $("noteBox").value = "";
    await inboxHandlers.extract(id);
  });

  $("fileInput").addEventListener("change", async e => {
    for (const f of e.target.files) await ingestFile(f);
    e.target.value = "";
  });

  document.addEventListener("dragover", e => {
    e.preventDefault();
    const z = document.getElementById("dropzone");
    if (z) z.classList.add("hot");
  });
  document.addEventListener("dragleave", () => {
    const z = document.getElementById("dropzone");
    if (z) z.classList.remove("hot");
  });
  document.addEventListener("drop", async e => {
    e.preventDefault();
    const z = document.getElementById("dropzone");
    if (z) z.classList.remove("hot");
    setTab("inbox");
    for (const f of e.dataTransfer.files) await ingestFile(f);
  });
  document.addEventListener("paste", async e => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.type.startsWith("image/"));
    if (!img) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    setTab("inbox");
    const blob = img.getAsFile();
    if (blob) await ingestFile(new File([blob], `Pasted screenshot ${fmtClock(new Date())}.png`, { type: blob.type }));
  });

  /* ---- voice: speak the list, check the lines, commit ---- */
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
      setTab("tonight");
      render();
    }
  );

  /* ---- sources ---- */
  $("ghBtn").addEventListener("click", async () => {
    const m = $("srcMsg"); m.hidden = false; m.className = "msg"; m.textContent = "Checking GitHub…";
    const user = (store.config.githubUser || "").trim();
    if (!user) { m.className = "msg err"; m.textContent = "Set your GitHub username in Options first."; return; }
    const r = await fetchGitHub(user, store.config.githubToken);
    if (!r.ok) { m.className = "msg err"; m.textContent = ghReasonText(r.reason, r.status); return; }
    const cap = githubCapture(r.events, new Date());
    if (!cap) { m.textContent = "No public activity in the last week."; return; }
    await addCapture(cap);
    m.textContent = `Captured ${cap.candidates.length} repo${cap.candidates.length === 1 ? "" : "s"}. Accept the ones you actually mean to work on.`;
  });

  $("tabsBtn").addEventListener("click", async () => {
    const m = $("srcMsg"); m.hidden = false; m.className = "msg"; m.textContent = "Reading open tabs…";
    const cap = await openTabsCapture();
    if (!cap) { m.className = "msg err"; m.textContent = "Not enough open tabs worth capturing."; return; }
    const id = await addCapture(cap);
    await inboxHandlers.extract(id);
    m.textContent = "Captured. These are what you had open, not what you have to do.";
  });

  /* ---- goals ---- */
  $("gAdd").addEventListener("click", async () => {
    const title = $("gTitle").value.trim();
    const date = $("gDate").value;
    const hours = parseFloat($("gHours").value);
    if (!title || !date || !(hours > 0)) return;
    await store.commit(s => {
      s.goals.push(makeGoal({
        title, targetDate: date, totalMin: Math.round(hours * 60),
        match: $("gMatch").value.trim() || undefined
      }));
    });
    $("gTitle").value = ""; $("gMatch").value = "";
    setTab("goals");
    render();
  });

  /* ---- misc ---- */
  $("remBtn").addEventListener("click", async () => {
    if (await addReminder($("remBox").value)) $("remBox").value = "";
  });
  $("remBox").addEventListener("keydown", async e => {
    if (e.key === "Enter" && await addReminder($("remBox").value)) $("remBox").value = "";
  });

  $("calBtn").addEventListener("click", loadCalendar);
  $("pullBtn").addEventListener("click", async () => { await store.pull(); render(); });
  $("homeAck").addEventListener("click", () => { $("homeBanner").hidden = true; homeMode = false; render(); });
  $("nowBtn").addEventListener("click", () => {
    location.href = hasChrome && chrome.runtime ? chrome.runtime.getURL("extension/now.html") : "now.html";
  });
  $("optBtn").addEventListener("click", () => {
    if (hasChrome && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else location.href = "options.html";
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
})();
