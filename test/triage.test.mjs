/* A crossed-off line must never come back as a task. */
const T = await import("../shared/triage.js");

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };
const now = new Date(2026, 8, 21, 16, 0);

console.log("\nCROSSED OFF, IN EVERY FORM PEOPLE ACTUALLY USE");
const done = [
  "[DONE] Biology ch 4 review",
  "~~FFA quiz prep~~",
  "[x] Math pset",
  "[X] Read chapter 5",
  "✓ Turn in the form",
  "✗ Call the dentist",
  "x Bring lab notebook"
];
for (const d of done) t(`"${d}"`, T.isCrossedOff(d), "not detected");

console.log("\nNOT CROSSED OFF");
for (const d of ["Biology ch 4 review", "[ ] Math pset", "- FFA quiz prep", "X-ray appointment Friday"]) {
  t(`"${d}"`, !T.isCrossedOff(d), "wrongly treated as done");
}

console.log("\nA REAL PAPER LIST, HALF FINISHED");
const page = [
  "Monday",
  "[DONE] Biology ch 4 review",
  "FFA quiz prep",
  "[x] Math pset problems 3-7",
  "~~Email Mr. Harmon~~",
  "Finish the history essay",
  "✓ Bring gym clothes"
].join("\n");

const res = T.triageLocally(page, 30, now);
const titles = res.tasks.map(x => x.title);
console.log("       kept: " + (titles.join(" | ") || "(none)"));

t("the finished Biology line is gone", !titles.some(x => /biology/i.test(x)));
t("the finished Math line is gone", !titles.some(x => /math pset/i.test(x)));
t("the struck-out email is gone", !titles.some(x => /email/i.test(x)));
t("the ticked gym clothes are gone", !titles.some(x => /gym clothes/i.test(x)));
t("FFA quiz prep survives", titles.some(x => /ffa quiz/i.test(x)), titles.join(" | "));
t("the history essay survives", titles.some(x => /history essay/i.test(x)), titles.join(" | "));
t("the heading isn't a task", !titles.some(x => /^monday$/i.test(x)));

console.log("\nEVEN IF THE MODEL LISTS A FINISHED LINE, IT'S DROPPED");
const fakeAI = {
  hasKey: () => true,
  askJSON: async () => ({
    tasks: [
      { title: "FFA quiz prep", minutes: 45, due: null, quote: "FFA quiz prep" },
      { title: "Math pset problems 3-7", minutes: 30, due: null, quote: "[x] Math pset problems 3-7" }
    ],
    reminders: []
  })
};
const r2 = await T.triage(page, fakeAI, 30, now);
t("the live one is kept", r2.tasks.some(x => /ffa quiz/i.test(x.title)), r2.tasks.map(x=>x.title).join(" | "));
t("the crossed-off one is refused", !r2.tasks.some(x => /math pset/i.test(x.title)), r2.tasks.map(x=>x.title).join(" | "));
t("and it's counted as dropped", r2.dropped >= 1, String(r2.dropped));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
