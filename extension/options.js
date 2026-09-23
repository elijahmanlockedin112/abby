/* =====================================================================
   Locked In — options.
   ===================================================================== */

import { emptyState, todayKey } from "../shared/engine.js";
import { openStore, cloudGet, cloudPut, cloudStatusText } from "../shared/sync.js";
import { fetchCalendar, calStatusText } from "../shared/ics.js";
import { makeAI, PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../shared/ai.js";
import { fetchGitHub, ghReasonText } from "../shared/sources.js";
import { encodeLink, decodeLink, linkReasonText, describeLink } from "../shared/linkcode.js";
import { suggestPassphrase, openVault, cryptoAvailable } from "../shared/crypto.js";
import { $, initTheme } from "../shared/ui.js";

let store = null;

function say(id, text, tone) {
  const e = $(id);
  if (!e) return;
  e.hidden = false;
  e.className = "result" + (tone ? " " + tone : "");
  e.textContent = text;
}

function randomKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

function fillHours() {
  const sel = $("arriveHour");
  for (let h = 0; h < 24; h++) {
    const o = document.createElement("option");
    o.value = String(h);
    const hh = h % 12 || 12;
    o.textContent = `${hh}:00 ${h >= 12 ? "PM" : "AM"}`;
    sel.appendChild(o);
  }
}

(async function boot() {
  initTheme("themeBtn");
  fillHours();

  store = await openStore();
  const c = store.config;
  $("arriveHour").value = String(c.arriveHour ?? 14);
  $("nameBox").value = c.name || "";
  $("icsUrl").value = c.icsUrl || "";
  $("cloudUrl").value = c.cloudUrl || "";
  $("cloudKey").value = c.cloudKey || "";
  $("passphrase").value = c.passphrase || "";
  $("apiKey").value = c.apiKey || "";
  $("model").value = c.model || "";
  $("githubUser").value = c.githubUser || "";
  $("githubToken").value = c.githubToken || "";
  ($(c.newTabMode === "full" ? "ntFull" : "ntNow")).checked = true;
  $("pinTab").checked = c.pinTab !== false;

  const prov0 = PROVIDERS[c.provider] ? c.provider : DEFAULT_PROVIDER;
  $(prov0 === "openai" ? "provOpenai" : "provAnthropic").checked = true;

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

  $("genKey").addEventListener("click", () => { $("cloudKey").value = randomKey(); });

  /* ---- encryption ---- */
  if (!cryptoAvailable()) {
    $("genPhrase").disabled = true;
    $("testCrypto").disabled = true;
    say("cryptoResult", "This browser can't do WebCrypto, so encryption is unavailable here.", "bad");
  }

  $("genPhrase").addEventListener("click", () => {
    $("passphrase").value = suggestPassphrase();
    paintLink();
    say("cryptoResult", "Generated. Save, then copy the link code to your other devices — it carries this phrase so they can read what you write.", "ok");
  });

  $("testCrypto").addEventListener("click", async () => {
    const phrase = $("passphrase").value.trim();
    if (!phrase) { say("cryptoResult", "No passphrase set — sync is plaintext.", "bad"); return; }
    say("cryptoResult", "Checking…", "busy");
    const v = await openVault({ passphrase: phrase, salt: store.config.salt });
    if (!v.ok) { say("cryptoResult", "Couldn't build a key from that phrase.", "bad"); return; }
    const probe = { tasks: [{ title: "Biology ch 4 review" }], reminders: [] };
    const sealed = await v.seal(probe);
    const wire = JSON.stringify(sealed);
    const leaks = wire.includes("Biology");
    const back = await v.open(sealed);
    say("cryptoResult",
      leaks ? "Something is wrong — the text was readable in the sealed record."
            : `Working. A task called "Biology ch 4 review" seals to ${sealed.ct.slice(0, 18)}… and comes back intact.`,
      leaks ? "bad" : "ok");
  });

  /* ---- the link code ---- */
  function currentLinkCfg() {
    return {
      cloudUrl: $("cloudUrl").value.trim(),
      cloudKey: $("cloudKey").value.trim(),
      salt: store.config.salt || "",
      passphrase: $("passphrase").value.trim() || store.config.passphrase || ""
    };
  }
  function paintLink() {
    const cfg = currentLinkCfg();
    const code = encodeLink(cfg);
    $("linkDesc").textContent = describeLink(cfg);
    $("copyLink").disabled = !code;
    $("showLink").disabled = !code;
    $("linkCode").textContent = code || "—";
  }
  paintLink();
  for (const id of ["cloudUrl", "cloudKey", "passphrase"]) $(id).addEventListener("input", paintLink);

  $("showLink").addEventListener("click", () => {
    $("linkRow").hidden = !$("linkRow").hidden;
    $("showLink").textContent = $("linkRow").hidden ? "Show it" : "Hide it";
  });

  $("copyLink").addEventListener("click", async () => {
    const code = encodeLink(currentLinkCfg());
    if (!code) { say("linkResult", "Set the database URL and key first.", "bad"); return; }
    try {
      await navigator.clipboard.writeText(code);
      say("linkResult", "Copied. Paste it into your phone's Settings, and into the launcher page if you use it.", "ok");
    } catch {
      $("linkRow").hidden = false;
      $("showLink").textContent = "Hide it";
      say("linkResult", "Couldn't reach the clipboard — the code is shown above, select and copy it.", "bad");
    }
  });

  $("applyLink").addEventListener("click", async () => {
    const r = decodeLink($("pasteLink").value);
    if (!r.ok) { say("linkResult", linkReasonText(r.reason), "bad"); return; }

    $("cloudUrl").value = r.config.cloudUrl;
    $("cloudKey").value = r.config.cloudKey;
    await store.setConfig(r.config);
    paintLink();
    $("pasteLink").value = "";

    say("linkResult", "Linked. Checking the database…", "busy");
    const st = await store.pull();
    say("linkResult",
      st.cloud === "ok"
        ? `Linked — ${store.state.tasks.length} task${store.state.tasks.length === 1 ? "" : "s"} and ${store.state.reminders.length} reminder${store.state.reminders.length === 1 ? "" : "s"} pulled in.`
        : (st.msg || "Saved, but the database didn't answer."),
      st.cloud === "ok" ? "ok" : "bad");
  });

  $("save").addEventListener("click", async () => {
    await store.setConfig({
      arriveHour: parseInt($("arriveHour").value, 10) || 14,
      name: $("nameBox").value.trim(),
      icsUrl: $("icsUrl").value.trim(),
      cloudUrl: $("cloudUrl").value.trim(),
      cloudKey: $("cloudKey").value.trim(),
      passphrase: $("passphrase").value.trim(),
      apiKey: $("apiKey").value.trim(),
      provider: $("provOpenai").checked ? "openai" : "anthropic",
      model: $("model").value.trim() || PROVIDERS[$("provOpenai").checked ? "openai" : "anthropic"].defaultModel,
      githubUser: $("githubUser").value.trim().replace(/^@/, ""),
      githubToken: $("githubToken").value.trim(),
      newTabMode: $("ntFull").checked ? "full" : "now",
      pinTab: $("pinTab").checked
    });
    $("savedMsg").textContent = "Saved.";
    setTimeout(() => { $("savedMsg").textContent = ""; }, 2500);
  });

  $("testKey").addEventListener("click", async () => {
    const out = $("keyResult");
    out.className = "msg";
    out.textContent = "Checking…";
    const provider = $("provOpenai").checked ? "openai" : "anthropic";
    const probe = makeAI(() => ({
      provider,
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || PROVIDERS[provider].defaultModel
    }));
    if (!probe.hasKey()) { out.className = "msg err"; out.textContent = "No key entered."; return; }
    try {
      await probe.test();
      out.className = "msg";
      out.textContent = `Works — ${probe.providerLabel()} ${probe.model()} answered.`;
    } catch (e) {
      out.className = "msg err";
      out.textContent = (e && e.message) || "That key didn't work.";
    }
  });

  $("testGh").addEventListener("click", async () => {
    const out = $("ghResult");
    out.className = "msg";
    out.textContent = "Checking…";
    const r = await fetchGitHub($("githubUser").value.trim(), $("githubToken").value.trim());
    if (!r.ok) { out.className = "msg err"; out.textContent = ghReasonText(r.reason, r.status); return; }
    const week = Date.now() - 7 * 86400000;
    const n = r.events.filter(e => e.at >= week).length;
    out.className = "msg";
    out.textContent = `Works — ${n} event${n === 1 ? "" : "s"} in the last week.`;
  });

  $("testCal").addEventListener("click", async () => {
    const url = $("icsUrl").value.trim();
    const out = $("calResult");
    out.className = "msg";
    out.textContent = "Checking…";
    const r = await fetchCalendar(url, Date.now() - 86400000, Date.now() + 8 * 86400000);
    if (r.ok) {
      out.className = "msg";
      out.textContent = `Works — ${r.events.length} event${r.events.length === 1 ? "" : "s"} in the next week.`;
    } else {
      out.className = "msg err";
      out.textContent = calStatusText(r.reason, r.status);
    }
  });

  $("testCloud").addEventListener("click", async () => {
    const cfg = { cloudUrl: $("cloudUrl").value.trim(), cloudKey: $("cloudKey").value.trim() };
    const out = $("cloudResult");
    out.className = "msg";
    out.textContent = "Checking…";
    if (!cfg.cloudUrl || !cfg.cloudKey) {
      out.className = "msg err";
      out.textContent = "Both the database URL and a key are needed.";
      return;
    }
    const got = await cloudGet(cfg);
    if (!got.ok) {
      out.className = "msg err";
      out.textContent = cloudStatusText(got.reason, got.status);
      return;
    }
    // A read alone doesn't prove writes are allowed — the rules can differ.
    const probe = await cloudPut(cfg, { ...emptyState(), tasks: [], updatedAt: 1 });
    if (!probe.ok) {
      out.className = "msg err";
      out.textContent = "Reads work, writes don't. " + cloudStatusText(probe.reason, probe.status);
      return;
    }
    // Put the real state back so the probe doesn't clobber tonight.
    await cloudPut(cfg, store.state);
    out.className = "msg";
    out.textContent = got.data && Array.isArray(got.data.tasks)
      ? `Connected — found a list of ${got.data.tasks.length} from ${got.data.date || "an earlier day"}.`
      : "Connected — nothing stored under this key yet.";
  });

  $("wipe").addEventListener("click", async () => {
    await store.commit(s => {
      const fresh = emptyState();
      fresh.bedtime = s.bedtime;
      fresh.defaultEst = s.defaultEst;
      fresh.date = todayKey();
      return fresh;
    });
    $("wipeResult").textContent = "Cleared.";
    setTimeout(() => { $("wipeResult").textContent = ""; }, 2500);
  });
})();
