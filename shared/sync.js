/* =====================================================================
   Locked In — storage and the phone/PC bridge.

   Local-first, always. The cloud is an overlay: if it's configured, both
   devices write to the same key and the newer `updatedAt` wins. If it
   isn't, everything still works — it just doesn't leave the device.
   ===================================================================== */

import { serialize, hydrate, emptyState } from "./engine.js";
import { openVault, isEncrypted, cryptoAvailable } from "./crypto.js";

const KEY_STATE = "lockedin.state";
const KEY_CFG = "lockedin.config";

/* ------------------------------------------------- platform local store
   chrome.storage.local in the extension, localStorage in the PWA. */

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

const local = hasChrome ? {
  async get(k) {
    const r = await chrome.storage.local.get(k);
    return r[k] ?? null;
  },
  async set(k, v) { await chrome.storage.local.set({ [k]: v }); },
  watch(k, cb) {
    const h = (changes, area) => {
      if (area === "local" && changes[k]) cb(changes[k].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(h);
    return () => chrome.storage.onChanged.removeListener(h);
  }
} : {
  async get(k) {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  },
  async set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode, quota */ }
  },
  watch(k, cb) {
    const h = e => { if (e.key === k) { try { cb(e.newValue ? JSON.parse(e.newValue) : null); } catch {} } };
    addEventListener("storage", h);
    return () => removeEventListener("storage", h);
  }
};

export const config = {
  async get() {
    return (await local.get(KEY_CFG)) || {
      cloudUrl: "", cloudKey: "", icsUrl: "",
      passphrase: "", salt: "",
      // Elijah's actual day. Every time calculation reads these.
      leaveHome: "07:00", leaveSchool: "15:00", homeBy: "15:30",
      fireTimes: ["06:40", "17:00"],
      arriveHour: 15, pinTab: true, name: ""
    };
  },
  async set(patch) {
    const cur = await config.get();
    const next = { ...cur, ...patch };
    await local.set(KEY_CFG, next);
    return next;
  }
};

/* ---------------------------------------------------- Firebase RTDB REST
   No SDK: MV3 forbids remote scripts, and the REST endpoint is two fetches.
   `cloudUrl` is the database URL from the Firebase console, e.g.
   https://your-project-default-rtdb.firebaseio.com
   `cloudKey` is a long random string that doubles as the shared secret. */

function cloudEndpoint(cfg) {
  if (!cfg.cloudUrl || !cfg.cloudKey) return null;
  const base = cfg.cloudUrl.replace(/\/+$/, "");
  const key = encodeURIComponent(cfg.cloudKey);
  return `${base}/lockedin/${key}.json`;
}

export async function cloudGet(cfg, signal) {
  const url = cloudEndpoint(cfg);
  if (!url) return { ok: false, reason: "off" };
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return { ok: false, reason: res.status === 401 || res.status === 403 ? "denied" : "http", status: res.status };
    const body = await res.json();
    return { ok: true, data: body && typeof body === "object" ? body : null };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "abort" : "network" };
  }
}

