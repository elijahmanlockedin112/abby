/* =====================================================================
   Locked In — outside sources that feed the inbox.

   A source produces a CAPTURE, exactly like a screenshot does. It never
   produces a task. GitHub telling you that you pushed to a repo on
   Tuesday is context; "Continue the repo tonight" is a candidate you
   have to accept, and its quote is the real event line.
   ===================================================================== */

import { makeCapture } from "./inbox.js";
import { uid, SHORTDAY, todayKey } from "./engine.js";

/* ------------------------------------------------------------- GitHub */

const GH = "https://api.github.com";

export async function fetchGitHub(username, token) {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user) return { ok: false, reason: "off" };
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;

  try {
    const res = await fetch(`${GH}/users/${encodeURIComponent(user)}/events/public?per_page=60`, { headers });
    if (res.status === 404) return { ok: false, reason: "nouser" };
    if (res.status === 401 || res.status === 403) {
      const rem = res.headers.get("x-ratelimit-remaining");
      return { ok: false, reason: rem === "0" ? "rate" : "auth" };
    }
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const raw = await res.json();
    return { ok: true, events: normalizeGH(Array.isArray(raw) ? raw : []) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

function normalizeGH(raw) {
  const out = [];
  for (const e of raw) {
    const repo = (e.repo && e.repo.name) || "";
    const at = Date.parse(e.created_at || "") || 0;
    if (!repo || !at) continue;
    let line = "";
    switch (e.type) {
      case "PushEvent": {
        const commits = (e.payload && e.payload.commits) || [];
        const last = commits.length ? commits[commits.length - 1].message.split("\n")[0] : "";
        line = `Pushed ${commits.length || 1} commit${commits.length === 1 ? "" : "s"} to ${repo}` + (last ? ` — "${last}"` : "");
        break;
      }
      case "PullRequestEvent":
        line = `${e.payload?.action || "updated"} pull request in ${repo}` +
               (e.payload?.pull_request?.title ? ` — "${e.payload.pull_request.title}"` : "");
        break;
      case "IssuesEvent":
        line = `${e.payload?.action || "updated"} issue in ${repo}` +
               (e.payload?.issue?.title ? ` — "${e.payload.issue.title}"` : "");
        break;
      case "CreateEvent":
        line = `Created ${e.payload?.ref_type || "something"} in ${repo}`;
        break;
      case "WatchEvent": continue;   // starring isn't work
      default:
        line = `${e.type.replace(/Event$/, "")} in ${repo}`;
    }
    out.push({ repo, at, line, type: e.type });
  }
  return out;
}

export function ghReasonText(reason, status) {
  switch (reason) {
    case "off": return "No GitHub username set.";
    case "nouser": return "GitHub doesn't have a user by that name.";
    case "rate": return "GitHub's hourly limit for anonymous requests is used up. Add a token in Options, or wait.";
    case "auth": return "That GitHub token was rejected.";
    case "http": return `GitHub answered ${status}.`;
    case "network": return "Couldn't reach GitHub.";
    default: return "GitHub didn't load.";
  }
}

/** Fold recent activity into one capture, with per-repo candidates. */
export function githubCapture(events, now = new Date()) {
  const week = now.getTime() - 7 * 86400000;
  const recent = events.filter(e => e.at >= week);
  if (!recent.length) return null;

  const byRepo = new Map();
  for (const e of recent) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo).push(e);
  }

  const lines = [];
  for (const [repo, evs] of byRepo) {
    const last = evs[0];
    const d = new Date(last.at);
    lines.push(`${last.line} (${SHORTDAY[d.getDay()]})`);
  }
  const text = lines.join("\n");

  const cap = makeCapture({
    kind: "github",
    source: `GitHub · ${byRepo.size} repo${byRepo.size === 1 ? "" : "s"} this week`,
    text,
    preview: lines.slice(0, 2).join(" · ")
  });

  // One candidate per repo. The quote is the real activity line, so it
  // passes the same verbatim check every other candidate passes.
  cap.status = "extracted";
  cap.candidates = [...byRepo.entries()].slice(0, 6).map(([repo, evs]) => {
    const short = repo.split("/").pop();
    const d = new Date(evs[0].at);
    return {
      id: uid(),
      title: `Continue ${short}`,
      est: 60,
      due: null,
      dueKind: null,
      quote: `${evs[0].line} (${SHORTDAY[d.getDay()]})`,
      by: "rules",
      accepted: false
    };
  });
  return cap;
}

/* --------------------------------------------------------- browser tabs
   Chrome only. What you left open is a decent record of what you were
   in the middle of — and, like GitHub, it's context until you accept it. */

export async function openTabsCapture() {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) return null;
  let tabs;
  try { tabs = await chrome.tabs.query({}); } catch { return null; }

  const skip = /^(chrome|edge|about|chrome-extension):|newtab|^https?:\/\/(www\.)?(google|bing|duckduckgo)\.[a-z.]+\/?$/i;
  const keep = tabs
    .filter(t => t.url && t.title && !skip.test(t.url) && !skip.test(t.title))
    .slice(0, 25);
  if (keep.length < 3) return null;

  const lines = keep.map(t => {
    let host = "";
    try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch {}
    return `${t.title.trim()} — ${host}`;
  });

  const cap = makeCapture({
    kind: "page",
    source: `${keep.length} open tabs · ${todayKey()}`,
    text: lines.join("\n"),
    preview: lines.slice(0, 2).join(" · ")
  });
  return cap;
}
