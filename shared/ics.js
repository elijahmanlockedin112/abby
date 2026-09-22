/* =====================================================================
   Locked In — iCalendar feed reader.

   Why a feed and not the Google Calendar API: the API needs an OAuth
   client registered against a published extension ID. A secret .ics URL
   is one copy-paste from Calendar settings and works from both the
   extension and the phone with a plain fetch.

   Known limit, stated rather than hidden: a TZID time is read as local
   time. That is exact when the calendar's timezone matches the device's
   (the normal case) and off by the offset difference when it doesn't.
   UTC times ending in Z are converted properly.
   ===================================================================== */

const DAY = 86400000;
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) {
  // RFC 5545: a line beginning with a space or tab continues the one before.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescape(v) {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function parseLine(line) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const left = line.slice(0, i), value = line.slice(i + 1);
  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params = {};
  for (let k = 1; k < parts.length; k++) {
    const eq = parts[k].indexOf("=");
    if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1);
  }
  return { name, params, value };
}

function icsTime(value, params) {
  const v = (value || "").trim();
  if (/^\d{8}$/.test(v)) {
    const t = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)).getTime();
    return { t, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m;
  if (z) return { t: Date.UTC(+Y, +M - 1, +D, +h, +mi, +s), allDay: false };
  if (params && params.VALUE === "DATE") {
    return { t: new Date(+Y, +M - 1, +D).getTime(), allDay: true };
  }
  return { t: new Date(+Y, +M - 1, +D, +h, +mi, +s).getTime(), allDay: false };
}

