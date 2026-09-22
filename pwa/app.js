/* =====================================================================
   Abby — the phone. One screen.

   Snap your list. She sorts it. You tick things off.

   Everything clever lives in ../shared/. This file is only the surface,
   deliberately: the previous version had four tabs and nine panels, and
   the thing you actually do at 3pm was three taps deep.
   ===================================================================== */

import {
  MIN, SHORTDAY, fmtClock, fmtDur, todayKey, daysBetween,
  makeTask, bedtimeAt, stripBullet, logFinish
} from "../shared/engine.js";
import { openStore } from "../shared/sync.js";
import { makeAI } from "../shared/ai.js";
import { readImage, readPDF, pdfReasonText } from "../shared/inbox.js";
import { triage, triageSummary } from "../shared/triage.js";
import { parseReminder, makeReminder, whenWord, fireAt, overdueNote, fmt12 } from "../shared/reminders.js";
import {
  isNative, syncNotifications, flushOverdue, onNotificationTap,
  onResume, askNotifications, haptic
} from "../shared/native.js";

let store = null, ai = null, lastMin = -1;

const $ = id => document.getElementById(id);
const who = () => (store && store.config && store.config.name || "").trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function say(text, tone) {
  const el = $("said");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "said" + (tone ? " " + tone : "");
  el.textContent = text;
}

/* --------------------------------------------------------------- render */

function render() {
  const now = new Date();
  lastMin = now.getMinutes();
  const s = store.state;

  $("clock").textContent = fmtClock(now);

  const bed = bedtimeAt(s, now);
  const left = (bed - now) / MIN;
  const open = s.tasks.filter(t => t.status === "pending").length;

  $("left").innerHTML = left > 0
    ? `<b>${fmtDur(left)}</b> until bed at ${fmtClock(bed)}${open ? ` · ${open} left` : ""}`
    : `Past bed (${fmtClock(bed)})`;

  renderList(s, now);
  renderSync();
}

function renderList(s, now) {
  const host = $("list");
  host.textContent = "";

  const tasks = [...s.tasks].sort((a, b) => {
    const ap = a.status === "pending", bp = b.status === "pending";
    if (ap !== bp) return ap ? -1 : 1;
    return a.ord - b.ord;
  });
  const rems = (s.reminders || []).filter(r => !r.done).sort((a, b) => fireAt(a) - fireAt(b));

  if (!tasks.length && !rems.length) {
    const d = document.createElement("div");
    d.className = "allgood";
    d.innerHTML = `<p class="big">Nothing yet${who() ? ", " + esc(who()) : ""}.</p>
      <p class="sm">Snap a photo of your list and I'll sort it out.</p>`;
    host.appendChild(d);
    return;
  }

  if (tasks.length) {
    const done = tasks.filter(t => t.status !== "pending").length;
    host.appendChild(group("Tonight", `${done}/${tasks.length}`, tasks.map(t => taskRow(t, now))));
  }
  if (rems.length) {
    host.appendChild(group("Don't forget", "", rems.map(r => remRow(r, now))));
  }
}

function group(title, count, rows) {
  const g = document.createElement("div");
  g.className = "grp";
  const h = document.createElement("h2");
  h.textContent = title;
  if (count) {
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = count;
    h.appendChild(n);
  }
  g.appendChild(h);
  const ul = document.createElement("ul");
  ul.className = "chk";
  for (const r of rows) ul.appendChild(r);
  g.appendChild(ul);
  return g;
}

function row({ done, title, bits, onToggle, onDelete }) {
  const li = document.createElement("li");
  if (done) li.className = "done";

  const box = document.createElement("button");
  box.className = "box" + (done ? " on" : "");
  box.setAttribute("aria-label", done ? "Mark not done" : "Mark done");
  box.addEventListener("click", onToggle);
  li.appendChild(box);

  const w = document.createElement("div");
  w.className = "who";
  const t = document.createElement("div");
  t.className = "ttl";
  t.textContent = title;
  w.appendChild(t);
  if (bits && bits.length) {
    const sub = document.createElement("div");
    sub.className = "sub";
    for (const b of bits) {
      const sp = document.createElement("span");
      if (b.cls) sp.className = b.cls;
      sp.textContent = b.text;
      sub.appendChild(sp);
    }
    w.appendChild(sub);
  }
  li.appendChild(w);

  const x = document.createElement("button");
  x.className = "x";
  x.textContent = "×";
  x.setAttribute("aria-label", "Remove");
  x.addEventListener("click", onDelete);
  li.appendChild(x);
  return li;
}

