import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as S from "./store";
import type { Act } from "./ui";
import { useTheme } from "./a11y";
import { palette, tooltipStyle } from "./theme";

const DAY = 86400000;
const tip = tooltipStyle;

function Box({ title, tag, children }: { title: string; tag: "Actual" | "Estimate"; children: React.ReactNode }) {
  return <div className="card"><div className="row between"><b>{title}</b><span className={`chip ${tag === "Actual" ? "green" : "amber"}`}>{tag}</span></div>{children}</div>;
}

export function Pulse({ st, app, act, demo }: { st: S.State; app: S.AppState; act: Act; demo: boolean }) {
  const P = palette(useTheme()), axis = { stroke: P.chart.axis, fontSize: 11, tickLine: false as const };
  const [range, setRange] = useState(30), [ins, setIns] = useState<S.Insights | null>(null), [busy, setBusy] = useState(false);
  const d = useMemo(() => {
    const now = Date.now(), issues = st.issues.filter(i => !i.hidden);
    const start = range === 0 ? Math.min(now - 7 * DAY, ...issues.map(i => i.created)) : now - range * DAY;
    const n = range === 0 || range > 30 ? 12 : range, step = (now - start) / n;
    const openAt = (t: number) => issues.filter(i => i.created <= t && !(i.resolvedAt && i.resolvedAt <= t)).length;
    const series = Array.from({ length: n }, (_, k) => {
      const a = start + k * step, b = a + step;
      return { label: new Date(b).toLocaleDateString(undefined, { day: "numeric", month: "short" }), reported: issues.filter(i => i.created >= a && i.created < b).length, resolved: issues.filter(i => i.resolvedAt && i.resolvedAt >= a && i.resolvedAt < b).length, open: openAt(b) };
    });
    const inRange = issues.filter(i => i.created >= start);
    const cats = S.CATS.map(c => ({ cat: c, open: inRange.filter(i => i.cat === c && i.status !== "resolved").length, resolved: inRange.filter(i => i.cat === c && i.status === "resolved").length })).filter(x => x.open + x.resolved > 0);
    const hrs = S.CATS.map(c => { const r = issues.filter(i => i.cat === c && i.resolvedAt && i.resolvedAt >= start); return { cat: c, hours: r.length ? Math.round((r.reduce((a, i) => a + (i.resolvedAt! - i.created), 0) / r.length / 3600000) * 10) / 10 : 0 }; }).filter(x => x.hours > 0);
    const missions = st.missions.map(m => ({ name: m.title.length > 16 ? m.title.slice(0, 15) + "…" : m.title, hours: m.hours, volunteers: m.joined.length }));
    const open = issues.filter(i => i.status !== "resolved");
    const resolved = issues.filter(i => i.resolvedAt && i.resolvedAt >= start);
    const avg = resolved.length ? resolved.reduce((a, i) => a + (i.resolvedAt! - i.created), 0) / resolved.length / 3600000 : 0;
    const people = S.leaderboard(st).length;
    return { series, cats, hrs, missions, openThen: openAt(start), openNow: open.length, reports: inRange.length, resolved: resolved.length, avg, effort: Math.round(open.reduce((a, i) => a + S.effortFor(i), 0) * 10) / 10, people, spots: S.hotspots(st), start };
  }, [st, range]);
  return (
    <>
      <div className="row wrap">
        <select value={range} onChange={e => setRange(Number(e.target.value))} aria-label="Date range"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All time</option></select>
        <small className="dim">From {new Date(d.start).toLocaleDateString()}</small>
      </div>
      <div className="stats"><div className="red"><b>{d.reports}</b>Reported</div><div className="green"><b>{d.resolved}</b>Resolved</div><div className="amber"><b>{d.avg ? d.avg.toFixed(1) : "–"}</b>Avg hours to fix</div></div>
      <div className="stats"><div className="red"><b>{d.openNow}</b>Open now</div><div className="amber"><b>{st.missions.filter(m => m.done).length}</b>Missions done</div><div className="green"><b>{d.people}</b>Contributors</div></div>

      <Box title="Before and after" tag="Actual">
        <div className="row between"><span>Open at the start: <b>{d.openThen}</b></span><span>Open now: <b>{d.openNow}</b></span><span className={d.openNow <= d.openThen ? "oktext" : "errtext"}>{d.openNow - d.openThen > 0 ? "+" : ""}{d.openNow - d.openThen}</span></div>
        <small className="dim">Use the Then vs Now button on the map to see the neighborhood at an earlier date.</small>
      </Box>

      <Box title="Reported and resolved" tag="Actual">
        <ResponsiveContainer width="100%" height={170}><AreaChart data={d.series} margin={{ left: -20, right: 6, top: 6 }}>
          <CartesianGrid stroke={P.chart.grid} vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="reported" stroke={P.red} fill={P.red} fillOpacity={0.25} /><Area type="monotone" dataKey="resolved" stroke={P.green} fill={P.green} fillOpacity={0.25} />
        </AreaChart></ResponsiveContainer>
      </Box>
      <Box title="Open issues over time" tag="Actual">
        <ResponsiveContainer width="100%" height={140}><AreaChart data={d.series} margin={{ left: -20, right: 6, top: 6 }}>
          <CartesianGrid stroke={P.chart.grid} vertical={false} /><XAxis dataKey="label" {...axis} interval="preserveStartEnd" /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
          <Area type="stepAfter" dataKey="open" stroke={P.teal} fill={P.teal} fillOpacity={0.2} />
        </AreaChart></ResponsiveContainer>
      </Box>
      <Box title="By category" tag="Actual">
        <ResponsiveContainer width="100%" height={160}><BarChart data={d.cats} margin={{ left: -20, right: 6, top: 6 }}>
          <CartesianGrid stroke={P.chart.grid} vertical={false} /><XAxis dataKey="cat" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="open" stackId="a" fill={P.amber} /><Bar dataKey="resolved" stackId="a" fill={P.green} />
        </BarChart></ResponsiveContainer>
      </Box>
      {d.hrs.length > 0 && (
        <Box title="Average hours to resolve" tag="Actual">
          <ResponsiveContainer width="100%" height={140}><BarChart data={d.hrs} margin={{ left: -20, right: 6, top: 6 }}>
            <CartesianGrid stroke={P.chart.grid} vertical={false} /><XAxis dataKey="cat" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Bar dataKey="hours" fill={P.accent} />
          </BarChart></ResponsiveContainer>
        </Box>
      )}
      {d.missions.length > 0 && (
        <Box title="Volunteer hours and participation by mission" tag="Actual">
          <ResponsiveContainer width="100%" height={150}><BarChart data={d.missions} margin={{ left: -20, right: 6, top: 6 }}>
            <CartesianGrid stroke={P.chart.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="hours" fill={P.teal} /><Bar dataKey="volunteers" fill={P.chart.pink} />
          </BarChart></ResponsiveContainer>
        </Box>
      )}
      <Box title="Resource needs for open issues" tag="Estimate">
        <p>About <b>{d.effort}</b> person-hours of volunteer work.</p>
        <small className="dim">Estimated from simple effort values per type of problem. Real needs depend on each site and on authority response.</small>
      </Box>
      <Box title="Recurring problem areas" tag="Actual">
        {d.spots.map((h, k) => <p key={k}>{h.n} reports of mostly {h.cat} near {h.lat.toFixed(4)}, {h.lng.toFixed(4)}</p>)}
        {!d.spots.length && <small className="dim">No area has repeated reports yet. This shows past reports, not a prediction.</small>}
      </Box>

      <h3>Top contributors</h3>
      {S.leaderboard(st).slice(0, 5).map(x => <p key={x.name}>{x.name}: {x.pts} points</p>)}
      {!S.leaderboard(st).length && <small className="dim">Points count only verified reports and completed fixes.</small>}
      <h3>Community intelligence</h3>
      <button disabled={busy} onClick={() => act(async () => { setBusy(true); try { setIns(await S.aiInsights()); } finally { setBusy(false); } })}>{busy ? "Analyzing…" : "Generate insights"}</button>
      {ins && (
        <div className="card ai">
          <p><b>{ins.summary}</b></p>
          {ins.bullets.map((b, n) => <p key={n}><b>{b.title}:</b> {b.detail}</p>)}
          <small className="dim">{ins.source === "ai" ? "AI-generated. A coordinator should review before acting." : "Rule-based summary."}</small>
        </div>
      )}
      {demo && <small className="dim">All figures come from simulated demo data, not real community results.</small>}
      {app.mode === "live" && <small className="dim">Actual means counted from real reports. Estimate means calculated from assumptions.</small>}
    </>
  );
}
