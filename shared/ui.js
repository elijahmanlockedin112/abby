/* =====================================================================
   Locked In — shared renderers. The new tab, the popup and the phone
   all draw from these, so the plan reads identically everywhere.
   ===================================================================== */

import {
  MIN, SHORTDAY, fmtClock, fmtDur, daysBetween, effectiveDue,
  reasonFor, briefing, ledger, taskNumber
} from "./engine.js";

export const $ = (id, root = document) => root.getElementById(id);

export function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

export function btn(label, cls, fn) {
  const b = document.createElement("button");
  b.className = cls || "sm ghost";
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

export function timerText(state, t, now) {
  const elapsed = (now - state.active.startedAt) / MIN;
  return elapsed > t.est
    ? `Running ${fmtDur(elapsed - t.est)} over · ${fmtDur(elapsed)} elapsed`
    : `${fmtDur(t.est - elapsed)} left · ${fmtDur(elapsed)} elapsed`;
}

/* ------------------------------------------------------------ briefing */

export function renderBriefing({ hdr, hdrTime, say }, state, now, plan, homeMode) {
  const left = (plan.end - now) / MIN;
  if (hdrTime) hdrTime.textContent = fmtClock(now);
  if (hdr && hdr.firstChild) {
    hdr.firstChild.nodeValue =
      left <= 0 ? "Past Bedtime " :
      homeMode ? "Welcome Home " :
      now.getHours() < 12 ? "Good Morning " : "You're Home ";
  }
  if (say) say.innerHTML = briefing(state, now, plan);
}

/* -------------------------------------------------------------- runway */

export function renderRail(rail, startEl, endEl, state, now, plan) {
  rail.textContent = "";
  const drawn = plan.segs.filter(s => s.e > now.getTime() || s.running);

  if (!drawn.length) {
    const empty = el("div", "seg free");
    empty.style.flexGrow = "1";
    empty.appendChild(el("div", "n", plan.end > now ? "nothing planned" : "past bedtime"));
    rail.appendChild(empty);
  }

  for (const s of drawn) {
    const mins = Math.max(0, (Math.min(s.e, plan.end) - Math.max(s.s, now.getTime())) / MIN);
    if (mins <= 0) continue;
    const d = el("div", `seg ${s.type}${s.running ? " now" : ""}${s.over ? " over" : ""}`);
    d.style.flexGrow = String(mins);
    const num = s.type === "task" ? String(taskNumber(plan, s.task)) : "";
    d.appendChild(el("div", "n",
      mins >= 25
        ? (s.type === "task" ? `${num} · ${fmtDur(mins)}` : s.type === "busy" ? "busy" : fmtDur(mins))
        : num));
    d.title = `${s.type === "task" ? s.task.title : s.type === "busy" ? s.title : "Free"}  ` +
      `${fmtClock(new Date(s.s))}–${fmtClock(new Date(s.e))}`;
    rail.appendChild(d);
  }
  if (startEl) startEl.textContent = `${fmtClock(now)}  ·  now`;
  if (endEl) endEl.textContent = `bedtime  ·  ${fmtClock(plan.end)}`;
}

/* -------------------------------------------------------------- blocks */

export function renderBlocks(host, state, now, plan, h, opts = {}) {
  host.textContent = "";
  const compact = !!opts.compact;
  const limit = opts.limit || Infinity;

  if (!compact) {
    for (const t of state.tasks.filter(t => t.status !== "pending")) {
      host.appendChild(finishedBlock(t, h));
    }
  }

  if (!plan.segs.length && !state.tasks.length) {
    const e0 = el("div", "blk free");
    e0.appendChild(el("div", "gut"));
    const b0 = el("div", "body");
    b0.appendChild(el("div", "ttl", "Nothing planned"));
    b0.appendChild(el("div", "why", opts.emptyHint || "Add tonight's list. This page only ever shows what's on it."));
    e0.appendChild(b0);
    host.appendChild(e0);
    return;
  }

  let n = 0, drawn = 0;
  for (const s of plan.segs) {
    if (drawn >= limit) break;
    if (s.type === "task") { n++; host.appendChild(taskBlock(s, n, state, now, plan, h)); drawn++; }
    else if (s.type === "busy") { if (!compact) { host.appendChild(busyBlock(s)); drawn++; } }
    else if (!compact) { host.appendChild(freeBlock(s)); drawn++; }
  }
}

function taskBlock(seg, n, state, now, plan, h) {
  const t = seg.task;
  const over = !!seg.over;
  const wrap = el("div", `blk${seg.running ? " now" : ""}${over ? " over" : ""}`);
  wrap.style.setProperty("--m", String(t.est));

  const gut = el("div", "gut");
  gut.appendChild(el("div", "idx", String(n)));
  gut.appendChild(el("div", "tick"));
  wrap.appendChild(gut);

  const body = el("div", "body");
  const row = el("div", "row1");
  row.appendChild(el("div", "ttl", t.title));
  row.appendChild(el("div", "when",
    `${fmtClock(new Date(seg.s))} – ${fmtClock(new Date(seg.e))}  ·  ${fmtDur(t.est)}`));
  body.appendChild(row);

  const why = el("div", "why");
  why.innerHTML = reasonFor(t, now, state, n - 1);
  body.appendChild(why);

  const acts = el("div", "acts");
  if (seg.running) {
    const tm = el("div", `timer${over ? " over" : ""}`, timerText(state, t, now));
    tm.id = "liveTimer";
    acts.appendChild(tm);
    acts.appendChild(btn("Done", "fin", () => h.finish(t.id, "done")));
    acts.appendChild(btn("Stop", "ghost sm", () => h.stop()));
  } else if (n === 1) {
    acts.appendChild(btn(`▶ Start ${fmtDur(t.est)} session`, "go", () => h.start(t.id)));
    acts.appendChild(btn("Skip", "ghost sm", () => h.finish(t.id, "skipped")));
  } else {
    acts.appendChild(btn("Start this instead", "ghost sm", () => h.start(t.id)));
    acts.appendChild(btn("Skip", "ghost sm", () => h.finish(t.id, "skipped")));
  }
  if (h.bump) {
    acts.appendChild(btn("−15m", "ghost sm", () => h.bump(t.id, -15)));
    acts.appendChild(btn("+15m", "ghost sm", () => h.bump(t.id, 15)));
  }
  body.appendChild(acts);
  wrap.appendChild(body);
  return wrap;
}

function busyBlock(seg) {
  const w = el("div", "blk busy");
  w.appendChild(el("div", "gut"));
  const b = el("div", "body");
  const r = el("div", "row1");
  r.appendChild(el("div", "ttl", seg.title || "Busy"));
  r.appendChild(el("div", "when", `${fmtClock(new Date(seg.s))} – ${fmtClock(new Date(seg.e))}`));
  b.appendChild(r);
  b.appendChild(el("div", "why", "From your calendar. Time the plan routes around — not a task."));
  w.appendChild(b);
  return w;
}

function freeBlock(seg) {
  const w = el("div", "blk free");
  w.appendChild(el("div", "gut"));
  const b = el("div", "body");
  const r = el("div", "row1");
  r.appendChild(el("div", "ttl", "Free"));
  r.appendChild(el("div", "when",
    `${fmtClock(new Date(seg.s))} – ${fmtClock(new Date(seg.e))}  ·  ${fmtDur((seg.e - seg.s) / MIN)}`));
  b.appendChild(r);
  b.appendChild(el("div", "why", "Left empty on purpose. The list is finished by here."));
  w.appendChild(b);
  return w;
}

function finishedBlock(t, h) {
  const w = el("div", `blk ${t.status === "done" ? "done" : "skip"}`);
  const g = el("div", "gut");
  g.appendChild(el("div", "idx", t.status === "done" ? "✓" : "–"));
  g.appendChild(el("div", "tick"));
  w.appendChild(g);

  const b = el("div", "body");
  const r = el("div", "row1");
  r.appendChild(el("div", "ttl", t.title));
  r.appendChild(el("div", "when", t.status === "done"
    ? (t.actual != null ? `took ${fmtDur(t.actual)} · est ${fmtDur(t.est)}` : "done")
    : "skipped"));
  b.appendChild(r);

  if (t.status === "done" && t.actual != null) {
    const diff = t.actual - t.est;
    b.appendChild(el("div", "why",
      Math.abs(diff) < 5 ? "Right on your estimate."
        : diff < 0 ? `${fmtDur(-diff)} faster than planned — the rest of the evening shifted earlier.`
        : `${fmtDur(diff)} longer than planned — the rest of the evening was rebuilt around it.`));
  }
  if (h.restore) {
    const acts = el("div", "acts");
    acts.appendChild(btn("Put back", "ghost sm", () => h.restore(t.id)));
    b.appendChild(acts);
  }
  w.appendChild(b);
  return w;
}

/* ------------------------------------------------------------ overflow */

export function renderSpill(host, plan) {
  host.textContent = "";
  if (!plan.spill.length) return;
  const box = el("div", "spill");
  box.appendChild(el("h3", null,
    `${plan.spill.length} ${plan.spill.length === 1 ? "item doesn't" : "items don't"} fit tonight`));
  const need = plan.spill.reduce((a, t) => a + t.est, 0);
  box.appendChild(el("p", null,
    `They'd need another ${fmtDur(need)}. Nothing was shrunk to make them fit — move bedtime, cut an estimate, or let these roll to tomorrow.`));
  const ul = el("ul");
  for (const t of plan.spill) {
    const li = el("li");
    li.appendChild(document.createTextNode(t.title + " "));
    li.appendChild(el("span", null, `(${fmtDur(t.est)})`));
    ul.appendChild(li);
  }
  box.appendChild(ul);
  host.appendChild(box);
}

/* -------------------------------------------------------------- ledger */

export function renderLedger(host, state, plan) {
  host.textContent = "";
  const L = ledger(state, plan);
  const cell = (v, lbl, cls) => {
    const d = el("div", cls || "");
    d.appendChild(el("b", null, String(v)));
    d.appendChild(el("small", null, lbl));
    return d;
  };
  host.appendChild(cell(L.uploaded, "uploaded"));
  host.appendChild(cell(L.added, "added by you"));
  host.appendChild(cell(L.accounted, "accounted for"));
  host.appendChild(cell(L.invented, "invented", L.invented === 0 ? "zero" : "bad"));
}

/* --------------------------------------------------------- source list */

export function renderSource(host, state) {
  host.textContent = "";
  if (!state.tasks.length) {
    const li = el("li");
    li.appendChild(el("div", "txt", "Nothing yet."));
    host.appendChild(li);
    return;
  }
  const sorted = [...state.tasks].sort((a, b) => a.ord - b.ord);
  sorted.forEach((t, i) => {
    const li = el("li", t.addedAt ? "added" : "");
    li.appendChild(el("div", "mark", String(i + 1)));
    const tx = el("div", "txt");
    tx.appendChild(document.createTextNode(t.title));
    const meta = el("div", "meta");
    meta.appendChild(el("span", "tag", fmtDur(t.est) + (t.estGuessed ? " default" : "")));
    if (t.due) {
      const dd = new Date(t.due + "T00:00:00");
      meta.appendChild(el("span", "tag due", `${t.dueKind || "Due"} ${SHORTDAY[dd.getDay()]}`));
    } else if (t._calFlag) {
      meta.appendChild(el("span", "tag due", "cal: " + t._calFlag.title.slice(0, 18)));
    }
    if (t.status === "done") meta.appendChild(el("span", "tag done", "done"));
    if (t.status === "skipped") meta.appendChild(el("span", "tag", "skipped"));
    if (t.addedAt) meta.appendChild(el("span", "tag", "added " + fmtClock(new Date(t.addedAt))));
    tx.appendChild(meta);
    li.appendChild(tx);
    host.appendChild(li);
  });
}

/* ------------------------------------------------------------ calendar */

export function renderCal(host, cal, state) {
  host.textContent = "";
  if (cal.state === "loading") { host.appendChild(el("p", "msg", "Pulling…")); return; }
  if (cal.state === "idle") { host.appendChild(el("p", "msg", "Not loaded yet.")); return; }
  if (cal.state === "error") { host.appendChild(el("p", "msg err", cal.msg || "The calendar feed didn't load.")); return; }

  if (!cal.events.length) {
    host.appendChild(el("p", "msg", "Nothing on the calendar this week. Nothing is blocking your evening."));
    return;
  }

  const now = Date.now();
  const ul = el("ul", "callist");
  let shown = 0;
  for (const ev of cal.events) {
    if (shown >= 8) break;
    if (ev.end < now) continue;
    shown++;
    const li = el("li");
    const d = new Date(ev.start);
    const isToday = daysBetween(new Date(), d) === 0;
    li.appendChild(el("div", "ct", (isToday ? "today " : SHORTDAY[d.getDay()] + " ") + (ev.allDay ? "all day" : fmtClock(d))));
    const cn = el("div", "cn");
    cn.appendChild(document.createTextNode(ev.title));
    const flagged = state.tasks.filter(t => !t.due && t._calFlag && t._calFlag.title === ev.title);
    if (flagged.length) cn.appendChild(el("span", "flag", `flags “${flagged[0].title}” as a deadline`));
    else if (isToday && !ev.allDay && ev.end > now) cn.appendChild(el("span", "flag", "blocks this time tonight"));
    li.appendChild(cn);
    ul.appendChild(li);
  }
  if (!shown) { host.appendChild(el("p", "msg", "Nothing left on the calendar today or this week.")); return; }
  host.appendChild(ul);
  host.appendChild(el("p", "msg",
    `Pulled ${fmtClock(new Date(cal.at))}. Blocked time is carved out of the plan; matching names flag a deadline. No event becomes a task.`));
}

/* ------------------------------------------------------------ the rules */

export const RULES_HTML = `
  <li><b>Your list is the whole list.</b> Every block comes from a line you uploaded. Nothing is added, merged, split, or reworded — the title you see is your line with only the bullet stripped off the front.</li>
  <li><b>Deadline first, your order second.</b> Items are grouped by how soon they're due — tonight or tomorrow, then within 3 days, then within a week, then no deadline. Inside a group, the order you typed them wins. That's the only tiebreak.</li>
  <li><b>A deadline has to be written down.</b> It comes from words in the line itself (<code class="k">Thursday</code>, <code class="k">due Fri</code>, <code class="k">test 9/25</code>) or from a calendar event whose name matches the task. If neither exists, the item has no deadline and keeps your position for it.</li>
  <li><b>Calendar takes time away; it never adds work.</b> Events between now and bedtime are carved out of the evening as unavailable. A calendar event never becomes a task.</li>
  <li><b>Nothing gets compressed to fit.</b> If the list is longer than the evening, the overflow is named out loud instead of quietly shrinking every estimate.</li>
  <li><b>Replanning is from right now.</b> Finish early, run long, or add something at 7pm — the remaining blocks are rebuilt from the actual clock, not the original plan.</li>
`;

/* --------------------------------------------------------------- theme */

export function initTheme(buttonId) {
  try {
    const th = localStorage.getItem("lockedin.theme");
    if (th) document.documentElement.setAttribute("data-theme", th);
  } catch {}
  const b = document.getElementById(buttonId);
  if (!b) return;
  b.addEventListener("click", () => {
    const r = document.documentElement;
    const cur = r.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : cur === "light" ? "dark"
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    r.setAttribute("data-theme", next);
    try { localStorage.setItem("lockedin.theme", next); } catch {}
  });
}

/* =====================================================================
   Inbox, Goals, Ask — renderers for the expanded surfaces
   ===================================================================== */

import { KINDS } from "./inbox.js";
import { trajectory, paceSentence, adjustmentSentence, targetWord } from "./goals.js";
import { answer, SUGGESTED } from "./ask.js";
import { fmtDur as _fmtDur, daysBetween as _daysBetween, escapeHtml } from "./engine.js";

/* --------------------------------------------------------------- inbox */

export function renderInbox(host, state, h) {
  host.textContent = "";
  const items = (state.inbox || []).filter(c => c.status !== "dismissed").slice().reverse();

  if (!items.length) {
    const z = el("div", "dropzone");
    z.id = "dropzone";
    z.innerHTML = "Drop a screenshot, PDF or text file here — or paste one in.<br>" +
      "<span class='dim'>Nothing you drop becomes a task. It becomes candidates you accept.</span>";
    host.appendChild(z);
    return;
  }

  for (const c of items) {
    const box = el("div", "cap" + (c.status === "filed" ? " filed" : ""));

    const head = el("div", "caphead");
    head.appendChild(el("span", "k", (KINDS[c.kind] || KINDS.note).label));
    head.appendChild(el("span", "src", c.source));
    head.appendChild(el("span", "spacer"));
    head.appendChild(el("span", "when", fmtClock(new Date(c.at))));
    box.appendChild(head);

    if (c.preview) {
      box.appendChild(el("div", "cappreview", c.preview));
    }

    if (c.droppedCount) {
      box.appendChild(el("div", "drop",
        `${c.droppedCount} suggestion${c.droppedCount === 1 ? "" : "s"} thrown out — the quoted line wasn't actually in this material.`));
    }

    if (c.candidates && c.candidates.length) {
      const list = el("div", "cands");
      for (const cd of c.candidates) {
        const row = el("div", "cand" + (cd.accepted ? " taken" : ""));
        const grow = el("div", "grow");
        grow.appendChild(el("div", "ct", cd.title));
        if (cd.quote) grow.appendChild(el("span", "quote", "“" + cd.quote + "”"));
        const meta = el("div", "cmeta");
        if (cd.est) meta.appendChild(el("span", "tag", _fmtDur(cd.est)));
        if (cd.due) meta.appendChild(el("span", "tag due", (cd.dueKind || "Due") + " " + cd.due.slice(5)));
        meta.appendChild(el("span", "tag", cd.by === "model" ? "found by model" : "found by rules"));
        grow.appendChild(meta);
        row.appendChild(grow);
        if (!cd.accepted && h.accept) {
          row.appendChild(btn("Add", "sm", () => h.accept(c.id, cd.id)));
        } else if (cd.accepted) {
          row.appendChild(el("span", "tag done", "on the list"));
        }
        list.appendChild(row);
      }
      box.appendChild(list);
    } else if (c.status === "extracted") {
      const none = el("div", "cands");
      none.appendChild(el("p", "msg dim", "Nothing actionable found in this one."));
      box.appendChild(none);
    }

    const acts = el("div", "capacts");
    if (c.status === "new" && h.extract) acts.appendChild(btn("Find tasks in this", "sm go", () => h.extract(c.id)));
    if (c.candidates && c.candidates.some(x => !x.accepted) && h.acceptAll) {
      acts.appendChild(btn("Add all", "sm", () => h.acceptAll(c.id)));
    }
    if (h.dismiss) acts.appendChild(btn("Dismiss", "sm ghost", () => h.dismiss(c.id)));
    box.appendChild(acts);

    host.appendChild(box);
  }
}

/* --------------------------------------------------------------- goals */

export function renderGoals(host, state, now, events, h) {
  host.textContent = "";
  const live = (state.goals || []).filter(g => !g.archived);

  if (!live.length) {
    host.appendChild(el("p", "msg dim",
      "No goals yet. Set one — “finish FFA prep by October 20, about 6 hours” — and this tracks whether your actual evenings are keeping up."));
    return;
  }

  for (const g of live) {
    const tr = trajectory(state, g, now, events);
    const pace = paceSentence(tr, now);
    const adj = adjustmentSentence(tr, now);

    const card = el("div", "goal");
    const top = el("div", "gtop");
    top.appendChild(el("div", "gt", g.title));
    top.appendChild(el("span", "spacer"));
    top.appendChild(el("div", "gd",
      tr.overdue ? "overdue" : tr.daysLeft === 0 ? "due today" : `${tr.daysLeft}d left`));
    card.appendChild(top);

    const bar = el("div", "bar");
    bar.style.position = "relative";
    const fill = el("i", tr.behind <= 0 ? "ahead" : "");
    fill.style.width = Math.min(100, tr.pct) + "%";
    bar.appendChild(fill);
    const expectedPct = g.totalMin ? Math.min(100, (tr.expected / g.totalMin) * 100) : 0;
    if (expectedPct > 1 && expectedPct < 99) {
      const ghost = el("span", "ghost");
      ghost.style.position = "absolute";
      ghost.style.left = expectedPct + "%";
      ghost.style.top = "0";
      ghost.title = "where you'd be on an even pace";
      bar.appendChild(ghost);
    }
    card.appendChild(bar);

    const nums = el("div", "nums");
    nums.innerHTML =
      `<span><b>${_fmtDur(tr.doneMin)}</b> logged</span>` +
      `<span><b>${_fmtDur(tr.remainMin)}</b> to go</span>` +
      `<span>target <b>${targetWord(g)}</b></span>` +
      `<span><b>${Math.round(tr.totalCap)}m</b> of evening left${tr.days.some(d => !d.known) ? "*" : ""}</span>`;
    card.appendChild(nums);

    const p = el("p", "pace");
    p.innerHTML = `<span class="tone-${pace.tone}">${escapeHtml(pace.text)}</span>`;
    card.appendChild(p);
    if (adj) card.appendChild(el("p", "adj", adj));

    const acts = el("div", "gacts");
    if (h.addTask) acts.appendChild(btn("Add tonight", "sm", () => h.addTask(g.id)));
    if (h.edit) acts.appendChild(btn("Edit", "sm ghost", () => h.edit(g.id)));
    if (h.archive) acts.appendChild(btn("Archive", "sm ghost", () => h.archive(g.id)));
    card.appendChild(acts);

    host.appendChild(card);
  }

  if (live.some(g => trajectory(state, g, now, events).days.some(d => !d.known))) {
    host.appendChild(el("p", "msg dim",
      "* beyond the week your calendar feed covers, an evening is counted as free."));
  }
}

/* ----------------------------------------------------------------- ask */

export function wireAsk({ input, askBtn, out, chips }, getCtx) {
  if (chips) {
    chips.textContent = "";
    for (const q of SUGGESTED) {
      chips.appendChild(btn(q, "", () => { input.value = q; run(); }));
    }
  }

  async function run() {
    const q = input.value.trim();
    if (!q) return;
    out.hidden = false;
    out.innerHTML = "<p class='dim'>Looking…</p>";
    try {
      const r = await answer(q, getCtx());
      out.innerHTML = r.html +
        `<span class="by">${r.by === "model" ? "answered by the model" : "looked up — no model involved"}</span>`;
    } catch (e) {
      out.innerHTML = `<p class="tone-crit">${escapeHtml((e && e.message) || "That didn't work.")}</p>`;
    }
  }

  if (askBtn) askBtn.addEventListener("click", run);
  input.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  return run;
}

/* =====================================================================
   Voice capture panel — shared by the new tab and the phone.
   Speak → transcript → editable lines → commit. You always see the
   exact lines before they become the list.
   ===================================================================== */

import { startDictation, dictationToLines, speechSupported } from "./voice.js";

/**
 * @param {{btn, transcript, lines, result, box, clear}} els  DOM nodes
 * @param {() => object} getAI
 * @param {(lines:string[], mode:"replace"|"append") => Promise<void>} onUse
 */
export function makeVoicePanel(els, getAI, onUse) {
  let mic = null;
  let current = [];

  function say(text, tone) {
    if (!els.result) return;
    els.result.hidden = false;
    els.result.className = "result" + (tone ? " " + tone : "");
    els.result.textContent = text;
  }

  if (!speechSupported()) {
    if (els.btn) {
      els.btn.disabled = true;
      els.btn.title = "This browser has no built-in dictation";
    }
    say("This browser has no built-in dictation. Type or paste the list instead — everything else works the same.", "bad");
    return { supported: false };
  }

  function paint() {
    const ul = els.lines;
    if (!ul) return;
    ul.textContent = "";
    current.forEach((line, n) => {
      const li = el("li");
      li.appendChild(el("span", "n", String(n + 1)));
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = line;
      inp.setAttribute("aria-label", `Task ${n + 1}`);
      inp.addEventListener("input", () => { current[n] = inp.value; });
      li.appendChild(inp);
      li.appendChild(btn("✕", "sm ghost", () => { current.splice(n, 1); paint(); }));
      ul.appendChild(li);
    });

    if (current.length) {
      const li = el("li");
      li.appendChild(btn(`Use as tonight's list (${current.length})`, "go", async () => {
        await onUse(current.filter(l => l.trim()), "replace");
        say(`Saved as tonight's list — ${current.length} item${current.length === 1 ? "" : "s"}.`, "ok");
        current = []; paint();
      }));
      li.appendChild(btn("Append instead", "sm ghost", async () => {
        await onUse(current.filter(l => l.trim()), "append");
        say(`Added ${current.length} to the list.`, "ok");
        current = []; paint();
      }));
      ul.appendChild(li);
    }
  }

  els.btn.addEventListener("click", () => {
    if (mic) { mic.stop(); return; }

    current = [];
    paint();
    if (els.transcript) els.transcript.textContent = "";
    if (els.result) els.result.hidden = true;
    if (els.box) els.box.classList.add("live");
    if (els.clear) els.clear.hidden = true;
    els.btn.innerHTML = '<span class="recdot"></span>Stop';

    mic = startDictation({
      onText: t => { if (els.transcript) els.transcript.textContent = t; },
      onError: m => say(m, "bad"),
      onEnd: async transcript => {
        mic = null;
        if (els.box) els.box.classList.remove("live");
        els.btn.textContent = els.btn.dataset.label || "Speak your list";
        if (!transcript) { say("Nothing was picked up. Check the microphone and try again.", "bad"); return; }
        if (els.clear) els.clear.hidden = false;

        say("Splitting it…", "busy");
        const ai = getAI();
        const r = await dictationToLines(transcript, ai);
        current = r.lines;
        paint();
        if (!r.lines.length) { say("Couldn't find any separate tasks in that. Edit the transcript by hand instead.", "bad"); return; }
        say(
          `${r.lines.length} line${r.lines.length === 1 ? "" : "s"} — split ` +
          (r.by === "model" ? `by ${ai.providerLabel()}` : "by the rules, no model needed") +
          (r.dropped ? `, ${r.dropped} thrown out for not matching what you said` : "") +
          ". Check them, then use them.",
          "ok"
        );
      }
    });
  });

  if (els.clear) {
    els.clear.addEventListener("click", () => {
      current = []; paint();
      if (els.transcript) els.transcript.textContent = "";
      if (els.result) els.result.hidden = true;
      els.clear.hidden = true;
    });
  }

  return { supported: true };
}

/* =====================================================================
   Reminders — the lane that has nothing to do with tonight's evening.
   ===================================================================== */

import { standing as standingRem, upcoming as upcomingRem, whenWord, overdueNote } from "./reminders.js";

/** The loud one: things that have come due and haven't been dealt with. */
export function renderReminderAlert(host, state, now, h) {
  host.textContent = "";
  const live = standingRem(state, now);
  if (!live.length) { host.hidden = true; return; }
  host.hidden = false;

  const box = el("div", "remalert");
  box.appendChild(el("h4", null, live.length === 1 ? "Reminder" : `${live.length} reminders`));
  for (const r of live) {
    const row = el("div", "ra");
    const t = el("div", "rat");
    t.appendChild(document.createTextNode(r.text));
    const note = overdueNote(r, now) || `Due ${whenWord(r, now)}.`;
    t.appendChild(el("span", "ran", note));
    row.appendChild(t);
    if (h.done) row.appendChild(btn("Done", "fin sm", () => h.done(r.id)));
    if (h.snooze) row.appendChild(btn("Tomorrow", "ghost sm", () => h.snooze(r.id)));
    box.appendChild(row);
  }
  host.appendChild(box);
}

/** The quiet one: everything scheduled, in order. */
export function renderReminders(host, state, now, h) {
  host.textContent = "";
  const live = standingRem(state, now);
  const soon = upcomingRem(state, now, 400);
  const done = (state.reminders || []).filter(r => r.done).slice(-4).reverse();

  if (!live.length && !soon.length && !done.length) {
    host.appendChild(el("p", "msg dim",
      "Nothing scheduled. Type something like \u201ccancel spotify subscription on November 30\u201d and it'll find you on the day."));
    return;
  }

  const ul = el("ul", "remlist");
  const row = (r, cls) => {
    const li = el("li", "rem " + cls);
    li.appendChild(el("span", "when", whenWord(r, now)));
    const t = el("div", "rt");
    t.appendChild(document.createTextNode(r.text));
    if (cls === "fired") {
      const n = overdueNote(r, now);
      if (n) t.appendChild(el("span", "rn", n));
    }
    li.appendChild(t);
    if (!r.done && h.done) li.appendChild(btn("Done", "sm ghost", () => h.done(r.id)));
    if (h.remove) li.appendChild(btn("\u2715", "sm ghost", () => h.remove(r.id)));
    return li;
  };

  for (const r of live) ul.appendChild(row(r, "fired"));
  for (const r of soon) ul.appendChild(row(r, daysUntilSoon(r, now) <= 7 ? "soon" : ""));
  for (const r of done) ul.appendChild(row(r, "done"));
  host.appendChild(ul);
}

function daysUntilSoon(r, now) {
  return daysBetween(now, new Date(r.at + "T00:00:00"));
}

/** Browsers only let a page ask from a real click, so this is a button. */
export function wireNotifyPermission(btnEl, stateEl) {
  const paint = () => {
    if (typeof Notification === "undefined") {
      stateEl.className = "notifstate bad";
      stateEl.textContent = "This browser can't show notifications.";
      btnEl.hidden = true;
      return;
    }
    if (Notification.permission === "granted") {
      stateEl.className = "notifstate";
      stateEl.textContent = "Notifications are on.";
      btnEl.hidden = true;
    } else if (Notification.permission === "denied") {
      stateEl.className = "notifstate bad";
      stateEl.textContent = "Notifications are blocked for this site. Turn them back on in your browser's site settings.";
      btnEl.hidden = true;
    } else {
      stateEl.className = "notifstate";
      stateEl.textContent = "Notifications are off, so reminders will only show inside the app.";
      btnEl.hidden = false;
    }
  };
  if (btnEl) btnEl.addEventListener("click", async () => {
    try { await Notification.requestPermission(); } catch {}
    paint();
  });
  paint();
  return paint;
}

/* =====================================================================
   Context map panel — graph on the left, evidence on the right.
   ===================================================================== */

import { createGraph } from "./graph.js";
import {
  NODE_TYPES, EDGE_KINDS, neighbours, nodeCard, topNodes, search as searchMap
} from "./contextmap.js";

export function makeMapPanel({ canvas, side, empty, stat, search }, getState, h = {}) {
  let graph = null;
  let current = null;

  function paintSide(map) {
    side.textContent = "";

    if (!map.nodes.length) {
      const p = el("div", "panel");
      p.appendChild(el("h3", null, "Nothing yet"));
      p.appendChild(el("p", "sub",
        "The map fills itself from what you already write. Add tonight's list, throw a screenshot in, or set a reminder \u2014 anything with a name in it."));
      side.appendChild(p);
      return;
    }

    const node = current ? map.nodes.find(n => n.id === current) : null;

    if (!node) {
      const p = el("div", "panel");
      p.appendChild(el("h3", null, "Strongest threads"));
      p.appendChild(el("p", "sub", "What keeps coming up. Click anything to see where it came from."));
      const ul = el("ul", "rel");
      for (const n of topNodes(map, 10)) {
        const li = el("li");
        const k = el("span", "rk", NODE_TYPES[n.type].label.toLowerCase());
        k.style.color = NODE_TYPES[n.type].color;
        li.appendChild(k);
        li.appendChild(el("span", "rn", n.name));
        li.appendChild(el("span", "spacer"));
        li.appendChild(el("span", "rw", `${n.seen}\u00d7`));
        li.addEventListener("click", () => focus(n.id));
        ul.appendChild(li);
      }
      p.appendChild(ul);
      side.appendChild(p);
      return;
    }

    const card = nodeCard(map, node);

    const head = el("div", "panel");
    const hd = el("div", "nodehead");
    hd.appendChild(el("h4", null, node.name));
    const badge = el("span", "nodetype", card.type.label);
    badge.style.color = card.type.color;
    hd.appendChild(badge);
    head.appendChild(hd);
    head.appendChild(el("p", "nodemeta", card.summary));

    const acts = el("div", "btnrow");
    acts.style.marginTop = "0";
    acts.appendChild(btn("Clear selection", "sm ghost", () => focus(null)));
    if (h.forget) acts.appendChild(btn("Forget this", "sm ghost", () => h.forget(node.id)));
    head.appendChild(acts);
    side.appendChild(head);

    if (card.connections.length) {
      const p = el("div", "panel");
      p.appendChild(el("h3", null, `Connected to ${card.connections.length}`));
      const ul = el("ul", "rel");
      for (const c of card.connections.slice(0, 14)) {
        const li = el("li");
        li.appendChild(el("span", "rk", EDGE_KINDS[c.edge.kind]));
        const nm = el("span", "rn", c.other.name);
        nm.style.color = NODE_TYPES[c.other.type].color;
        li.appendChild(nm);
        li.appendChild(el("span", "spacer"));
        li.appendChild(el("span", "rw", `${c.edge.weight}\u00d7`));
        li.addEventListener("click", () => focus(c.other.id));
        ul.appendChild(li);
      }
      p.appendChild(ul);
      side.appendChild(p);
    }

    const ev = el("div", "panel");
    ev.appendChild(el("h3", null, "Where this came from"));
    ev.appendChild(el("p", "sub", "Your own words. Nothing on this map exists without one of these."));
    const ul = el("ul", "ev");
    for (const e of card.evidence) {
      const li = el("li");
      const q = document.createElement("q");
      q.textContent = e.text;
      li.appendChild(q);
      li.appendChild(el("span", "src", `${e.source || "you"} \u00b7 ${new Date(e.at).toLocaleDateString()}`));
      ul.appendChild(li);
    }
    ev.appendChild(ul);
    side.appendChild(ev);
  }

  function focus(id) {
    current = id;
    if (graph) graph.select(id);
    paintSide(getState().map);
  }

  function refresh() {
    const map = getState().map || { nodes: [], edges: [] };
    if (!graph) {
      graph = createGraph(canvas, { onSelect: id => { current = id; paintSide(getState().map); } });
    }
    graph.setData(map);
    if (empty) empty.hidden = map.nodes.length > 0;
    if (stat) {
      stat.textContent = map.nodes.length
        ? `${map.nodes.length} nodes \u00b7 ${map.edges.length} links`
        : "";
    }
    paintSide(map);
  }

  if (search) {
    search.addEventListener("input", () => {
      const hits = searchMap(getState().map, search.value);
      if (search.value.trim() && hits.length) focus(hits[0].id);
      else if (!search.value.trim()) focus(null);
    });
  }

  return {
    refresh,
    focus,
    recenter: () => graph && graph.recenter(),
    reheat: () => graph && graph.reheat()
  };
}

export function mapLegend(host) {
  host.textContent = "";
  for (const [k, v] of Object.entries(NODE_TYPES)) {
    const s = el("span");
    const i = el("i");
    i.style.background = v.color;
    s.appendChild(i);
    s.appendChild(document.createTextNode(v.label));
    host.appendChild(s);
  }
}
