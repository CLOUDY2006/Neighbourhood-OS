import { dist, STATUSES, type Cat, type Doc, type Issue, type Status, missionSpot } from "./logic";
import { proposeMission } from "./agent";
import { routeFor } from "./routes";

export const EFFORT: Record<Cat, number> = { garbage: 12, pothole: 4, streetlight: 2, water: 3, unsafe: 3, blocked: 4, other: 4 };
export const AUTH_NEEDED: Record<Cat, boolean> = { garbage: false, pothole: true, streetlight: true, water: true, unsafe: true, blocked: true, other: true };
const BASE: Record<Cat, number> = { unsafe: 30, water: 18, blocked: 18, pothole: 14, streetlight: 12, garbage: 10, other: 6 };
const REPORTED: Record<string, number> = { low: 0, medium: 8, high: 16, critical: 26 };
const PROGRESS: Record<Status, number> = { reported: 0, review: 0, assigned: 0.1, progress: 0.5, pending: 0.9, resolved: 1 };

export const effortFor = (i: Issue) => Math.max(0.5, Math.round(EFFORT[i.cat] * ({ low: 0.8, medium: 1, high: 1.2, critical: 1.4 }[i.priority]) * (1 - PROGRESS[i.status]) * 10) / 10);

export function priorityScore(d: Doc, i: Issue) {
  if (i.status === "resolved") return { score: 0, level: "resolved", reasons: [{ label: "Already resolved", pts: 0 }] };
  const reasons: { label: string; pts: number }[] = [];
  const add = (label: string, pts: number) => { if (pts) reasons.push({ label, pts }); };
  add(`Type of problem: ${i.cat}`, BASE[i.cat]);
  add(`Priority chosen by the reporter: ${i.priority}`, REPORTED[i.priority]);
  add(`${i.reports} neighbor report${i.reports === 1 ? "" : "s"}`, Math.min(20, (i.reports - 1) * 4));
  const days = (Date.now() - i.created) / 86400000;
  add(`Open for ${days.toFixed(1)} days`, Math.min(12, Math.floor(days * 2)));
  if (d.resources.some(r => (r.kind === "shelter" || r.kind === "aid") && dist(r, i) < 250)) add("Close to a shelter or aid post", 6);
  if (d.issues.filter(o => o.id !== i.id && o.status !== "resolved" && !o.hidden && dist(o, i) < 150).length >= 2) add("Part of a recurring problem area", 8);
  if (i.verif === "verified" || i.verif === "review") add("Reviewed by a coordinator", 4);
  const score = Math.min(100, reasons.reduce((a, r) => a + r.pts, 0));
  return { score, level: score >= 70 ? "critical" : score >= 50 ? "high" : score >= 30 ? "medium" : "low", reasons };
}

/** One thing to do. done: true or false when the app can tell, null when it cannot (a person ticks it on paper). */
export interface PlanStep { text: string; who: string; day: number; done: boolean | null }
export interface PlanPhase { title: string; goal: string; steps: PlanStep[] }

const DAY = 864e5;
const rank = (s: Status) => STATUSES.indexOf(s);

