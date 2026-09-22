/* Two catches a day: 6:40 before you leave, 5pm once you're home. */
const R = await import("../shared/reminders.js");
const E = await import("../shared/engine.js");

let pass = 0, fail = 0;
const t = (n, c, x = "") => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? "  -> " + x : "")); } };
const at = (h, m = 0) => new Date(2026, 8, 25, h, m, 0);
const hhmm = ts => new Date(ts).toTimeString().slice(0, 5);

console.log("\nTWO SLOTS BY DEFAULT");
const r = R.makeReminder({ text: "Bring the lab notebook", at: "2026-09-25" });
const slots = R.fireSlots(r);
t("two slots", slots.length === 2, String(slots.length));
t("first is 06:40", hhmm(slots[0]) === "06:40", hhmm(slots[0]));
t("second is 17:00", hhmm(slots[1]) === "17:00", hhmm(slots[1]));

console.log("\nA STATED TIME OVERRIDES BOTH");
const timed = R.makeReminder({ text: "Call the dentist", at: "2026-09-25", time: "09:00" });
t("only one slot", R.fireSlots(timed).length === 1);
t("and it's the one you said", hhmm(R.fireSlots(timed)[0]) === "09:00", hhmm(R.fireSlots(timed)[0]));

console.log("\nTHROUGH THE DAY");
const st = E.emptyState();
st.reminders = [r];

t("6:00am — nothing yet", R.dueNow(st, at(6, 0)).length === 0);
t("6:45am — the morning catch fires", R.dueNow(st, at(6, 45)).length === 1);

R.markFired(r, at(6, 45));
t("...and doesn't fire again at 7", R.dueNow(st, at(7, 0)).length === 0);
t("nor at noon", R.dueNow(st, at(12, 0)).length === 0);
t("5:05pm — the evening catch fires", R.dueNow(st, at(17, 5)).length === 1, String(R.dueNow(st, at(17,5)).length));

R.markFired(r, at(17, 5));
t("...and that's the last of it", R.dueNow(st, at(20, 0)).length === 0);
t("it still stands until dismissed", R.standing(st, at(20, 0)).length === 1);

console.log("\nSET IT LATE — ONE NOTIFICATION, NOT A PILE");
const late = R.makeReminder({ text: "Pay dues", at: "2026-09-25" });
const st2 = E.emptyState();
st2.reminders = [late];
t("at 6pm both slots have passed", R.fireSlots(late).every(ts => ts <= +at(18, 0)));
t("but only one thing is due", R.dueNow(st2, at(18, 0)).length === 1);
R.markFired(late, at(18, 0));
t("and firing clears both", R.dueNow(st2, at(19, 0)).length === 0);
t("both recorded", late.firedSlots.length === 2, String(late.firedSlots.length));

console.log("\nTHE NEXT WAKE-UP");
const st3 = E.emptyState();
st3.reminders = [R.makeReminder({ text: "Thing", at: "2026-09-25" })];
t("at 6am it's the 6:40 slot", hhmm(R.nextFireTime(st3, at(6, 0))) === "06:40", hhmm(R.nextFireTime(st3, at(6,0))));
R.markFired(st3.reminders[0], at(6, 45));
t("after the morning it's the 5pm slot", hhmm(R.nextFireTime(st3, at(7, 0))) === "17:00", hhmm(R.nextFireTime(st3, at(7,0))));

console.log("\nCUSTOM TIMES FROM CONFIG");
const custom = ["07:30", "20:00"];
t("config times are honoured", hhmm(R.fireSlots(r, custom)[0]) === "07:30", hhmm(R.fireSlots(r, custom)[0]));

console.log("\nSURVIVES A ROUND-TRIP");
const st4 = E.emptyState();
const rr = R.makeReminder({ text: "Cancel Spotify", at: "2026-11-30" });
R.markFired(rr, new Date(2026, 10, 30, 7, 0));
st4.reminders = [rr];
const back = E.hydrate(E.serialize(st4));
t("firedSlots persist", (back.reminders[0].firedSlots || []).length === 1,
  String((back.reminders[0].firedSlots || []).length));
t("so it won't re-fire after a reload",
  R.dueNow(back, new Date(2026, 10, 30, 8, 0)).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
