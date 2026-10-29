import { dist, STATUSES, type Cat, type Doc, type Issue, type Status } from "./logic";
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
  if (d.issues.filter(o => o.id !== i.id && o.status !== "resolved" && !o.hidden && dist(o, i) < 150).length >= 2) add("Part of a recurring problem area", 8);
  if (i.verif === "verified" || i.verif === "review") add("Reviewed by a coordinator", 4);
  const score = Math.min(100, reasons.reduce((a, r) => a + r.pts, 0));
  return { score, level: score >= 70 ? "critical" : score >= 50 ? "high" : score >= 30 ? "medium" : "low", reasons };
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