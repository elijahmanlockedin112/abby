/* The map only exists if every node can point at the words that made it. */
const C = await import("../shared/contextmap.js");
const E = await import("../shared/engine.js");

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };

console.log("\nWHAT IT RECOGNISES");
const line = "Biology ch 4 review for Mr. Harmon test Thursday";
const ents = C.entitiesIn(line);
const names = ents.map(e => e.name + ":" + e.type);
t("finds the teacher", names.includes("Mr. Harmon:person"), names.join(" | "));
t("finds the class", names.includes("Biology:class"), names.join(" | "));
t("normalises 'ch 4' to 'chapter 4'", names.includes("chapter 4:topic"), names.join(" | "));

t("Coach gets no bogus period",
  C.entitiesIn("FFA quiz prep with Coach Daniels").some(e => e.name === "Coach Daniels"),
  C.entitiesIn("FFA quiz prep with Coach Daniels").map(e => e.name).join(" | "));
t("'Bio' and 'Biology' are the same node",
  C.entitiesIn("bio homework")[0].name === "Biology",
  C.entitiesIn("bio homework").map(e => e.name).join(" | "));
t("a repo is a project", C.entitiesIn("push elijah/abby tonight").some(e => e.type === "project"));
t("AM/PM are not clubs", !C.entitiesIn("meet at 7 PM").some(e => e.type === "org"));

console.log("\nEVERY NODE CARRIES ITS SOURCE");
const map = C.emptyMap();
C.observeLine(map, line, "task");
t("nodes were created", map.nodes.length >= 3, String(map.nodes.length));
t("edges were created", map.edges.length >= 1, String(map.edges.length));
t("EVERY node quotes something", map.nodes.every(n => n.evidence.length > 0));
t("and the quote is the real line", map.nodes.every(n => n.evidence[0].text === line));
t("every edge quotes something too", map.edges.every(e => e.evidence.length > 0));

const harmon = map.nodes.find(n => n.id === "mr-harmon");
const bio = map.nodes.find(n => n.id === "biology");
const teaches = map.edges.find(e => e.kind === "teaches");
t("teacher↔class becomes 'teaches'", !!teaches, map.edges.map(e => e.kind).join(", "));
t("and it links those two",
  teaches && [teaches.a, teaches.b].sort().join() === [harmon.id, bio.id].sort().join());

console.log("\nSEEING IT TWICE STRENGTHENS, NEVER DUPLICATES");
C.observeLine(map, "Biology ch 4 review for Mr. Harmon test Thursday", "task");
const before = map.nodes.length;
C.observeLine(map, "more Biology tonight", "task");
t("no duplicate Biology node", map.nodes.filter(n => n.id === "biology").length === 1);
t("its count went up", map.nodes.find(n => n.id === "biology").seen >= 3,
  String(map.nodes.find(n => n.id === "biology").seen));
t("identical evidence isn't stored twice",
  map.nodes.find(n => n.id === "biology").evidence.filter(e => e.text === line).length === 1);

console.log("\nTHE MODEL GETS NO SPECIAL PRIVILEGE");
const fakeAI = {
  hasKey: () => true,
  askJSON: async () => ([
    { from: "Mr. Harmon", fromType: "person", to: "Biology", toType: "class", relation: "teaches",
      quote: "Biology ch 4 review for Mr. Harmon" },
    { from: "Mrs. Invented", fromType: "person", to: "Calculus", toType: "class", relation: "teaches",
      quote: "Mrs. Invented teaches Calculus on Tuesdays" }
  ])
};
const m2 = C.emptyMap();
const res = await C.observeWithModel(m2, line, "ai", fakeAI);
t("the grounded relation is kept", res.added === 1, String(res.added));
t("the fabricated one is dropped", res.dropped === 1, String(res.dropped));
t("and its node never appears", !m2.nodes.some(n => /invented/i.test(n.name)),
  m2.nodes.map(n => n.name).join(" | "));

console.log("\nFOLDING IN A WHOLE STATE");
const now = new Date(2026, 8, 21, 16, 37);
const st = E.emptyState();
st.tasks = E.parseList("Biology ch 4 review 35m\nFFA quiz prep 45m\nPush elijah/abby 1h", 30, now);
const m3 = C.emptyMap();
C.observeState(m3, st);
t("the whole list is mapped", m3.nodes.length >= 4, String(m3.nodes.length));
t("still every node has evidence", m3.nodes.every(n => n.evidence.length > 0));
t("summary names real things", C.mapSummary(m3).includes("Biology"), C.mapSummary(m3).split("\n")[0]);

console.log("\nFORGETTING");
C.forget(m3, "biology");
t("the node is gone", !m3.nodes.some(n => n.id === "biology"));
t("and no dangling edges remain", m3.edges.every(e => e.a !== "biology" && e.b !== "biology"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
