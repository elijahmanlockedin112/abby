/* =====================================================================
   Locked In — first-run setup.
   Five steps, four of them skippable, and nothing here is permanent:
   every field is also in Options afterwards.
   ===================================================================== */

import { parseList, todayKey } from "../shared/engine.js";
import { openStore, cloudGet, cloudPut, cloudStatusText } from "../shared/sync.js";
import { fetchCalendar, calStatusText } from "../shared/ics.js";
import { makeAI, PROVIDERS, DEFAULT_PROVIDER } from "../shared/ai.js";
import { startDictation, dictationToLines, speechSupported } from "../shared/voice.js";
import { $, el, initTheme } from "../shared/ui.js";

const hasChrome = typeof chrome !== "undefined" && chrome.runtime;
const STEPS = ["s1", "s2", "s3", "s4", "s5"];
const SKIPPABLE = { s2: true, s3: true, s4: true, s5: true };

let store = null, ai = null, i = 0, mic = null, micLines = [];

const url = p => hasChrome && chrome.runtime.getURL ? chrome.runtime.getURL("extension/" + p) : p;

function say(id, text, tone) {
  const e = $(id);
  e.hidden = false;
  e.className = "result" + (tone ? " " + tone : "");
  e.textContent = text;
}

/* ----------------------------------------------------------- stepping */

function paintDots() {
  const d = $("dots");
  d.textContent = "";
  STEPS.forEach((_, n) => {
    const bar = el("i", n === i ? "on" : n < i ? "done" : "");
    d.appendChild(bar);
  });
  d.appendChild(el("span", null, i < STEPS.length ? `${i + 1} / ${STEPS.length}` : "done"));
}

function show(n) {
  i = n;
  for (const s of STEPS) $(s).hidden = true;
  $("sDone").hidden = true;

  if (n >= STEPS.length) {
    $("sDone").hidden = false;
    $("nav").hidden = true;
    paintDots();
    summarize();
    return;
  }
  $(STEPS[n]).hidden = false;
  $("nav").hidden = false;
  $("back").hidden = n === 0;
  $("skipStep").hidden = !SKIPPABLE[STEPS[n]];
  $("next").textContent = n === STEPS.length - 1 ? "Finish" : "Next";
  paintDots();
  scrollTo({ top: 0, behavior: "instant" });
}

async function saveCurrent() {
  const patch = {};
  if (i === 0) {
    patch.name = $("nameBox").value.trim();
    patch.arriveHour = parseInt($("arriveHour").value, 10) || 14;
    patch.pinTab = $("pinTab").checked;
    await store.commit(s => {
      s.bedtime = $("bedBox").value || "22:00";
      s.defaultEst = Math.max(5, Math.min(180, parseInt($("estBox").value, 10) || 30));
    });
  }
  if (i === 1) {
    patch.provider = $("provOpenai").checked ? "openai" : "anthropic";
    patch.apiKey = $("apiKey").value.trim();
    patch.model = $("model").value.trim() || PROVIDERS[patch.provider].defaultModel;
  }
  if (i === 3) patch.icsUrl = $("icsUrl").value.trim();
  if (i === 4) {
    patch.cloudUrl = $("cloudUrl").value.trim();
    patch.cloudKey = $("cloudKey").value.trim();
  }
  if (Object.keys(patch).length) await store.setConfig(patch);
}

function summarize() {
  const c = store.config;
  const bits = [];
  bits.push(`Evening runs from when you get home until <b>${store.state.bedtime}</b>.`);
  bits.push(c.apiKey
    ? `<b>${PROVIDERS[c.provider || DEFAULT_PROVIDER].label} ${c.model}</b> is reading screenshots and messy text.`
    : `No model key — the scheduler, voice-to-list and the seven lookup questions all still work.`);
  bits.push(c.pinTab === false
    ? `No pinned tab — reach it from the toolbar icon or Ctrl+Shift+L.`
    : `Lives in one pinned tab; your new tab page is untouched.`);
  bits.push(speechSupported() ? `Voice capture is available.` : `This browser has no built-in dictation.`);
  bits.push(c.icsUrl ? `Calendar feed is set.` : `No calendar feed — nothing will block your evening.`);
  bits.push(c.cloudUrl && c.cloudKey ? `Phone sync is on.` : `Phone sync is off — this computer only.`);
  $("doneSummary").innerHTML = bits.join(" ");
  const name = (c.name || "").trim();
  $("doneHead").textContent = name ? `You're set, ${name}.` : "You're set.";
}