export async function cloudPut(cfg, state, vault) {
  const url = cloudEndpoint(cfg);
  if (!url) return { ok: false, reason: "off" };

  // Nothing readable leaves the device once a passphrase is set.
  let body = serialize(state);
  if (vault && vault.ok) {
    try { body = await vault.seal(body); }
    catch { return { ok: false, reason: "sealfail" }; }
  }

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { ok: false, reason: res.status === 401 || res.status === 403 ? "denied" : "http", status: res.status };
    return { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export function cloudStatusText(reason, status) {
  switch (reason) {
    case "off": return "Sync is off — this device only.";
    case "denied": return "Your database rules rejected the request. Check the rules in the Firebase console.";
    case "http": return `The database answered ${status}. Check the database URL.`;
    case "network": return "Couldn't reach the database. Saved on this device.";
    case "sealfail": return "Couldn't encrypt before sending, so nothing was sent.";
    case "locked": return "The cloud record is encrypted and this device's passphrase doesn't open it.";
    default: return "";
  }
}

/* ------------------------------------------------------------- the store */

export async function openStore() {
  let cfg = await config.get();
  let state = hydrate(await local.get(KEY_STATE));
  const listeners = new Set();
  let pollTimer = null;
  let status = { cloud: cloudEndpoint(cfg) ? "pending" : "off", msg: "" };
  let vault = null;

  /** Build (or rebuild) the key from the stored passphrase. */
  async function openLock() {
    if (!cfg.passphrase) { vault = null; return; }
    vault = await openVault({ passphrase: cfg.passphrase, salt: cfg.salt });
    // First time: keep the salt that was generated, or the other device
    // will derive a different key from the same words.
    if (vault.ok && vault.salt && vault.salt !== cfg.salt) {
      cfg = await config.set({ salt: vault.salt });
    }
  }
  await openLock();

  function emit() { for (const cb of listeners) { try { cb(state, status); } catch {} } }

  async function writeLocal() {
    await local.set(KEY_STATE, serialize(state));
  }

  /** Take the incoming copy only when it is genuinely newer. */
  function merge(incoming) {
    if (!incoming || !Array.isArray(incoming.tasks)) return false;
    const inc = hydrate(incoming);
    if ((inc.updatedAt || 0) <= (state.updatedAt || 0)) return false;
    state = inc;
    return true;
  }

  const store = {
    get state() { return state; },
    get status() { return status; },
    get config() { return cfg; },

    get encrypted() { return !!(vault && vault.ok); },

    async setConfig(patch) {
      cfg = await config.set(patch);
      await openLock();
      status = { cloud: cloudEndpoint(cfg) ? "pending" : "off", msg: "" };
      if (cloudEndpoint(cfg)) await store.pull();
      else emit();
      return cfg;
    },

    /** Mutate through here so `updatedAt` is never forgotten. */
    async commit(mutator) {
      const r = mutator(state);
      if (r && typeof r === "object") state = r;
      state.updatedAt = Date.now();
      await writeLocal();
      emit();
      const put = await cloudPut(cfg, state, vault);
      status = put.ok ? { cloud: "ok", msg: "" }
        : put.reason === "off" ? { cloud: "off", msg: "" }
        : { cloud: "error", msg: cloudStatusText(put.reason, put.status) };
      emit();
    },

    async pull() {
      const got = await cloudGet(cfg);
      if (got.ok) {
        let incoming = got.data;

        if (isEncrypted(incoming)) {
          if (!vault || !vault.ok) {
            status = { cloud: "error", msg: "The cloud record is encrypted. Enter the passphrase in Setup to read it." };
            emit();
            return status;
          }
          // The salt travels with the record, so a device that has the
          // words but not the salt can still catch up.
          if (incoming.salt && incoming.salt !== cfg.salt) {
            cfg = await config.set({ salt: incoming.salt });
            await openLock();
          }
          try {
            incoming = await vault.open(incoming);
          } catch {
            status = { cloud: "error", msg: cloudStatusText("locked") };
            emit();
            return status;
          }
        }

        status = { cloud: "ok", msg: vault && vault.ok ? "" : "Sync is on but NOT encrypted. Set a passphrase in Setup." };
        if (merge(incoming)) { await writeLocal(); }
      } else if (got.reason !== "abort") {
        status = got.reason === "off" ? { cloud: "off", msg: "" }
          : { cloud: "error", msg: cloudStatusText(got.reason, got.status) };
      }
      emit();
      return status;
    },

    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** Poll while a page is open and visible. Cheap, and avoids SSE edge cases. */
    startPolling(everyMs = 45000) {
      store.stopPolling();
      if (!cloudEndpoint(cfg)) return;
      pollTimer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") store.pull();
      }, everyMs);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") store.pull();
        });
      }
    },
    stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  };

  // Another surface of this extension (popup vs new tab) wrote — adopt it.
  local.watch(KEY_STATE, raw => {
    if (raw && merge(raw)) emit();
  });

  return store;
}

export { emptyState };
