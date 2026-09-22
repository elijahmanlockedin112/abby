const base = "../shared/";
const E = await import(base + "engine.js");
const G = await import(base + "goals.js");
const I = await import(base + "inbox.js");

let pass = 0, fail = 0;
const t = (name, cond, extra="") => { if (cond) { pass++; console.log("  PASS " + name); } else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); } };

// A Monday at 4:37pm, bedtime 8pm => 3h23m
const now = new Date(2026, 8, 21, 16, 37, 0);
const s = E.emptyState();
s.bedtime = "20:00";
s.tasks = E.parseList(
  "- Biology ch 4 review — test Thursday (35m)\n" +
  "* FFA quiz prep 45m\n" +
  "1. Finish GitHub project 1h\n" +
  "[ ] Math pset\n", 30, now);

console.log("\nPARSING");
t("4 lines -> 4 tasks", s.tasks.length === 4, `got ${s.tasks.length}`);
t("bullets stripped, words kept", s.tasks[0].title.startsWith("Biology ch 4 review"), s.tasks[0].title);
t("(35m) read as 35", s.tasks[0].est === 35, String(s.tasks[0].est));
t("45m read as 45", s.tasks[1].est === 45, String(s.tasks[1].est));
t("1h read as 60", s.tasks[2].est === 60, String(s.tasks[2].est));
t("unmarked gets default 30", s.tasks[3].est === 30 && s.tasks[3].estGuessed === true);
t("Thursday -> a date 3 days out", E.daysBetween(now, new Date(s.tasks[0].due + "T00:00:00")) === 3, s.tasks[0].due);
t("'test' recognised as the kind", s.tasks[0].dueKind === "Test", String(s.tasks[0].dueKind));
t("no deadline written -> null", s.tasks[3].due === null);

console.log("\nORDERING + LAYOUT");
const plan = E.buildPlan(s, now);
const order = plan.segs.filter(x => x.type === "task").map(x => x.task.title.slice(0, 7));
t("deadline item goes first", order[0].startsWith("Biology"), order.join(" | "));
t("ties keep the typed order", order[1].startsWith("FFA") && order[2].startsWith("Finish"), order.join(" | "));
t("35+45+60+30 = 170m fits in 203m", plan.spill.length === 0, `spill ${plan.spill.length}`);
t("leftover becomes free, not filler", plan.freeMin > 30 && plan.freeMin < 34, String(Math.round(plan.freeMin)));

console.log("\nTHE LEDGER  (the whole promise)");
const L = E.ledger(s, plan);
t("uploaded = 4", L.uploaded === 4, String(L.uploaded));
t("accounted for = 4", L.accounted === 4, String(L.accounted));
t("INVENTED = 0", L.invented === 0, String(L.invented));

// Overload the evening and confirm nothing is silently squeezed.
const s2 = E.hydrate(E.serialize(s));
s2.tasks.push(E.makeTask("Write the whole essay 3h", 4, 30, now));
const plan2 = E.buildPlan(s2, now);
t("overflow is named, not compressed", plan2.spill.length === 1, `spill ${plan2.spill.length}`);
t("estimates untouched by overflow", s2.tasks.every(x => [35,45,60,30,180].includes(x.est)));
t("ledger still balances when overflowing", E.ledger(s2, plan2).invented === 0);

console.log("\nCALENDAR TAKES TIME, NEVER ADDS WORK");
const ev = [{ title: "FFA Chapter Meeting", start: +new Date(2026,8,21,17,30), end: +new Date(2026,8,21,18,30), allDay: false }];
const plan3 = E.buildPlan(s, now, ev);
t("busy block appears in the plan", plan3.segs.some(x => x.type === "busy"));
t("no task was created from the event", E.ledger(s, plan3).accounted === 4, String(E.ledger(s, plan3).accounted));
t("60m of work pushed out of the evening", plan3.spill.length === 1, `spill ${plan3.spill.length}`);

console.log("\nFUTURE ME  (deterministic trajectory)");
const s3 = E.hydrate(E.serialize(s));
const goal = G.makeGoal({ title: "Finish FFA prep", targetDate: "2026-10-20", totalMin: 360 });
goal.createdAt = +new Date(2026, 8, 14);   // set a week ago
s3.goals = [goal];
s3.log = [
  { date: "2026-09-15", at: +new Date(2026,8,15), taskId:"a", title: "FFA quiz prep", status: "done", minutes: 40, est: 45 },
  { date: "2026-09-18", at: +new Date(2026,8,18), taskId:"b", title: "FFA quiz prep", status: "done", minutes: 25, est: 45 }
];
const tr = G.trajectory(s3, goal, now, []);
t("logged minutes attributed by name match", tr.doneMin === 65, String(tr.doneMin));
t("remaining = 360 - 65", tr.remainMin === 295, String(tr.remainMin));
t("behind pace is detected", tr.behind > 0, `behind ${Math.round(tr.behind)}m`);
t("pace sentence names the real date", G.paceSentence(tr, now).text.includes("October 20"), G.paceSentence(tr, now).text);
const adj = G.adjustmentSentence(tr, now);
t("adjustment names concrete evenings", /\d+m|\dh/.test(adj), adj);
console.log("       -> " + G.paceSentence(tr, now).text);
console.log("       -> " + adj);