/* -------------------------------------------------------------- boot */

(async function boot() {
  initTheme("themeBtn");

  const sel = $("arriveHour");
  for (let h = 0; h < 24; h++) {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
    sel.appendChild(o);
  }

  store = await openStore();
  ai = makeAI(() => store.config);
  const c = store.config;

  $("nameBox").value = c.name || "";
  sel.value = String(c.arriveHour ?? 16);
  $("bedBox").value = store.state.bedtime;
  $("estBox").value = store.state.defaultEst;
  $("pinTab").checked = c.pinTab !== false;
  $("apiKey").value = c.apiKey || "";
  $("icsUrl").value = c.icsUrl || "";
  $("cloudUrl").value = c.cloudUrl || "";
  $("cloudKey").value = c.cloudKey || "";

  const prov = PROVIDERS[c.provider] ? c.provider : DEFAULT_PROVIDER;
  $(prov === "openai" ? "provOpenai" : "provAnthropic").checked = true;
  $("model").value = c.model || PROVIDERS[prov].defaultModel;
  paintProvider();

  show(0);

  /* ---- provider picker ---- */
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

  /* ---- nav ---- */
  $("next").addEventListener("click", async () => { await saveCurrent(); show(i + 1); });
  $("back").addEventListener("click", async () => { await saveCurrent(); show(Math.max(0, i - 1)); });
  $("skipStep").addEventListener("click", () => show(i + 1));
  $("skipAll").addEventListener("click", async () => { await saveCurrent(); markDone(); location.href = url("now.html"); });

  /* ---- step 2: test the key ---- */
  $("testKey").addEventListener("click", async () => {
    await saveCurrent();
    const provider = $("provOpenai").checked ? "openai" : "anthropic";
    const probe = makeAI(() => ({
      provider, apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || PROVIDERS[provider].defaultModel
    }));
    if (!probe.hasKey()) { say("keyResult", "No key entered yet.", "bad"); return; }
    say("keyResult", `Asking ${probe.model()}…`, "busy");
    try {
      const r = await probe.test();
      say("keyResult", `Works — ${PROVIDERS[r.provider].label} ${r.model} answered.`, "ok");
    } catch (e) {
      say("keyResult", e.message || "That didn't work.", "bad");
    }
  });

  /* ---- step 3: the microphone ---- */
  if (!speechSupported()) {
    $("micBtn").disabled = true;
    say("micResult", "This browser has no built-in dictation, so voice capture is off. Everything else works; you'd type or paste the list instead.", "bad");
  }

  $("micBtn").addEventListener("click", async () => {
    if (mic) {
      mic.stop();
      return;
    }
    $("vtext").textContent = "";
    $("vlines").textContent = "";
    $("micResult").hidden = true;
    $("vbox").classList.add("live");
    $("micBtn").innerHTML = '<span class="recdot"></span>Stop';
    $("micClear").hidden = true;

    mic = startDictation({
      onText: t => { $("vtext").textContent = t; },
      onError: m => { say("micResult", m, "bad"); },
      onEnd: async transcript => {
        mic = null;
        $("vbox").classList.remove("live");
        $("micBtn").textContent = "Try the microphone";
        if (!transcript) { say("micResult", "Nothing was picked up. Check the microphone and try again.", "bad"); return; }
        $("micClear").hidden = false;
        say("micResult", "Splitting it…", "busy");
        const r = await dictationToLines(transcript, ai);
        micLines = r.lines;
        paintLines();
        say("micResult",
          `${r.lines.length} line${r.lines.length === 1 ? "" : "s"} — split ${r.by === "model" ? "by " + ai.providerLabel() : "by the rules, no model needed"}` +
          (r.dropped ? `, ${r.dropped} thrown out for not matching what you said` : "") + ".",
          "ok");
      }
    });
  });

  $("micClear").addEventListener("click", () => {
    micLines = []; $("vlines").textContent = ""; $("vtext").textContent = "";
    $("micResult").hidden = true; $("micClear").hidden = true;
  });

  function paintLines() {
    const ul = $("vlines");
    ul.textContent = "";
    micLines.forEach((line, n) => {
      const li = el("li");
      li.appendChild(el("span", "n", String(n + 1)));
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = line;
      inp.addEventListener("input", () => { micLines[n] = inp.value; });
      li.appendChild(inp);
      const x = document.createElement("button");
      x.className = "sm ghost";
      x.textContent = "✕";
      x.title = "Remove this line";
      x.addEventListener("click", () => { micLines.splice(n, 1); paintLines(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
    if (micLines.length) {
      const li = el("li");
      const b = document.createElement("button");
      b.className = "go";
      b.textContent = `Use these ${micLines.length} as tonight's list`;
      b.addEventListener("click", async () => {
        const tasks = parseList(micLines.join("\n"), store.state.defaultEst, new Date());
        if (!tasks.length) return;
        await store.commit(s => {
          s.tasks = tasks;
          s.date = todayKey();
          s.uploadedAt = Date.now();
          s.active = null;
        });
        say("micResult", `Saved as tonight's list — ${tasks.length} item${tasks.length === 1 ? "" : "s"}.`, "ok");
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  /* ---- step 4: calendar ---- */
  $("testCal").addEventListener("click", async () => {
    const v = $("icsUrl").value.trim();
    if (!v) { say("calResult", "Nothing to test yet.", "bad"); return; }
    say("calResult", "Fetching…", "busy");
    const r = await fetchCalendar(v, Date.now() - 86400000, Date.now() + 8 * 86400000);
    if (!r.ok) { say("calResult", calStatusText(r.reason, r.status), "bad"); return; }
    const today = r.events.filter(e => new Date(e.start).toDateString() === new Date().toDateString()).length;
    say("calResult",
      `Works — ${r.events.length} event${r.events.length === 1 ? "" : "s"} this week, ${today} today.`, "ok");
  });

  /* ---- step 5: phone ---- */
  function echo() {
    $("echoUrl").textContent = $("cloudUrl").value.trim() || "—";
    $("echoKey").textContent = $("cloudKey").value.trim() || "—";
  }
  $("cloudUrl").addEventListener("input", echo);
  $("cloudKey").addEventListener("input", echo);
  echo();

  $("genKey").addEventListener("click", () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    $("cloudKey").value = Array.from(b, x => x.toString(36).padStart(2, "0")).join("").slice(0, 24);
    echo();
  });

  for (const [btn, src] of [["copyUrl", "cloudUrl"], ["copyKey", "cloudKey"]]) {
    $(btn).addEventListener("click", async () => {
      const v = $(src).value.trim();
      if (!v) return;
      try { await navigator.clipboard.writeText(v); $(btn).textContent = "Copied"; }
      catch { $(btn).textContent = "Select it manually"; }
      setTimeout(() => { $(btn).textContent = "Copy"; }, 1800);
    });
  }

  $("testCloud").addEventListener("click", async () => {
    const probe = { cloudUrl: $("cloudUrl").value.trim(), cloudKey: $("cloudKey").value.trim() };
    if (!probe.cloudUrl || !probe.cloudKey) { say("cloudResult", "Both the URL and a key are needed.", "bad"); return; }
    say("cloudResult", "Checking…", "busy");
    const got = await cloudGet(probe);
    if (!got.ok) { say("cloudResult", cloudStatusText(got.reason, got.status), "bad"); return; }
    const probeWrite = await cloudPut(probe, { ...store.state, updatedAt: store.state.updatedAt });
    if (!probeWrite.ok) {
      say("cloudResult", "Reads work, writes don't. " + cloudStatusText(probeWrite.reason, probeWrite.status), "bad");
      return;
    }
    say("cloudResult", got.data && Array.isArray(got.data.tasks)
      ? `Connected — there's already a list of ${got.data.tasks.length} under this key.`
      : "Connected, and this device's copy is now the one stored.", "ok");
  });

  /* ---- done ---- */
  function markDone() {
    if (hasChrome && chrome.storage) {
      chrome.storage.local.set({ "lockedin.setupDone": Date.now() }).catch(() => {});
    }
  }
  $("goNow").addEventListener("click", () => { markDone(); location.href = url("now.html"); });
  $("goFull").addEventListener("click", () => { markDone(); location.href = url("newtab.html"); });
  window.addEventListener("beforeunload", markDone);
})();
