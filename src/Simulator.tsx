import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as S from "./store";

const tip = { contentStyle: { background: "#0b1a33", border: "1px solid rgba(110,160,255,.3)", borderRadius: 10, color: "#e8f0ff", fontSize: 12 }, labelStyle: { color: "#8b9bbd" } };
const RULES: Record<S.Rule, string> = { score: "Highest priority score first", oldest: "Oldest first", quick: "Quick wins first (least effort)", hotspot: "Recurring problem areas first" };

export function Simulator({ st, onOverlay }: { st: S.State; onOverlay: (m: Record<string, number | null> | null) => void }) {
  const avail = Math.max(1, st.volunteers.filter(v => v.available).length);
  const [sc, setSc] = useState<S.Scenario>({ volunteers: Math.max(avail, 6), teamSize: 3, hoursPerDay: 2, rule: "score", days: 14, authorityDelay: 5 });
  const [overlay, setOverlay] = useState(false);
  const base = useMemo<S.Scenario>(() => ({ volunteers: avail, teamSize: 3, hoursPerDay: 2, rule: "oldest", days: sc.days, authorityDelay: sc.authorityDelay }), [avail, sc.days, sc.authorityDelay]);
  const a = useMemo(() => S.simulate(st, base), [st, base]), b = useMemo(() => S.simulate(st, sc), [st, sc]);
  useEffect(() => { onOverlay(overlay ? Object.fromEntries(b.issues.map(x => [x.id, x.day])) : null); }, [overlay, b]);
  useEffect(() => () => onOverlay(null), []);
  const data = Array.from({ length: sc.days + 1 }, (_, k) => ({ day: k, "Current setup": a.byDay[k] ?? 0, "This scenario": b.byDay[k] ?? 0 }));
  const done = (r: S.SimResult) => r.issues.length - r.backlog;
  const slider = (label: string, key: keyof S.Scenario, min: number, max: number, unit = "") => (
    <label className="sl"><span>{label}: <b>{sc[key] as number}{unit}</b></span><input type="range" min={min} max={max} value={sc[key] as number} onChange={e => setSc({ ...sc, [key]: Number(e.target.value) })} /></label>
  );
  return (
    <>
      <h3>What-if city simulator</h3>
      <div className="card alertcard"><b>SIMULATION</b><small className="dim">Everything here is an estimate from simple assumptions about effort and teamwork. It does not predict real outcomes, and nothing in it changes any report.</small></div>
      <div className="card form">
        {slider("Volunteers available", "volunteers", 1, 40)}
        {slider("Team size", "teamSize", 1, 8)}
        {slider("Hours per team member per day", "hoursPerDay", 1, 6, " h")}
        {slider("Days to look ahead", "days", 7, 30)}
        {slider("Assumed authority delay (issues needing a department)", "authorityDelay", 0, 14, " d")}
        <label className="sl"><span>Which issue first?</span>
          <select value={sc.rule} onChange={e => setSc({ ...sc, rule: e.target.value as S.Rule })}>{(Object.keys(RULES) as S.Rule[]).map(r => <option key={r} value={r}>{RULES[r]}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} /> Show projected completion on the map (green by day 7, orange by day 14, red after)</label>
      </div>
      <div className="stats">
        <div className="green"><b>{done(b)}</b>Done in {sc.days} d<small>now: {done(a)}</small></div>
        <div className="red"><b>{b.backlog}</b>Backlog<small>now: {a.backlog}</small></div>
        <div className="amber"><b>{b.avgDay || "–"}</b>Avg day<small>now: {a.avgDay || "–"}</small></div>
      </div>
      <div className="card">
        <div className="row between"><b>Projected issues resolved</b><span className="chip amber">Estimate</span></div>
        <ResponsiveContainer width="100%" height={170}><LineChart data={data} margin={{ left: -20, right: 6, top: 6 }}>
          <CartesianGrid stroke="rgba(110,160,255,.12)" vertical={false} /><XAxis dataKey="day" stroke="#8b9bbd" fontSize={11} tickLine={false} /><YAxis allowDecimals={false} stroke="#8b9bbd" fontSize={11} tickLine={false} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="Current setup" stroke="#8b9bbd" dot={false} strokeDasharray="5 4" /><Line type="monotone" dataKey="This scenario" stroke="#3de8ff" dot={false} strokeWidth={2} />
        </LineChart></ResponsiveContainer>
        <small className="dim">The current setup uses today's available volunteers ({avail}), teams of 3, 2 hours a day, oldest issue first.</small>
      </div>
      <div className="card">
        <b>Workload and resources (estimate)</b>
        <p>{b.teams} team{b.teams === 1 ? "" : "s"} · about {b.capacityPerDay} person-hours a day · {b.personHours} person-hours of work in total · about {b.perVolunteerHours} hours per volunteer if shared evenly.</p>
        <small className="dim">Materials: {b.materials.join(", ")}.</small>
      </div>
      <div className="card">
        <b>Projected order of work</b>
        {b.issues.slice(0, 10).map(x => <p key={x.id}>{x.day != null && x.day <= sc.days ? `Day ${x.day}` : "Backlog"}: {x.title}<small className="dim"> · {x.cat} · {x.hours} h{x.team >= 0 ? ` · team ${x.team + 1}` : ""}</small></p>)}
        {!b.issues.length && <small className="dim">No open issues to plan.</small>}
      </div>
      <small className="dim">Assumptions: effort per issue depends on its type and priority; bigger teams are slightly less efficient; switching issues costs half an hour; issues that need a department also wait the assumed delay above. Volunteers cannot repair pipes, wires or roads, so for those the work shown is documentation and follow-up.</small>
    </>
  );
}