/** What is different about each kind of problem. Plain, fixed text: no AI, no guessing about local law. */
const CAT_PLAN: Record<Cat, { goal: string; community: string[]; dont: string[]; watch: string[]; materials: (n: number) => string[] }> = {
  garbage: {
    goal: "The waste is removed and the spot is clean, shown by an after photo taken from the same spot.",
    community: ["Hold one cleanup session with gloves and bags", "Take the waste only to the nearest municipal collection point", "Ask neighbors not to dump here again"],
    dont: ["Do not handle sharp, medical or chemical waste", "Do not burn the waste"],
    watch: ["A cleanup alone will not last: ask the authority to confirm the pickup schedule for this spot."],
    materials: n => [`${n * 2} trash bags`, `${n} pairs of gloves`, "Phone with camera"],
  },
  pothole: {
    goal: "The hole is repaired or properly barricaded and the surface is level, shown by an after photo from the same spot.",
    community: ["Photograph the hole with something for scale, such as a shoe or a pen", "Note the road name, the lane and how deep it looks", "Ask the road authority to repair it; volunteers do not fill it"],
    dont: ["Do not stand in the traffic lane to take photos", "Do not try to repair it with loose material on a busy road"],
    watch: ["Rain can make a pothole worse quickly. Say so in the complaint if water collects there."],
    materials: () => ["Phone with camera", "Something for scale (shoe or pen)", "Printed copy of the complaint"],
  },
  streetlight: {
    goal: "The light works after dark, confirmed by a night-time photo or by a neighbor who checked.",
    community: ["Note the pole number, which is often painted on the pole", "Check after dark whether it is one light or the whole stretch", "Ask a neighbor on the other side to confirm"],
    dont: ["Never touch poles, wires or electrical boxes"],
    watch: ["Verify the fix after dark. A daytime photo cannot show that the light works."],
    materials: () => ["Phone with camera (night mode if it has one)", "A note of the pole number", "Printed copy of the complaint"],
  },
  water: {
    goal: "The leak is stopped and the road surface is dry, shown by an after photo from the same spot.",
    community: ["Photograph where the water comes out and where it flows", "Note since when it has been leaking and whether the water looks clean or dirty", "Ask neighbors to tell the same office if their supply is low or dirty"],
    dont: ["Do not open or close valves", "Do not dig or touch the pipe"],
    watch: ["If tap water looks dirty, tell the authority and your neighbors, because it can be a health risk."],
    materials: () => ["Phone with camera", "A notebook for the time it started", "Printed copy of the complaint"],
  },
  unsafe: {
    goal: "The hazard is removed or made safe by the authority, shown by an after photo from the same spot.",
    community: ["Describe the hazard clearly and say when it is worst, for example at night", "Warn neighbors from a safe distance", "Keep children and others away from it"],
    dont: ["Do not approach or try to repair the hazard", "Do not delay calling the local emergency number if someone may be hurt"],
    watch: ["Danger to life is an emergency. Call the local emergency number first; this plan is for the follow-up."],
    materials: () => ["Reflective tape or cones (only if safe to place)", "Phone with camera"],
  },
  blocked: {
    goal: "The road is clear and traffic or access is back to normal, shown by an after photo from the same spot.",
    community: ["Note what is blocking the road, which lanes it covers, and whether an ambulance could pass", "Warn drivers only from a safe distance"],
    dont: ["Do not move large objects such as a fallen tree", "Do not stand on the carriageway"],
    watch: ["If an ambulance or fire engine cannot get through, treat it as an emergency."],
    materials: () => ["Reflective tape or cones (only if safe to place)", "Phone with camera"],
  },
  other: {
    goal: "The problem is resolved and the person who reported it confirms it, with an after photo if possible.",
    community: ["Describe the problem clearly and add a photo", "Ask neighbors who see it too to confirm"],
    dont: ["Do not take any risk to fix it yourself"],
    watch: [],
    materials: () => ["Phone with camera", "Printed copy of the complaint"],
  },
};

/**
 * A working action plan for one report, built from the report itself: where it is, what the authority needs,
 * what has already been done, and when to follow up. Everything here is a suggestion that a coordinator approves.
 * `now` is a parameter so the dates are testable. Day 0 is the day the plan was approved, or today if it was not.
 */
