/* =====================================================================
   Abby — the context map.

   A second brain that builds itself. Every task you write, every thing
   you say out loud, every screenshot you throw in leaves traces: people,
   classes, clubs, projects, topics — and how they connect.

   THE RULE, same as everywhere else in this project:
   a node or an edge exists only if it can point at the exact words that
   created it. Click any connection and you see the line it came from.
   Nothing here is inferred out of thin air, by rules or by a model.
   That's what makes it a memory instead of a hallucination.
   ===================================================================== */

import { uid, todayKey, escapeHtml } from "./engine.js";
import { verifyCandidates } from "./inbox.js";

export const NODE_TYPES = {
  person:  { label: "Person",  color: "#E9B44C" },
  class:   { label: "Class",   color: "#5FBF8A" },
  org:     { label: "Club",    color: "#7EA6F0" },
  project: { label: "Project", color: "#C98BE0" },
  topic:   { label: "Topic",   color: "#E08A52" },
  place:   { label: "Place",   color: "#8FD0C8" },
  thing:   { label: "Thing",   color: "#A6ADBC" }
};

export const EDGE_KINDS = {
  "co-occurs": "came up together",
  "teaches":   "teaches",
  "part-of":   "part of",
  "works-on":  "you work on",
  "due-for":   "due for"
};

const MAX_NODES = 240;
const MAX_EDGES = 520;
const MAX_EVIDENCE = 6;

export const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------------------------- what we can recognise */

const SUBJECTS = [
  "biology", "bio", "chemistry", "chem", "physics", "anatomy", "environmental science",
  "algebra", "geometry", "calculus", "precalculus", "pre-calc", "trig", "trigonometry", "statistics",
  "english", "literature", "lit", "composition", "history", "government", "civics", "economics",
  "psychology", "sociology", "spanish", "french", "german", "latin",
  "art", "band", "choir", "orchestra", "theater", "drama", "health", "gym",
  "computer science", "programming", "woodshop", "welding", "agriculture", "ag", "horticulture"
];

const ORGS = [
  "ffa", "nhs", "national honor society", "4-h", "key club", "beta club", "student council",
  "stuco", "robotics", "debate", "speech", "band", "marching band", "yearbook", "newspaper",
  "scouts", "youth group", "varsity", "jv", "track", "cross country", "wrestling", "basketball",
  "football", "baseball", "softball", "soccer", "volleyball", "tennis", "golf", "swim"
];

/* "Bio" and "Biology" are the same class; "ch 4" and "chapter 4" are the
   same topic. Without this the map grows a twin for every abbreviation
   you happen to use, which is exactly the mess a second brain is for. */
const ALIASES = {
  bio: "Biology", chem: "Chemistry", lit: "Literature", ag: "Agriculture",
  calc: "Calculus", "pre-calc": "Precalculus", precalculus: "Precalculus",
  trig: "Trigonometry", stats: "Statistics", gov: "Government",
  psych: "Psychology", "comp sci": "Computer science", cs: "Computer science",
  gym: "PE", pe: "PE", hw: "Homework",
  "national honor society": "NHS", "student council": "StuCo", stuco: "StuCo",
  "marching band": "Band"
};

function canonical(name, type) {
  let n = String(name).trim();
  const key = n.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  if (type === "topic") {
    // ch 4 / ch. 4 / Ch4  ->  chapter 4
    n = n.replace(/^ch\.?\s*(\d)/i, "chapter $1")
         .replace(/^sec\.?\s*(\d)/i, "section $1")
         .replace(/\s+/g, " ")
         .toLowerCase();
  }
  return n;
}

