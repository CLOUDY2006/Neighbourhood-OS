import { emptyDoc, reduce, type Cat, type Doc, type Issue } from "../src/logic";
import { actionPlan } from "../src/plan";
import { ROUTES } from "../src/routes";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const DAY = 864e5, NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test" };
const R = { role: "resident" as const, name: "Res #1" }, R2 = { role: "resident" as const, name: "Res #2" };
const CATS: Cat[] = ["garbage", "pothole", "streetlight", "water", "unsafe", "blocked", "other"];

function docWith(cat: Cat, priority: "low" | "medium" | "high" | "critical" = "medium") {
  const d = reduce(emptyDoc(), R, { t: "report", title: `Problem ${cat}`, desc: "Something is wrong here", cat, priority, lat: 28.567, lng: 77.212 }, b).doc;
  return { d, i: d.issues[0] };
}
const steps = (p: ReturnType<typeof actionPlan>) => p.phases.flatMap(x => x.steps);
const find = (p: ReturnType<typeof actionPlan>, part: string) => steps(p).find(x => x.text.includes(part))!;

// ---- 1. every problem type gets a complete plan built from its own route
for (const cat of CATS) {
  const { d, i } = docWith(cat), p = actionPlan(d, i, NOW), r = ROUTES[cat];
  const okShape = p.phases.length === 4 && p.phases.every(x => x.title && x.goal && x.steps.length >= 2) && steps(p).every(x => x.text && x.who && x.day >= 0 && Number.isFinite(x.day));
  check(`${cat}: four phases, every step has text, owner and a day`, okShape);
  check(`${cat}: goal, safety and watch-outs are written for this problem`, p.goal.length > 30 && p.safetyDont.length >= 1 && p.safetyDo.length === 1);
  check(`${cat}: the complaint checklist is the route's own list`, JSON.stringify(p.collect) === JSON.stringify(r.include) && p.collect.length >= 3);
  let acc = 0; const sums = r.ladder.map(l => (acc += l.waitDays));
  check(`${cat}: escalation ladder days add up`, p.ladder.length === r.ladder.length && p.ladder.every((l, n) => l.afterDays === sums[n] && l.to === r.ladder[n].to && !l.done && l.date === undefined));
  check(`${cat}: follow-up step uses the route's waiting period`, find(p, "Follow up").day === r.deadlineDays);
}

// ---- 2. the plans really differ by problem
const plans = Object.fromEntries(CATS.map(c => { const { d, i } = docWith(c); return [c, actionPlan(d, i, NOW)]; })) as Record<Cat, ReturnType<typeof actionPlan>>;
check("all seven goals are different", new Set(CATS.map(c => plans[c].goal)).size === 7);
check("pothole: scale photo and no do-it-yourself repair", plans.pothole.phases[2].steps.some(s => /scale/.test(s.text)) && plans.pothole.phases[2].steps.some(s => /volunteers do not fill/.test(s.text)));
check("streetlight: pole number, check after dark, never touch wires", plans.streetlight.phases[2].steps.some(s => /pole number/.test(s.text)) && /after dark/.test(plans.streetlight.goal) && plans.streetlight.safetyDont.some(s => /wires/.test(s)));
check("water: do not touch valves", plans.water.safetyDont.some(s => /valves/.test(s)));
check("unsafe: emergency number first", plans.unsafe.watch.some(s => /emergency number/.test(s)) && plans.unsafe.safetyDont.some(s => /emergency number/.test(s)));
check("garbage: cleanup phase and bags scale with volunteers", plans.garbage.phases[2].title === "3. Community cleanup" && plans.garbage.materials.some(m => m === `${plans.garbage.volunteers * 2} trash bags`));
check("authority problems: community support phase, not a cleanup", plans.pothole.phases[2].title === "3. Community support");
check("authority problems finish the fix after the waiting period", find(plans.pothole, "Submit the fix").day === ROUTES.pothole.deadlineDays + 1);