function taskRow(t, now) {
  const bits = [{ text: fmtDur(t.est) }];
  if (t.due) {
    const dd = new Date(t.due + "T00:00:00");
    const d = daysBetween(now, dd);
    bits.push({
      text: d <= 0 ? "today" : d === 1 ? "tomorrow" : SHORTDAY[dd.getDay()],
      cls: d <= 1 ? "soon" : "due"
    });
  }
  return row({
    done: t.status !== "pending",
    title: t.title,
    bits,
    onToggle: () => toggleTask(t.id),
    onDelete: () => deleteTask(t.id)
  });
}

function remRow(r, now) {
  const late = overdueNote(r, now);
  return row({
    done: false,
    title: r.text,
    bits: [{ text: whenWord(r, now), cls: late ? "soon" : "due" }],
    onToggle: () => doneReminder(r.id),
    onDelete: () => deleteReminder(r.id)
  });
}

function renderSync() {
  const c = store.config;
  const note = $("syncNote");
  const on = !!(c.cloudUrl && c.cloudKey);
  const st = store.status;

  if (!on) {
    note.innerHTML = "<b>Not linked to your PC.</b> Paste the same database URL and key you used on the computer — without them this phone keeps a separate list.";
    note.style.color = "var(--warn)";
    return;
  }
  if (st.cloud === "error") {
    note.textContent = st.msg || "Sync error.";
    note.style.color = "var(--crit)";
    return;
  }
  note.textContent = st.cloud === "ok"
    ? `Linked — same list as your PC.`
    : "Linking…";
  note.style.color = "var(--ink-3)";
}

/* -------------------------------------------------------------- actions */

const toggleTask = id => store.commit(s => {
  const t = s.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.status === "pending") { t.status = "done"; logFinish(s, t, "done", null); }
  else { t.status = "pending"; s.log = s.log.filter(e => e.taskId !== id); }
}).then(() => { haptic("light"); render(); });

const deleteTask = id => store.commit(s => {
  s.tasks = s.tasks.filter(x => x.id !== id);
  s.tasks.forEach((t, i) => { t.ord = i; });
}).then(render);

const doneReminder = id => store.commit(s => {
  const r = s.reminders.find(x => x.id === id);
  if (r) { r.done = true; r.firedAt = r.firedAt || Date.now(); }
}).then(async () => { haptic("light"); await syncNotifications(store.state); render(); });

const deleteReminder = id => store.commit(s => {
  s.reminders = s.reminders.filter(x => x.id !== id);
}).then(async () => { await syncNotifications(store.state); render(); });

/** Everything — photo, PDF, paste — ends up here. */
async function absorb(text) {
  const now = new Date();
  say("Reading it…", "busy");
  const res = await triage(text, ai, store.state.defaultEst, now);

  if (!res.tasks.length && !res.reminders.length) {
    say(triageSummary(res, who()), "bad");
    return;
  }

  await store.commit(s => {
    for (const t of res.tasks) { t.ord = s.tasks.length; s.tasks.push(t); }
    for (const r of res.reminders) s.reminders.push(r);
    s.date = todayKey(now);
    s.uploadedAt = Date.now();
  });

  await syncNotifications(store.state);
  haptic("medium");
  say(triageSummary(res, who()) + (res.error ? " (" + res.error + ")" : ""));
  render();
}