export function actionPlan(d: Doc, i: Issue, now = Date.now()) {
  const route = routeFor(i.cat), pm = proposeMission(i), ps = priorityScore(d, i), hours = effortFor(i), cp = CAT_PLAN[i.cat];
  const m = d.missions.find(x => x.id === i.missionId);
  const hist = i.agent?.history ?? [], last = hist[hist.length - 1];
  const ref = (last?.ref || i.handoff?.ref || "").trim();
  const sent = hist.length > 0 || !!i.handoff;
  const replied = i.handoff?.status === "acknowledged" || i.handoff?.status === "resolved" || rank(i.status) >= rank("progress");
  const hasAfter = i.proof.some(p => p.photo), joined = m?.joined.length ?? 0;
  const base = i.actionPlan?.approvedAt ?? now;
  const needsAuthority = AUTH_NEEDED[i.cat];
  // Only worth printing when a coordinator marked a meeting spot that is not simply the report's own location.
  const spot = m && m.lat != null && m.lng != null ? missionSpot(d, m) : null;
  const days = needsAuthority ? route.deadlineDays + 1 : Math.max(1, Math.ceil(hours / (pm.need * 2)));
  const fixDay = needsAuthority ? route.deadlineDays + 1 : days + 1;

  const phases: PlanPhase[] = [
    { title: "1. Document and confirm", goal: "Make the report easy to act on.", steps: [
      { text: "Take a clear before photo from the spot", who: "Reporter or volunteer", day: 0, done: !!i.photo },
      { text: "Confirm the pin on the map and note a nearby landmark", who: "Coordinator", day: 0, done: rank(i.status) >= rank("review") },
      { text: "Gather the details the authority needs (see the checklist below)", who: "Reporter", day: 0, done: sent },
    ] },
    { title: "2. Get the authority to act", goal: `Complaint to ${route.authority}.`, steps: [
      { text: "Approve the complaint draft and send it yourself", who: "Reporter or coordinator", day: 1, done: sent },
      { text: "Write down the reference number the authority gives", who: "Coordinator", day: 1, done: !!ref },
      { text: `Follow up if there is no reply within ${route.deadlineDays} day${route.deadlineDays === 1 ? "" : "s"}`, who: "Coordinator", day: route.deadlineDays, done: replied },
    ] },
    { title: needsAuthority ? "3. Community support" : "3. Community cleanup", goal: needsAuthority ? "Neighbors back the complaint safely while the authority works." : "Neighbors fix it together, safely.", steps: [
      { text: needsAuthority ? "Approve the plan and create a follow-up mission" : "Approve the plan and create the cleanup mission", who: "Coordinator", day: 0, done: !!i.missionId },
      { text: `Get ${pm.need} volunteer${pm.need === 1 ? "" : "s"} to join${m ? ` (${joined} so far)` : ""}`, who: "Volunteers", day: 1, done: joined >= 1 },
      ...cp.community.map(text => ({ text, who: needsAuthority ? "Volunteers and neighbors" : "Volunteers", day: needsAuthority ? 1 : days + 1, done: null as boolean | null })),
    ] },
    { title: "4. Prove it is fixed", goal: "A person checks the result. Nothing counts as fixed until then.", steps: [
      { text: "Take an after photo from the same spot as the before photo", who: "Volunteer or coordinator", day: fixDay, done: hasAfter },
      { text: "Submit the fix for review", who: "Coordinator", day: fixDay, done: rank(i.status) >= rank("pending") },
      { text: "The reporter confirms it is fixed, or a different reviewer approves it", who: "Reporter or reviewer", day: fixDay + 1, done: i.status === "resolved" },
    ] },
  ];

  let acc = 0;
  const ladder = route.ladder.map((l, k) => { acc += l.waitDays; return { afterDays: acc, to: l.to, date: hist[0] ? hist[0].sentAt + acc * DAY : undefined, done: hist.length > k + 1 }; });
  const watch = [...cp.watch];
  if (i.reports >= 3) watch.push(`${i.reports} residents reported this: say so in your follow-up, because it shows how many people are affected.`);
  if ((i.rejections ?? 0) > 0) watch.push("An earlier fix was sent back. Ask the authority what was missed before they try again.");
  if (ps.level === "critical" || ps.level === "high") watch.push("This is high priority: ask the authority for a date by which they will act, and write it down.");
  const tracked = phases.flatMap(p => p.steps).filter(x => x.done !== null);

  return {
    priority: ps, department: route.authority, channel: route.channel, goal: cp.goal, collect: route.include, phases, ladder,
    safetyDo: [pm.safety], safetyDont: cp.dont.filter(x => !pm.safety.toLowerCase().includes(x.replace(/^(Do not|Never) /i, "").replace(/\.$/, "").toLowerCase())), watch, volunteers: pm.need, personHours: hours, materials: cp.materials(pm.need),
    timeline: `about ${days} day${days === 1 ? "" : "s"}`, base, ref, sent, missionSpot: spot,
    progress: { done: tracked.filter(x => x.done).length, total: tracked.length },
    // kept for older callers
    steps: phases.flatMap(p => p.steps.map(x => x.text)), safety: pm.safety,
  };
}

export function statusAt(i: Issue, t: number): Status | null {
  if (t < i.created) return null;
  const rank = (s: Status) => STATUSES.indexOf(s);
  let st: Status = "reported";
  for (const l of i.log) {
    if (l.t > t) continue;
    const m = /^Status moved to (\w+)/.exec(l.text);
    if (m && (STATUSES as string[]).includes(m[1])) { st = m[1] as Status; continue; }
    if (/mission created and assigned|Action plan approved/.test(l.text) && rank(st) < 2) st = "assigned";
    else if (/Progress evidence uploaded/.test(l.text) && rank(st) < 3) st = "progress";
    else if (/Resolution approved/.test(l.text)) st = "resolved";
    else if (/Fix not approved/.test(l.text)) st = "progress";
    else if (/Flagged as not fully fixed/.test(l.text)) st = "review";
  }
  if (i.resolvedAt && i.resolvedAt <= t) st = "resolved";
  else if (st === "resolved") st = "progress";
  return st;
}
export function docAsOf(d: Doc, t: number): Doc {
  return { ...d, sos: [], issues: d.issues.flatMap(i => { const s = statusAt(i, t); return s ? [{ ...i, status: s }] : []; }) };
}