// ---- 3. the plan follows what has actually happened
{
  const { d, i } = docWith("pothole");
  let p = actionPlan(d, i, NOW);
  check("fresh report: nothing tracked is done", p.progress.done === 0 && p.progress.total >= 8, `(${p.progress.done}/${p.progress.total})`);
  check("steps the app cannot see are marked as not tracked (null)", steps(p).some(s => s.done === null));
  i.photo = "abc"; p = actionPlan(d, i, NOW);
  check("a before photo ticks the first step", find(p, "before photo").done === true);
  i.status = "review"; p = actionPlan(d, i, NOW);
  check("under review ticks 'confirm the pin'", find(p, "Confirm the pin").done === true);
  i.agent = { lang: "en", original: "", summaryEn: "", source: "rules", draft: { subject: "", body: "" }, history: [{ level: 0, to: "X", sentAt: NOW - 2 * DAY }], created: NOW } as unknown as Issue["agent"];
  p = actionPlan(d, i, NOW);
  check("a sent complaint ticks 'send', but not the reference number", find(p, "send it yourself").done === true && find(p, "reference number").done === false && p.sent && p.ref === "");
  (i.agent!.history[0] as { ref?: string }).ref = "GRV/2026/0042"; p = actionPlan(d, i, NOW);
  check("the reference number is recorded and shown", find(p, "reference number").done === true && p.ref === "GRV/2026/0042");
  check("escalation dates count from the day it was sent", p.ladder[0].date === NOW - 2 * DAY + ROUTES.pothole.ladder[0].waitDays * DAY);
  i.handoff = { to: "X", ref: "GRV/2026/0042", sentAt: NOW - 2 * DAY, by: "Adm", status: "acknowledged" }; p = actionPlan(d, i, NOW);
  check("an acknowledgement ticks the follow-up", find(p, "Follow up").done === true);
  d.missions.push({ id: "m1", title: "T", issueId: i.id, need: 3, joined: ["Vol #1", "Vol #2"], hours: 0, done: false }); i.missionId = "m1"; p = actionPlan(d, i, NOW);
  check("mission and volunteers tick, and the count is shown", find(p, "follow-up mission").done === true && find(p, "volunteers to join").done === true && /2 so far/.test(find(p, "volunteers to join").text));
  i.proof.push({ by: "Vol #1", t: NOW, text: "done", photo: "after" }); p = actionPlan(d, i, NOW);
  check("an after photo ticks that step", find(p, "after photo").done === true);
  i.status = "pending"; p = actionPlan(d, i, NOW);
  check("pending ticks 'submit the fix', the last step is still open", find(p, "Submit the fix").done === true && find(p, "reporter confirms").done === false);
  i.status = "resolved"; p = actionPlan(d, i, NOW);
  check("resolved: every tracked step is done", p.progress.done === p.progress.total && p.progress.total > 0, `(${p.progress.done}/${p.progress.total})`);
  check("the total number of tracked steps never changes while the report moves along", p.progress.total === actionPlan(docWith("pothole").d, docWith("pothole").i, NOW).progress.total);
}

// ---- 4. dates
{
  const { d, i } = docWith("water");
  check("not approved: day 0 is today", actionPlan(d, i, NOW).base === NOW);
  i.actionPlan = { approvedBy: "Adm #1", approvedAt: NOW - 3 * DAY };
  check("approved: day 0 is the approval day", actionPlan(d, i, NOW).base === NOW - 3 * DAY);
}

// ---- 5. watch-outs come from the report's own facts
{
  const { d, i } = docWith("pothole", "low");
  check("a quiet report has only the generic watch-out", actionPlan(d, i, NOW).watch.length === 1);
  i.reports = 4; i.rejections = 1; i.priority = "critical";
  const w = actionPlan(d, i, NOW).watch.join(" | ");
  check("several reporters, an earlier rejected fix and high priority each add a watch-out", /4 residents/.test(w) && /sent back/.test(w) && /high priority/.test(w));
}

// ---- 6. privacy: no resident or volunteer names in the plan that gets printed
{
  const { d, i } = docWith("garbage");
  let x: Doc = reduce(d, R2, { t: "merge", id: i.id }, b).doc;
  x.missions.push({ id: "m1", title: "T", issueId: i.id, need: 3, joined: ["Vol #9"], hours: 0, done: false }); x.issues[0].missionId = "m1";
  x.issues[0].proof.push({ by: "Vol #9", t: NOW, text: "done" });
  const text = JSON.stringify(actionPlan(x, x.issues[0], NOW));
  check("no resident or volunteer names appear in the plan", !/Res #1|Res #2|Vol #9/.test(text));
}

// ---- 6b. missions that meet somewhere other than the report
{
  const { d, i } = docWith("garbage");
  d.missions.push({ id: "m1", title: "T", issueId: i.id, need: 3, joined: [], hours: 0, done: false }); i.missionId = "m1";
  check("a mission without its own spot prints no extra meeting place", actionPlan(d, i, NOW).missionSpot === null);
  d.missions[0].lat = 28.5701; d.missions[0].lng = 77.2199;
  const sp = actionPlan(d, i, NOW).missionSpot;
  check("a mission with its own spot prints where volunteers meet", !!sp && sp.lat === 28.5701 && sp.lng === 77.2199);
}

// ---- 7. older callers still work
{
  const { d, i } = docWith("blocked"), p = actionPlan(d, i, NOW);
  check("legacy fields are still there", p.steps.length === steps(p).length && typeof p.safety === "string" && typeof p.department === "string" && typeof p.timeline === "string" && p.volunteers > 0);
}

if (bad) { console.log(`${bad} action plan test(s) failed`); process.exitCode = 1; } else console.log("all action plan tests passed");