console.log("\nQUOTE GATE  (why the inbox can't invent)");
const source = "Read chapter 4 before Thursday\nBring the FFA jacket\nLunch money";
const good = [{ title: "Read chapter 4", quote: "Read chapter 4 before Thursday" }];
const made = [{ title: "Study for the midterm", quote: "Study for the midterm on Friday" }];
const mixed = I.verifyCandidates([...good, ...made], source);
t("a real quote survives", mixed.kept.length === 1, String(mixed.kept.length));
t("a fabricated quote is dropped", mixed.dropped.length === 1, String(mixed.dropped.length));
t("whitespace/curly-quote differences still match",
   I.verifyCandidates([{ quote: "Read   chapter 4 before Thursday" }], source).kept.length === 1);

const cands = I.extractDeterministic({ text: source }, now);
t("rules pass finds the actionable lines", cands.length === 2, cands.map(c=>c.title).join(" | "));
t("rules pass ignores 'Lunch money'", !cands.some(c => /lunch/i.test(c.title)));

console.log("\nDATE PARSING vs REAL SCHOOL TEXT");
const dueOf = line => { const r = E.parseDue(line, now); return r ? E.todayKey(r.due) : null; };
t("section numbers are not dates", dueOf("Read chapter 4 sections 4.1-4.3") === null, String(dueOf("Read chapter 4 sections 4.1-4.3")));
t("page ranges are not dates", dueOf("Read pp. 12-15") === null, String(dueOf("Read pp. 12-15")));
t("problem ranges are not dates", dueOf("Do problems 3-7") === null, String(dueOf("Do problems 3-7")));
t("decimal section refs are not dates", dueOf("Lab 2.3/2.4 writeup") === null, String(dueOf("Lab 2.3/2.4 writeup")));
t("a real slash date still parses", dueOf("Essay due 10/15") === "2026-10-15", String(dueOf("Essay due 10/15")));
t("month > 12 is rejected", dueOf("Read 13/45 of the book") === null, String(dueOf("Read 13/45 of the book")));
t("Feb 31 is rejected", dueOf("turn in 2/31") === null, String(dueOf("turn in 2/31")));
t("a day name still wins", dueOf("Unit 2 test is Thursday") !== null);
t("a past date rolls to next year", dueOf("due 1/4") === "2027-01-04", String(dueOf("due 1/4")));

console.log("\nEXTRACTION ON A REAL ASSIGNMENT PAGE");
const page = "AP Bio — Week of Sept 21\nRead chapter 4 sections 4.1-4.3 before Thursday\nComplete the photosynthesis worksheet\nUnit 2 test is Thursday\nMr. Harmon office hours Tue/Thu 3:15\nBring your lab notebook";
const found = I.extractDeterministic({ text: page }, now);
t("the heading is not a task", !found.some(c => /Week of Sept/i.test(c.title)));
t("office hours are not a task", !found.some(c => /office hours/i.test(c.title)), found.map(c=>c.title).join(" | "));
t("the reading assignment is found", found.some(c => /sections 4\.1/.test(c.title)));
const reading = found.find(c => /sections 4\.1/.test(c.title));
// "before Thursday" is a real deadline; "4.1-4.3" must NOT become Jan 4.
t("its deadline is the Thursday it names",
  reading && E.daysBetween(now, new Date(reading.due + "T00:00:00")) === 3,
  String(reading && reading.due));
t("every candidate quotes the page verbatim", I.verifyCandidates(found, page).dropped.length === 0);

console.log("\nVOICE — a run-on sentence into lines");
const V = await import(base + "voice.js");

const spoken = "biology chapter four review thirty five minutes then FFA quiz prep forty five minutes and finish the github project an hour";
const lines = V.splitDictation(spoken);
t("splits into the 3 things said", lines.length === 3, lines.join(" | "));
t("'thirty five minutes' becomes 35m", /35m/.test(lines[0]), lines[0]);
t("'forty five minutes' becomes 45m", /45m/.test(lines[1]), lines[1]);
t("'an hour' becomes 1h", /1h/.test(lines[2]), lines[2]);
t("the leading 'and' is dropped", !/^and /i.test(lines[2]), lines[2]);
console.log("       -> " + lines.join("  //  "));