async function handleFile(file) {
  if (!file) return;

  if (file.type && file.type.startsWith("image/")) {
    if (!ai.hasKey()) {
      say("Add your OpenAI key in Settings and I can read photos. Until then, tap “Type it”.", "bad");
      return;
    }
    say("Looking at it…", "busy");
    const r = await readImage(file, ai);
    if (!r.ok) {
      say(r.reason === "toobig"
        ? "That photo's too big — try a tighter crop."
        : "Couldn't read that photo." + (r.error ? " " + r.error : ""), "bad");
      return;
    }
    if (!r.text) { say("No text I could make out. Try more light, or hold it straighter.", "bad"); return; }
    await absorb(r.text);
    return;
  }

  if (/\.pdf$/i.test(file.name || "")) {
    say("Opening it…", "busy");
    const r = await readPDF(file);
    if (!r.ok) { say(pdfReasonText(r.reason), "bad"); return; }
    await absorb(r.text);
    return;
  }

  const text = await file.text();
  if (!text.trim()) { say("That file was empty.", "bad"); return; }
  await absorb(text);
}

/** One typed line: a reminder if it names a future day, else tonight's work. */
async function addOne(line) {
  if (!stripBullet(line)) return;
  const now = new Date();
  const r = parseReminder(line, now);
  const dated = r && daysBetween(now, new Date(r.at + "T00:00:00")) > 0;

  await store.commit(s => {
    if (dated) s.reminders.push(r);
    else s.tasks.push(makeTask(line, s.tasks.length, s.defaultEst, now, Date.now()));
    s.date = todayKey(now);
  });

  if (dated) await syncNotifications(store.state);
  haptic("light");
  say(dated ? `Got it. ${r.text} — ${whenWord(r, now)}.` : "Added.");
  render();
}

/* ------------------------------------------------------- the composer
   Chips for the times that actually matter in his day, a real picker for
   anything else, and blank still means "catch me twice". */

const DAY_CHIPS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "This weekend", weekend: true }
];

const TIME_CHIPS = [
  { label: "Before school", time: "06:40" },
  { label: "Out of school", time: "15:00" },
  { label: "Getting home", time: "15:30" },
  { label: "Evening", time: "17:00" },
  { label: "Before bed", time: "20:30" }
];

let pickDate = null;   // "YYYY-MM-DD"
let pickTime = null;   // "HH:MM" or null = both default slots

