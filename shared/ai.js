/* =====================================================================
   Locked In — the model layer.

   Two providers. OpenAI is the default because GPT-5.1 is what you
   wanted doing the thinking; Anthropic is there if you'd rather.

   What the model does NOT do, on either provider: decide the order of
   your evening. That stays arithmetic in engine.js, so it can't drift.
   What it DOES do:
     · read screenshots and photos (there is no OCR on the device)
     · pull tasks out of messy text the rules pass would miss
     · split a spoken run-on sentence into separate lines
     · answer questions the lookup router doesn't recognise

   The key is stored in local config only. It never goes into the synced
   document, so it does not travel to the cloud or to your phone — put it
   in separately on each device.
   ===================================================================== */

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.1",
    endpoint: "https://api.openai.com/v1/chat/completions",
    keyHint: "sk-proj-…",
    console: "platform.openai.com/api-keys"
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-5",
    endpoint: "https://api.anthropic.com/v1/messages",
    keyHint: "sk-ant-…",
    console: "console.anthropic.com"
  }
};

export const DEFAULT_PROVIDER = "openai";
export const DEFAULT_MODEL = PROVIDERS.openai.defaultModel;

export class AIError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function errorFor(status, body, provider, model) {
  const detail = (body && (body.error?.message || body.message)) || "";
  switch (status) {
    case 401: return new AIError("badkey", `That ${PROVIDERS[provider].label} key was rejected. Check it in Setup.`);
    case 403: return new AIError("forbidden", detail || "That key isn't allowed to use this model.");
    case 404: return new AIError("nomodel",
      `"${model}" isn't a model this key can reach. Open Setup and try another id — the Test button will tell you straight away.`);
    case 413: return new AIError("toobig", "Too much material in one go. Send a smaller piece.");
    case 429: return new AIError("rate", detail.toLowerCase().includes("quota")
      ? "That account is out of credit."
      : "Rate limited. Wait a minute and try again.");
    case 500: case 502: case 503: case 529:
      return new AIError("overloaded", "The API is busy. Try again in a moment.");
    default: return new AIError("http", detail || `The API answered ${status}.`);
  }
}

/**
 * @param {() => {provider?:string, apiKey?:string, model?:string}} getCfg
 */
export function makeAI(getCfg) {
  const cfg = () => {
    const c = getCfg() || {};
    const provider = PROVIDERS[c.provider] ? c.provider : DEFAULT_PROVIDER;
    return { provider, apiKey: c.apiKey || "", model: c.model || PROVIDERS[provider].defaultModel };
  };

  /* --------------------------------------------------------- OpenAI */

  async function callOpenAI({ apiKey, model }, parts, { maxTokens, system, signal }) {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: parts });

    // Newer reasoning models take max_completion_tokens; older ones only
    // know max_tokens. Try the new name, fall back once on a 400 that says so.
    const send = tokenField => fetch(PROVIDERS.openai.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model, messages, [tokenField]: maxTokens }),
      signal
    });

    let res = await send("max_completion_tokens");
    if (res.status === 400) {
      let body = null;
      try { body = await res.clone().json(); } catch {}
      const msg = (body?.error?.message || "").toLowerCase();
      if (msg.includes("max_completion_tokens") || msg.includes("unsupported parameter")) {
        res = await send("max_tokens");
      }
    }

    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw errorFor(res.status, body, "openai", model);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const text = (choice?.message?.content || "").trim();
    if (!text) {
      throw new AIError(choice?.finish_reason === "length"
        ? "truncated" : "empty",
        choice?.finish_reason === "length"
          ? "The reply hit the length limit before it said anything. Try a smaller piece."
          : "The model returned nothing.");
    }
    return text;
  }

  /* ------------------------------------------------------ Anthropic */

  async function callAnthropic({ apiKey, model }, parts, { maxTokens, system, signal }) {
    const res = await fetch(PROVIDERS.anthropic.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: parts }]
      }),
      signal
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw errorFor(res.status, body, "anthropic", model);
    }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) throw new AIError("empty", "The model returned nothing.");
    return text;
  }

  /* ---------------------------------------------- shared call surface */

  /** `parts` is provider-neutral: [{kind:"text",text}] / [{kind:"image",data,mediaType}] */
  async function call(parts, opts = {}) {
    const c = cfg();
    if (!c.apiKey) throw new AIError("nokey", "No API key set.");
    const o = { maxTokens: opts.maxTokens || 1024, system: opts.system, signal: opts.signal };

    const shaped = c.provider === "openai"
      ? parts.map(p => p.kind === "image"
          ? { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } }
          : { type: "text", text: p.text })
      : parts.map(p => p.kind === "image"
          ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }
          : { type: "text", text: p.text });

    try {
      return c.provider === "openai"
        ? await callOpenAI(c, shaped, o)
        : await callAnthropic(c, shaped, o);
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (e && e.name === "AbortError") throw new AIError("cancelled", "Stopped.");
      throw new AIError("network",
        `Couldn't reach ${PROVIDERS[c.provider].label}. Check your connection.`);
    }
  }

  /** Tolerant JSON read: whole reply, else a fenced block, else the first
   *  bracketed value. Models wrap JSON in prose more often than not. */
  function parseJSON(text) {
    const tries = [text];
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) tries.push(fence[1]);
    const first = text.search(/[[{]/);
    const last = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
    for (const t of tries) {
      try { return JSON.parse(t.trim()); } catch {}
    }
    throw new AIError("badjson", "The reply wasn't usable JSON.");
  }

  return {
    hasKey: () => !!cfg().apiKey,
    provider: () => cfg().provider,
    providerLabel: () => PROVIDERS[cfg().provider].label,
    model: () => cfg().model,

    ask: (prompt, opts) => call([{ kind: "text", text: prompt }], opts),

    async askJSON(prompt, opts) {
      return parseJSON(await call([{ kind: "text", text: prompt }], opts));
    },

    askVision(prompt, image, opts) {
      return call(
        [{ kind: "image", data: image.data, mediaType: image.mediaType }, { kind: "text", text: prompt }],
        opts
      );
    },

    /** Cheap liveness check for the setup page. */
    async test() {
      const t = await call([{ kind: "text", text: "Reply with exactly: ok" }], { maxTokens: 400 });
      return { ok: true, model: cfg().model, provider: cfg().provider, said: t.slice(0, 40) };
    }
  };
}