t("half an hour -> 30m", /\b30m\b/.test(V.normalizeDurations("study for half an hour")));
t("an hour and a half -> 90m", /\b90m\b/.test(V.normalizeDurations("practice an hour and a half")));
t("two and a half hours -> 150m", /\b150m\b/.test(V.normalizeDurations("read two and a half hours")));

const prep = V.splitDictation("spend thirty minutes on biology then math");
t("doesn't split mid-phrase at 'minutes of/on'", prep[0].includes("biology"), prep.join(" | "));

const filler = V.splitDictation("um okay so biology review thirty minutes uh then math");
t("filler words are dropped", filler.length === 2, filler.join(" | "));
t("and don't leak into a line", !/\bum\b|\buh\b/i.test(filler.join(" ")), filler.join(" | "));

const withDay = V.splitDictation("biology chapter four before thursday thirty five minutes then ffa quiz");
t("a spoken day survives the split", /thursday/i.test(withDay[0]), withDay[0]);
const asTasks = E.parseList(lines.join("\n"), 30, now);
t("the spoken lines parse straight into tasks", asTasks.length === 3 && asTasks[0].est === 35, String(asTasks[0].est));
t("and the ledger still balances", (() => {
  const st = E.emptyState(); st.bedtime = "22:00"; st.tasks = asTasks;
  return E.ledger(st, E.buildPlan(st, now)).invented === 0;
})());

console.log("\nREMINDERS — \"throw it at me, tell me on the day\"");
const R = await import(base + "reminders.js");

const spotify = R.parseReminder("cancel spotify subscription on november 30", now);
t("a dated line becomes a reminder", !!spotify);
t("the date is read correctly", spotify.at === "2026-11-30", String(spotify && spotify.at));
t("the date phrase is cut out of the text", !/november/i.test(spotify.text), spotify.text);
t("the rest of the sentence survives", /cancel spotify subscription/i.test(spotify.text), spotify.text);
console.log("       -> " + spotify.text + "  |  " + spotify.at + "  |  " + R.whenWord(spotify, now));

const withRemind = R.parseReminder("remind me to pay FFA dues on Friday", now);
t("'remind me to' is stripped", /^pay ffa dues$/i.test(withRemind.text), withRemind.text);
t("a weekday resolves to a real date", E.daysBetween(now, new Date(withRemind.at + "T00:00:00")) === 4, withRemind.at);

const timed = R.parseReminder("call the dentist tomorrow at 9am", now);
t("a time is picked up", timed.time === "09:00", String(timed && timed.time));
t("and the text is clean", /^call the dentist$/i.test(timed.text), timed.text);

t("'in 2 weeks' works", R.parseReminder("renew the library book in 2 weeks", now).at === "2026-10-05",
  String(R.parseReminder("renew the library book in 2 weeks", now).at));
t("a line with no date is refused", R.parseReminder("cancel spotify subscription", now) === null);

console.log("\nREMINDERS — firing");
const rs = E.emptyState();
rs.reminders = [
  R.makeReminder({ text: "Cancel Spotify", at: "2026-11-30" }),
  R.makeReminder({ text: "Pay dues", at: "2026-09-20" }),          // yesterday
  R.makeReminder({ text: "Later thing", at: "2027-03-01" })
];
t("only the past-due one fires now", R.dueNow(rs, now).length === 1, String(R.dueNow(rs, now).length));
t("and it's the right one", R.dueNow(rs, now)[0].text === "Pay dues", R.dueNow(rs, now)[0].text);
t("it reports how late it is", /yesterday/i.test(R.overdueNote(R.dueNow(rs, now)[0], now)),
  R.overdueNote(R.dueNow(rs, now)[0], now));
rs.reminders[1].firedAt = Date.now();
t("once fired it doesn't fire again", R.dueNow(rs, now).length === 0);
t("but it still stands until dismissed", R.standing(rs, now).length === 1);
t("the next wake-up is the Nov 30 one",
  new Date(R.nextFireTime(rs, now)).getMonth() === 10, String(new Date(R.nextFireTime(rs, now)).toDateString()));

console.log("\nREMINDERS stay out of the evening plan");
const mixSt = E.emptyState();
mixSt.bedtime = "22:00";
mixSt.tasks = E.parseList("Biology review 35m\nMath pset 30m", 30, now);
mixSt.reminders = rs.reminders;
const mixedPlan = E.buildPlan(mixSt, now);
t("reminders are not scheduled as work",
  mixedPlan.segs.filter(s => s.type === "task").length === 2,
  String(mixedPlan.segs.filter(s => s.type === "task").length));
t("and the ledger is unaffected", E.ledger(mixSt, mixedPlan).invented === 0);
t("a far-off dated line is spotted as a reminder, not a task",
  R.looksLikeReminder("cancel spotify subscription on november 30", now) === true);
t("tonight's homework is NOT mistaken for a reminder",
  R.looksLikeReminder("Biology ch 4 review test Thursday 35m", now) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