function weekendDate(now) {
  const d = new Date(now);
  // Saturday, or today if it already is the weekend.
  const delta = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function paintChips() {
  const now = new Date();

  const dayHost = $("dayChips");
  dayHost.textContent = "";
  for (const c of DAY_CHIPS) {
    const d = c.weekend ? weekendDate(now) : (() => { const x = new Date(now); x.setDate(x.getDate() + c.days); return x; })();
    const key = todayKey(d);
    const b = document.createElement("button");
    b.type = "button";
    b.className = pickDate === key ? "on" : "";
    b.innerHTML = esc(c.label) + "<small>" + SHORTDAY[d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate() + "</small>";
    b.addEventListener("click", () => { pickDate = key; $("remDate").value = key; paintChips(); });
    dayHost.appendChild(b);
  }

  const timeHost = $("timeChips");
  timeHost.textContent = "";
  for (const c of TIME_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = pickTime === c.time ? "on" : "";
    b.innerHTML = esc(c.label) + "<small>" + fmt12(c.time) + "</small>";
    b.addEventListener("click", () => {
      pickTime = pickTime === c.time ? null : c.time;
      $("remTime").value = pickTime || "";
      paintChips();
    });
    timeHost.appendChild(b);
  }

  $("timeHint").textContent = pickTime
    ? "One notification, at " + fmt12(pickTime) + "."
    : "No time set \u2014 I'll catch you twice: 6:40 AM and 5:00 PM.";
}

function openComposer(prefill) {
  const now = new Date();
  pickDate = todayKey(now);
  pickTime = null;
  $("remText").value = prefill || "";
  $("remDate").value = pickDate;
  $("remTime").value = "";
  paintChips();
  $("composer").hidden = false;
  $("remindBtn").hidden = true;
  $("remText").focus();
}

function closeComposer() {
  $("composer").hidden = true;
  $("remindBtn").hidden = false;
}

async function saveComposer() {
  const text = $("remText").value.trim();
  if (!text) { $("remText").focus(); return; }

  const at = $("remDate").value || todayKey(new Date());
  const time = $("remTime").value || null;

  const r = makeReminder({ text: text.charAt(0).toUpperCase() + text.slice(1), at, time, raw: text });
  await store.commit(s => { s.reminders.push(r); });
  await syncNotifications(store.state);
  haptic("medium");
  closeComposer();
  say("Got it" + (who() ? ", " + who() : "") + ". " + r.text + " \u2014 " + whenWord(r, new Date()) + ".");
  render();
}

/* ----------------------------------------------------------------- boot */

(async function boot() {
  try {
    store = await openStore();
    ai = makeAI(() => store.config);

    const c = store.config;
    $("bedBox").value = store.state.bedtime;
    $("nameBox").value = c.name || "";
    $("apiKey").value = c.apiKey || "";
    $("cloudUrl").value = c.cloudUrl || "";
    $("cloudKey").value = c.cloudKey || "";

    store.onChange(() => {
      $("bedBox").value = store.state.bedtime;
      render();
    });
    render();

    // Pull first, so the phone shows the PC's list rather than its own copy.
    if (c.cloudUrl && c.cloudKey) {
      await store.pull();
      store.startPolling(30000);
      render();
    }

    /* ---- capture ---- */
    $("snapBtn").addEventListener("click", () => $("camInput").click());
    $("pickBtn").addEventListener("click", () => $("fileInput").click());
    for (const id of ["camInput", "fileInput"]) {
      $(id).addEventListener("change", async e => {
        const f = e.target.files[0];
        e.target.value = "";
        await handleFile(f);
      });
    }

    $("typeBtn").addEventListener("click", () => {
      const b = $("typeBox");
      b.hidden = !b.hidden;
      if (!b.hidden) $("listBox").focus();
    });
    $("typeCancel").addEventListener("click", () => { $("typeBox").hidden = true; });
    $("typeSave").addEventListener("click", async () => {
      const v = $("listBox").value;
      if (!v.trim()) return;
      $("typeBox").hidden = true;
      $("listBox").value = "";
      await absorb(v);
    });

    $("remindBtn").addEventListener("click", () => openComposer($("addBox").value.trim()));
    $("remCancel").addEventListener("click", closeComposer);
    $("remSave").addEventListener("click", saveComposer);
    $("remDate").addEventListener("change", () => { pickDate = $("remDate").value; paintChips(); });
    $("remTime").addEventListener("change", () => { pickTime = $("remTime").value || null; paintChips(); });
    $("remText").addEventListener("keydown", e => { if (e.key === "Enter") saveComposer(); });

    $("addBtn").addEventListener("click", async () => {
      await addOne($("addBox").value);
      $("addBox").value = "";
    });
    $("addBox").addEventListener("keydown", async e => {
      if (e.key === "Enter") { await addOne($("addBox").value); $("addBox").value = ""; }
    });

    /* ---- settings ---- */
    $("saveBtn").addEventListener("click", async () => {
      await store.commit(s => { s.bedtime = $("bedBox").value || "21:00"; });
      await store.setConfig({
        name: $("nameBox").value.trim(),
        apiKey: $("apiKey").value.trim(),
        cloudUrl: $("cloudUrl").value.trim(),
        cloudKey: $("cloudKey").value.trim()
      });
      if (store.config.cloudUrl && store.config.cloudKey) {
        await store.pull();
        store.startPolling(30000);
      }
      $("noteMsg").textContent = "Saved.";
      setTimeout(() => { $("noteMsg").textContent = ""; }, 2000);
      render();
    });

    $("notifBtn").addEventListener("click", async () => {
      const ok = await askNotifications();
      $("noteMsg").textContent = ok
        ? "Notifications on."
        : "Notifications are off — turn them on for Abby in your phone's Settings.";
    });

    /* ---- native ---- */
    if (isNative()) {
      await askNotifications();
      await flushOverdue(store.state);
      await syncNotifications(store.state);
      onNotificationTap(() => render());
      onResume(async () => {
        await store.pull().catch(() => {});
        await flushOverdue(store.state);
        render();
      });
    } else if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    setInterval(() => {
      const now = new Date();
      $("clock").textContent = fmtClock(now);
      if (now.getMinutes() !== lastMin) render();
    }, 1000);

    window.__abbyBooted = true;
  } catch (err) {
    if (window.__abbyFatal) {
      window.__abbyFatal("Abby hit an error starting up.", (err && (err.stack || err.message)) || String(err));
    } else { throw err; }
  }
})();