function parseRRule(v) {
  const out = {};
  for (const part of (v || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/** Expand DAILY and WEEKLY recurrences inside the window. Other
 *  frequencies fall through as their single original occurrence. */
function expand(ev, rule, from, to) {
  const freq = (rule.FREQ || "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") return [ev];

  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
  const untilParsed = rule.UNTIL ? icsTime(rule.UNTIL, {}) : null;
  const until = untilParsed ? untilParsed.t : null;

  const days = rule.BYDAY
    ? rule.BYDAY.split(",").map(d => BYDAY[d.trim().slice(-2).toUpperCase()]).filter(d => d != null)
    : null;

  const dur = ev.end - ev.start;
  const first = new Date(ev.start);
  const out = [];
  let emitted = 0;

  // Walk day by day from the series start (or the window, whichever is later)
  // to the end of the window. A school term is a few hundred iterations.
  const startDay = new Date(Math.max(ev.start, from - DAY));
  startDay.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0);

  const hardStop = new Date(to + DAY);
  for (let d = new Date(startDay); d <= hardStop; d.setDate(d.getDate() + 1)) {
    const t = d.getTime();
    if (t < ev.start) continue;
    if (until && t > until) break;

    const daysSince = Math.floor((new Date(t).setHours(0, 0, 0, 0) - new Date(ev.start).setHours(0, 0, 0, 0)) / DAY);
    if (daysSince < 0) continue;

    let hit;
    if (freq === "DAILY") {
      hit = daysSince % interval === 0;
    } else {
      const weeksSince = Math.floor(daysSince / 7);
      hit = weeksSince % interval === 0 &&
        (days ? days.includes(d.getDay()) : d.getDay() === first.getDay());
    }
    if (!hit) continue;
    if (ev.exdates && ev.exdates.has(new Date(t).setHours(0, 0, 0, 0))) continue;

    emitted++;
    if (count && emitted > count) break;
    if (t + dur >= from && t <= to) {
      out.push({ title: ev.title, start: t, end: t + dur, allDay: ev.allDay, location: ev.location });
    }
  }
  return out;
}

/**
 * @returns {{title:string,start:number,end:number,allDay:boolean,location:string|null}[]}
 */
export function parseICS(text, from, to) {
  const lines = unfold(String(text || "")).split("\n");
  const events = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (t === "BEGIN:VEVENT") { cur = { title: "", start: null, end: null, allDay: false, location: null, rrule: null, exdates: new Set() }; continue; }
    if (t === "END:VEVENT") {
      if (cur && cur.start != null) {
        if (cur.end == null) cur.end = cur.start + (cur.allDay ? DAY : 60 * 60000);
        if (!cur.title) cur.title = "Untitled event";
        const base = { title: cur.title, start: cur.start, end: cur.end, allDay: cur.allDay, location: cur.location, exdates: cur.exdates };
        if (cur.rrule) events.push(...expand(base, cur.rrule, from, to));
        else if (base.end >= from && base.start <= to) events.push({ title: base.title, start: base.start, end: base.end, allDay: base.allDay, location: base.location });
      }
      cur = null; continue;
    }
    if (!cur) continue;

    const p = parseLine(t);
    if (!p) continue;
    switch (p.name) {
      case "SUMMARY": cur.title = unescape(p.value); break;
      case "LOCATION": cur.location = unescape(p.value) || null; break;
      case "DTSTART": { const d = icsTime(p.value, p.params); if (d) { cur.start = d.t; cur.allDay = d.allDay; } break; }
      case "DTEND": { const d = icsTime(p.value, p.params); if (d) cur.end = d.t; break; }
      case "DURATION": {
        const m = p.value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
        if (m && cur.start != null) {
          cur.end = cur.start + ((+m[1] || 0) * DAY + (+m[2] || 0) * 3600000 + (+m[3] || 0) * 60000);
        }
        break;
      }
      case "RRULE": cur.rrule = parseRRule(p.value); break;
      case "EXDATE": {
        for (const one of p.value.split(",")) {
          const d = icsTime(one, p.params);
          if (d) cur.exdates.add(new Date(d.t).setHours(0, 0, 0, 0));
        }
        break;
      }
      case "STATUS": if (p.value.toUpperCase() === "CANCELLED") cur.start = null; break;
    }
  }

  events.sort((a, b) => a.start - b.start);
  return events;
}

/** True only inside the loaded Chrome extension, where host_permissions
 *  let us fetch Google's servers directly. A plain web page cannot:
 *  Google's .ics endpoint sends no CORS headers, so the browser blocks
 *  the read before it ever reaches the network. */
function inExtension() {
  return typeof chrome !== "undefined" && chrome.runtime && !!chrome.runtime.id;
}

/** Fetch and parse a secret .ics URL. Returns {ok, events} or {ok:false, reason}. */
export async function fetchCalendar(icsUrl, from, to) {
  if (!icsUrl) return { ok: false, reason: "off" };
  let url = icsUrl.trim();
  // Calendar hands out a webcal:// link in some places; it's plain https.
  url = url.replace(/^webcal:\/\//i, "https://");
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, reason: res.status === 404 ? "notfound" : "http", status: res.status };
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, reason: "notics" };
    return { ok: true, events: parseICS(text, from, to) };
  } catch {
    // A thrown fetch from a normal page is almost always the CORS block,
    // not a dead network. Saying "couldn't reach it" sends you hunting
    // for a problem with your URL that isn't there.
    return { ok: false, reason: inExtension() ? "network" : "cors" };
  }
}

export function calStatusText(reason, status) {
  switch (reason) {
    case "off": return "No calendar feed set. Add your secret .ics address in options to see blocked time.";
    case "notfound": return "That feed URL returned 404. Copy the secret iCal address again from Calendar settings.";
    case "notics": return "That URL didn't return a calendar file. It should end in .ics";
    case "http": return `The calendar feed answered ${status}.`;
    case "cors": return "Your URL is probably fine — Google blocks calendar reads from a plain web page. This works once you load the Chrome extension (chrome://extensions → Developer mode → Load unpacked), which is allowed to fetch it. Save the URL now and it'll start working there.";
    case "network": return "Couldn't reach the calendar feed. The plan below still works — it just won't know about blocked time.";
    default: return "The calendar feed didn't load.";
  }
}
