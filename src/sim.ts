import { dist, hotspots, type Cat, type Doc } from "./logic";
import { AUTH_NEEDED, effortFor, priorityScore } from "./plan";

export type Rule = "score" | "oldest" | "quick" | "hotspot";
export interface Scenario { volunteers: number; teamSize: number; hoursPerDay: number; rule: Rule; days: number; authorityDelay: number }
export interface SimIssue { id: string; title: string; cat: Cat; hours: number; day: number | null; team: number }
export interface SimResult { issues: SimIssue[]; byDay: number[]; teams: number; capacityPerDay: number; personHours: number; backlog: number; avgDay: number; perVolunteerHours: number; materials: string[] }

export function simulate(d: Doc, sc: Scenario): SimResult {
  const open = d.issues.filter(i => i.status !== "resolved" && !i.hidden);
  const spots = hotspots(d), hot = (i: { lat: number; lng: number }) => (spots.some(h => dist(h, i) < 150) ? 1 : 0);
  const score = (id: string) => priorityScore(d, d.issues.find(i => i.id === id)!).score;
  const queue = [...open].sort((a, b) => {
    if (sc.rule === "oldest") return a.created - b.created;
    if (sc.rule === "quick") return effortFor(a) - effortFor(b);
    if (sc.rule === "hotspot") return hot(b) - hot(a) || score(b.id) - score(a.id);
    return score(b.id) - score(a.id);
  });
  const teams = Math.max(0, Math.floor(sc.volunteers / Math.max(1, sc.teamSize)));
  const capacity = sc.teamSize * sc.hoursPerDay / (1 + 0.08 * (sc.teamSize - 1));
  const out: SimIssue[] = queue.map(i => ({ id: i.id, title: i.title, cat: i.cat, hours: effortFor(i), day: null, team: -1 }));
  const cur = new Array<number>(teams).fill(-1), rem = new Array<number>(teams).fill(0);
  let next = 0;
  for (let day = 1; day <= sc.days; day++) {
    for (let t = 0; t < teams; t++) {
      let c = capacity;
      while (c > 1e-6) {
        if (cur[t] < 0) {
          if (next >= out.length) break;
          cur[t] = next++; rem[t] = out[cur[t]].hours; out[cur[t]].team = t; c = Math.max(0, c - 0.5);
          if (c <= 0) break;
        }
        const w = Math.min(c, rem[t]); c -= w; rem[t] -= w;
        if (rem[t] <= 1e-6) { const s = out[cur[t]]; s.day = day + (AUTH_NEEDED[s.cat] ? sc.authorityDelay : 0); cur[t] = -1; }
      }
    }
  }
  const byDay = Array.from({ length: sc.days + 1 }, (_, k) => out.filter(s => s.day != null && s.day <= k).length);
  const done = out.filter(s => s.day != null && s.day <= sc.days);
  const personHours = Math.round(out.reduce((a, s) => a + s.hours, 0) * 10) / 10;
  const bags = done.filter(s => s.cat === "garbage").length * 12;
  return {
    issues: out, byDay, teams, capacityPerDay: Math.round(capacity * teams * 10) / 10, personHours,
    backlog: out.length - done.length, avgDay: done.length ? Math.round((done.reduce((a, s) => a + (s.day ?? 0), 0) / done.length) * 10) / 10 : 0,
    perVolunteerHours: Math.round((personHours / Math.max(1, sc.volunteers)) * 10) / 10,
    materials: [bags ? `about ${bags} trash bags` : "", done.some(s => s.cat === "blocked" || s.cat === "unsafe") ? "reflective tape or cones" : "", "phones with cameras for evidence"].filter(Boolean),
  };
}