/* Only the abbreviations actually take a period. "Coach." reads as a typo. */
const DOTTED = new Set(["mr", "mrs", "ms", "dr", "prof"]);
const TITLE_RE = /\b((?:Mr|Mrs|Ms|Miss|Dr|Coach|Prof|Professor|Principal)\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
const ACRONYM_RE = /\b([A-Z]{2,6})\b/g;
const CHAPTER_RE = /\b((?:chapter|ch\.?|unit|lesson|section|lab|module|week)\s*\d+(?:\.\d+)?)/gi;
const REPO_RE = /\b([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)\b/g;

const STOP_ACRONYMS = new Set(["AM", "PM", "TV", "OK", "ID", "US", "UK", "PDF", "AP", "IB", "HW", "TBD", "ASAP"]);

/* ------------------------------------------------------------- the map */

export function emptyMap() {
  return { nodes: [], edges: [], updatedAt: 0 };
}

function evidenceOf(text, source) {
  return { text: String(text || "").slice(0, 220).trim(), source: String(source || "").slice(0, 80), at: Date.now() };
}

/** Add or strengthen a node. Never creates one without evidence. */
export function observeNode(map, { name, type, evidence }) {
  const display = String(name || "").trim();
  if (!display || !evidence || !evidence.text) return null;
  const id = slug(display);
  if (!id) return null;

  let node = map.nodes.find(n => n.id === id);
  if (!node) {
    node = {
      id, name: display, type: NODE_TYPES[type] ? type : "thing",
      seen: 0, firstSeen: Date.now(), lastSeen: Date.now(), evidence: []
    };
    map.nodes.push(node);
  }
  // A more specific type wins over the catch-all.
  if (node.type === "thing" && type && type !== "thing") node.type = type;
  node.seen++;
  node.lastSeen = Date.now();

  const key = evidence.text.toLowerCase();
  if (!node.evidence.some(e => e.text.toLowerCase() === key)) {
    node.evidence.unshift(evidence);
    if (node.evidence.length > MAX_EVIDENCE) node.evidence.length = MAX_EVIDENCE;
  }
  return node;
}

export function observeEdge(map, { a, b, kind, evidence }) {
  if (!a || !b || a === b) return null;
  const [x, y] = [a, b].sort();
  const id = `${x}|${kind}|${y}`;
  let edge = map.edges.find(e => e.id === id);
  if (!edge) {
    edge = { id, a: x, b: y, kind: EDGE_KINDS[kind] ? kind : "co-occurs", weight: 0, evidence: [] };
    map.edges.push(edge);
  }
  edge.weight++;
  edge.lastSeen = Date.now();
  if (evidence && evidence.text) {
    const key = evidence.text.toLowerCase();
    if (!edge.evidence.some(e => e.text.toLowerCase() === key)) {
      edge.evidence.unshift(evidence);
      if (edge.evidence.length > MAX_EVIDENCE) edge.evidence.length = MAX_EVIDENCE;
    }
  }
  return edge;
}

/* -------------------------------------------------- deterministic pass */

/**
 * Pull entities out of one line. Conservative: it would rather miss a
 * person than invent one, because everything it finds shows up on a map
 * you have to look at.
 * @returns {{name:string,type:string}[]}
 */
export function entitiesIn(line) {
  const s = String(line || "");
  const low = s.toLowerCase();
  const out = [];
  const add = (rawName, type) => {
    const n = canonical(rawName, type);
    if (!n || n.length < 2 || n.length > 48) return;
    if (!out.some(o => slug(o.name) === slug(n))) out.push({ name: n, type });
  };

  // Mr. Harmon, Coach Daniels
  let m;
  TITLE_RE.lastIndex = 0;
  while ((m = TITLE_RE.exec(s))) {
    const title = m[1].replace(/\.$/, "");
    add(`${title}${DOTTED.has(title.toLowerCase()) ? "." : ""} ${m[2]}`, "person");
  }

  for (const subj of SUBJECTS) {
    if (new RegExp(`\\b${subj.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(low)) {
      add(subj.charAt(0).toUpperCase() + subj.slice(1), "class");
    }
  }
  for (const org of ORGS) {
    if (new RegExp(`\\b${org.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(low)) {
      add(org.toUpperCase().length <= 4 ? org.toUpperCase() : org.replace(/\b\w/g, c => c.toUpperCase()), "org");
    }
  }

  ACRONYM_RE.lastIndex = 0;
  while ((m = ACRONYM_RE.exec(s))) {
    if (!STOP_ACRONYMS.has(m[1])) add(m[1], "org");
  }

  CHAPTER_RE.lastIndex = 0;
  while ((m = CHAPTER_RE.exec(s))) add(m[1].replace(/\s+/g, " ").toLowerCase(), "topic");

  REPO_RE.lastIndex = 0;
  while ((m = REPO_RE.exec(s))) add(m[1], "project");

  if (/\bgithub\b/i.test(s)) add("GitHub", "project");

  return out;
}

/**
 * Feed one line in. Everything it creates quotes that line.
 * @returns {{nodes:number, edges:number}}
 */
export function observeLine(map, line, source) {
  const ents = entitiesIn(line);
  if (!ents.length) return { nodes: 0, edges: 0 };

  const ev = evidenceOf(line, source);
  const made = [];
  for (const e of ents) {
    const n = observeNode(map, { name: e.name, type: e.type, evidence: ev });
    if (n) made.push(n);
  }

  let edges = 0;
  for (let i = 0; i < made.length; i++) {
    for (let j = i + 1; j < made.length; j++) {
      const A = made[i], B = made[j];
      let kind = "co-occurs";
      if (A.type === "person" && B.type === "class") kind = "teaches";
      else if (B.type === "person" && A.type === "class") kind = "teaches";
      else if (A.type === "topic" && B.type === "class") kind = "part-of";
      else if (B.type === "topic" && A.type === "class") kind = "part-of";
      else if (A.type === "project" || B.type === "project") kind = "works-on";
      if (observeEdge(map, { a: A.id, b: B.id, kind, evidence: ev })) edges++;
    }
  }
  map.updatedAt = Date.now();
  return { nodes: made.length, edges };
}

/** Everything the app already knows, folded in at once. */
export function observeState(map, state) {
  let n = 0, e = 0;
  for (const t of state.tasks || []) {
    const r = observeLine(map, t.raw || t.title, "task");
    n += r.nodes; e += r.edges;
  }
  for (const rm of state.reminders || []) {
    const r = observeLine(map, rm.raw || rm.text, "reminder");
    n += r.nodes; e += r.edges;
  }
  for (const g of state.goals || []) {
    const r = observeLine(map, g.title, "goal");
    n += r.nodes; e += r.edges;
  }
  for (const c of state.inbox || []) {
    if (c.status === "dismissed") continue;
    for (const line of String(c.text || "").split(/\r?\n/).slice(0, 40)) {
      if (!line.trim()) continue;
      const r = observeLine(map, line, c.source || c.kind);
      n += r.nodes; e += r.edges;
    }
  }
  for (const l of (state.log || []).slice(-60)) {
    const r = observeLine(map, l.title, "session");
    n += r.nodes; e += r.edges;
  }
  prune(map);
  return { nodes: n, edges: e };
}

/* -------------------------------------------------------- model pass */

const MAP_PROMPT = `You are reading things a high school student wrote. Pull out the PEOPLE, CLASSES, CLUBS, PROJECTS and TOPICS they mention, and how those connect.

HARD RULES:
- "quote" must be copied CHARACTER FOR CHARACTER from the text below. It is checked; anything whose quote is not found verbatim is thrown away.
- Only name an entity that actually appears in the text. Never infer one.
- Only state a relation the text actually supports.
- "fromType"/"toType" must be one of: person, class, org, project, topic, place, thing
- "relation" must be one of: co-occurs, teaches, part-of, works-on, due-for
- If there is nothing worth mapping, return [].

Reply with only a JSON array of {"from": string, "fromType": string, "to": string, "toType": string, "relation": string, "quote": string}.
Example: [{"from":"Mr. Harmon","fromType":"person","to":"Biology","toType":"class","relation":"teaches","quote":"Mr. Harmon's bio class moved the test"}]

TEXT:
`;

export async function observeWithModel(map, text, source, ai) {
  const body = String(text || "").slice(0, 8000);
  if (!ai || !ai.hasKey() || !body.trim()) return { added: 0, dropped: 0, error: null };

  try {
    const reply = await ai.askJSON(MAP_PROMPT + body, { maxTokens: 1400 });
    if (!Array.isArray(reply)) return { added: 0, dropped: 0, error: "The reply wasn't a list." };

    const proposed = reply.slice(0, 40)
      .map(r => ({
        from: String(r.from || "").trim(),
        fromType: NODE_TYPES[r.fromType] ? r.fromType : "thing",
        to: String(r.to || "").trim(),
        toType: NODE_TYPES[r.toType] ? r.toType : "thing",
        relation: EDGE_KINDS[r.relation] ? r.relation : "co-occurs",
        quote: String(r.quote || "")
      }))
      .filter(r => r.from && r.to);

    const { kept, dropped } = verifyCandidates(proposed, body);

    let added = 0;
    for (const k of kept) {
      const ev = evidenceOf(k.quote, source);
      const A = observeNode(map, { name: k.from, type: k.fromType, evidence: ev });
      const B = observeNode(map, { name: k.to, type: k.toType, evidence: ev });
      if (A && B && observeEdge(map, { a: A.id, b: B.id, kind: k.relation, evidence: ev })) added++;
    }
    prune(map);
    map.updatedAt = Date.now();
    return { added, dropped: dropped.length, error: null };
  } catch (e) {
    return { added: 0, dropped: 0, error: (e && e.message) || "The model call failed." };
  }
}

/* ------------------------------------------------------------ upkeep */

/** Keep the map from growing forever: weakest and stalest go first. */
export function prune(map) {
  if (map.nodes.length > MAX_NODES) {
    map.nodes.sort((a, b) => (b.seen - a.seen) || (b.lastSeen - a.lastSeen));
    const keep = new Set(map.nodes.slice(0, MAX_NODES).map(n => n.id));
    map.nodes = map.nodes.filter(n => keep.has(n.id));
    map.edges = map.edges.filter(e => keep.has(e.a) && keep.has(e.b));
  }
  if (map.edges.length > MAX_EDGES) {
    map.edges.sort((a, b) => (b.weight - a.weight) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
    map.edges.length = MAX_EDGES;
  }
  // An edge whose endpoints vanished is meaningless.
  const ids = new Set(map.nodes.map(n => n.id));
  map.edges = map.edges.filter(e => ids.has(e.a) && ids.has(e.b));
}

export function forget(map, nodeId) {
  map.nodes = map.nodes.filter(n => n.id !== nodeId);
  map.edges = map.edges.filter(e => e.a !== nodeId && e.b !== nodeId);
  map.updatedAt = Date.now();
}

/* ------------------------------------------------------------ reading */

export function neighbours(map, nodeId) {
  const out = [];
  for (const e of map.edges) {
    if (e.a === nodeId) out.push({ edge: e, other: map.nodes.find(n => n.id === e.b) });
    else if (e.b === nodeId) out.push({ edge: e, other: map.nodes.find(n => n.id === e.a) });
  }
  return out.filter(x => x.other).sort((a, b) => b.edge.weight - a.edge.weight);
}

export function degree(map, nodeId) {
  return map.edges.reduce((n, e) => n + (e.a === nodeId || e.b === nodeId ? 1 : 0), 0);
}

export function topNodes(map, n = 8) {
  return [...map.nodes].sort((a, b) => (b.seen - a.seen) || (degree(map, b.id) - degree(map, a.id))).slice(0, n);
}

export function search(map, q) {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return [];
  return map.nodes
    .filter(n => n.name.toLowerCase().includes(s))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 20);
}

/** A short paragraph the Ask router can hand to the model as background. */
export function mapSummary(map, limit = 14) {
  if (!map.nodes.length) return "";
  const lines = [];
  for (const n of topNodes(map, limit)) {
    const near = neighbours(map, n.id).slice(0, 4)
      .map(x => `${x.other.name} (${EDGE_KINDS[x.edge.kind]})`)
      .join(", ");
    lines.push(`${n.name} [${NODE_TYPES[n.type].label}, seen ${n.seen}x]${near ? " — " + near : ""}`);
  }
  return lines.join("\n");
}

export function nodeCard(map, node) {
  const near = neighbours(map, node.id);
  return {
    node,
    type: NODE_TYPES[node.type],
    connections: near,
    evidence: node.evidence,
    summary: `${NODE_TYPES[node.type].label} · seen ${node.seen} time${node.seen === 1 ? "" : "s"} · ${near.length} connection${near.length === 1 ? "" : "s"}`
  };
}

export { escapeHtml };
