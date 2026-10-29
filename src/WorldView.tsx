import { memo, useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import land from "./land.json";
import * as S from "./store";
import { useT } from "./i18n";
import type { Act } from "./ui";

const W = 1000, H = 500;
const px = (lng: number) => ((lng + 180) / 360) * W;
const py = (lat: number) => ((90 - lat) / 180) * H;
const TYPES: S.HazardType[] = ["earthquake", "wildfire", "flood", "storm", "volcano", "other"];
const SEV_R: Record<S.Sev, number> = { info: 2.4, watch: 3.4, warning: 5, severe: 6.5 };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(m, 1)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export const LAND_D = (() => {
  const topo = land as unknown as { objects: { land: never } };
  const fc = feature(topo as never, topo.objects.land) as unknown as { type: string; features?: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[]; geometry?: { type: string; coordinates: number[][][] | number[][][][] } };
  const feats = fc.features ?? [fc as { geometry: { type: string; coordinates: number[][][] | number[][][][] } }];
  let d = "";
  // unwrap rings that cross the antimeridian, then draw them again shifted by 360° so no band spans the whole map
  const ring = (r: number[][]) => {
    let off = 0, lo = Infinity, hi = -Infinity;
    const pts = r.map((c, i) => {
      if (i) { const dl = c[0] - r[i - 1][0]; if (dl > 180) off -= 360; else if (dl < -180) off += 360; }
      const x = c[0] + off; lo = Math.min(lo, x); hi = Math.max(hi, x);
      return [x, c[1]];
    });
    const shifts = [0, ...(lo < -180 ? [360] : []), ...(hi > 180 ? [-360] : [])];
    for (const s of shifts) { pts.forEach((c, i) => { d += `${i ? "L" : "M"}${px(c[0] + s).toFixed(1)},${py(c[1]).toFixed(1)}`; }); d += "Z"; }
  };
  for (const f of feats) {
    const g = f.geometry;
    if (g.type === "Polygon") (g.coordinates as number[][][]).forEach(ring);
    else if (g.type === "MultiPolygon") (g.coordinates as number[][][][]).forEach(p => p.forEach(ring));
  }
  return d;
})();

const Land = memo(function Land() {
  const grid: JSX.Element[] = [];
  for (let lng = -150; lng <= 180; lng += 30) grid.push(<line key={"x" + lng} x1={px(lng)} y1={0} x2={px(lng)} y2={H} />);
  for (let lat = -60; lat <= 90; lat += 30) grid.push(<line key={"y" + lat} x1={0} y1={py(lat)} x2={W} y2={py(lat)} />);
  return (
    <g>
      <clipPath id="wm-clip"><rect x="0" y="0" width={W} height={H} /></clipPath>
      <rect className="wm-ocean" x="0" y="0" width={W} height={H} />
      <g className="wm-grid" strokeWidth=".4">{grid}</g>
      <path className="wm-land" clipPath="url(#wm-clip)" d={LAND_D} strokeWidth=".5" strokeLinejoin="round" />
    </g>
  );
});

export function WorldMap({ events, mine, sel, onSel, alerts }: { events: S.WorldEvent[]; mine: { lat: number; lng: number; name: string }; sel: string | null; onSel: (id: string | null) => void; alerts: S.Alert[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [v, setV] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const toSvg = (cx: number, cy: number) => { const s = svg.current!, p = s.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(s.getScreenCTM()!.inverse()); };
  const clampV = (o: { x: number; y: number; k: number }) => ({ k: o.k, x: Math.min(0, Math.max(W - W * o.k, o.x)), y: Math.min(0, Math.max(H - H * o.k, o.y)) });

  useEffect(() => {
    const s = svg.current!;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY), f = e.deltaY < 0 ? 1.2 : 0.83;
      setV(o => { const k = Math.min(14, Math.max(1, o.k * f)), r = k / o.k; return clampV({ k, x: p.x - (p.x - o.x) * r, y: p.y - (p.y - o.y) * r }); });
    };
    s.addEventListener("wheel", h, { passive: false });
    return () => s.removeEventListener("wheel", h);
  }, []);

  const visible = events.filter(e => e.sev !== "info" || e.type === "earthquake" || events.length < 60);
  const selected = events.find(e => e.id === sel);
  return (
    <svg ref={svg} className="isosvg worldsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return;
        const sc = svg.current!.getScreenCTM()!.a, dx = (e.clientX - d.x) / sc, dy = (e.clientY - d.y) / sc;
        if (Math.hypot(dx, dy) * sc > 4) d.moved = true;
        if (d.moved) setV(o => clampV({ ...o, x: d.vx + dx, y: d.vy + dy }));
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) onSel(null); }}>
      <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
        <Land />
        {alerts.map(a => <line key={"l" + a.id} x1={px(a.lng)} y1={py(a.lat)} x2={px(mine.lng)} y2={py(mine.lat)} stroke={S.HAZARD_COLOR[a.type]} strokeWidth={1 / v.k} strokeDasharray={`${4 / v.k} ${3 / v.k}`} opacity=".8" />)}
        {visible.map(e => {
          const r = SEV_R[e.sev] / Math.sqrt(v.k), col = S.HAZARD_COLOR[e.type], on = sel === e.id;
          return (
            <g key={e.id} style={{ cursor: "pointer" }} onPointerDown={ev => ev.stopPropagation()} onClick={() => onSel(e.id)}>
              {S.SEV_RANK[e.sev] >= 2 && <circle cx={px(e.lng)} cy={py(e.lat)} r={r * 2.4} fill={col} className="ring" />}
              <circle cx={px(e.lng)} cy={py(e.lat)} r={r} fill={col} fillOpacity=".8" strokeWidth={(on ? 1.6 : 0.8) / Math.sqrt(v.k)} style={{ stroke: on ? "var(--ink)" : col, filter: `drop-shadow(0 0 ${3 / Math.sqrt(v.k)}px ${col})` }} />
            </g>
          );
        })}
        <g>
          <circle cx={px(mine.lng)} cy={py(mine.lat)} r={6 / Math.sqrt(v.k)} className="wm-me" fill="none" strokeWidth={1.4 / Math.sqrt(v.k)} />
          <circle cx={px(mine.lng)} cy={py(mine.lat)} r={1.8 / Math.sqrt(v.k)} className="wm-me-dot" />
          <text x={px(mine.lng) + 8 / Math.sqrt(v.k)} y={py(mine.lat) - 6 / Math.sqrt(v.k)} fontSize={9 / Math.sqrt(v.k)} className="wm-me-text">{mine.name}</text>
        </g>
        {selected && <text x={px(selected.lng)} y={py(selected.lat) - 10 / Math.sqrt(v.k)} textAnchor="middle" fontSize={9 / Math.sqrt(v.k)} className="wm-label" strokeWidth={2.5 / Math.sqrt(v.k)} paintOrder="stroke">{selected.title}</text>}
      </g>
    </svg>
  );
}

export function WorldPanel({ st, app, sel, onSel, act }: { st: S.State; app: S.AppState; sel: string | null; onSel: (id: string | null) => void; act: Act }) {
  const [on, setOn] = useState<S.HazardType[]>([...TYPES]);
  const events = app.world ?? [];
  const n = app.nbhd!;
  const list = useMemo(() => events.filter(e => on.includes(e.type)).slice(0, 60), [events, on]);
  const km = (e: S.WorldEvent) => Math.round(S.dist({ lat: n.lat, lng: n.lng }, e) / 1000);
  return (
    <>
      <small className="dim">Official public hazard feeds, shown as published. This layer only informs; it never starts a rescue by itself.</small>
      <div className="skills">{TYPES.map(t => <button key={t} className={`chip btn ${on.includes(t) ? "sel" : ""}`} style={on.includes(t) ? { color: S.HAZARD_COLOR[t], borderColor: S.HAZARD_COLOR[t] } : undefined} onClick={() => setOn(on.includes(t) ? on.filter(x => x !== t) : [...on, t])}>{t}</button>)}</div>
      {app.worldInfo && <small className="dim">{app.worldInfo.sources.map(s => `${s.name}: ${s.ok ? `${s.n} events` : "unavailable"}`).join(" · ")}{app.worldInfo.updated ? ` · updated ${ago(app.worldInfo.updated)}` : ""}</small>}
      {!app.world && <p className="dim">Loading world events…</p>}
      {app.world && !list.length && <p className="dim">No events match these filters.</p>}
      {list.map(e => (
        <button key={e.id} className={`issue ${sel === e.id ? "on" : ""}`} onClick={() => onSel(e.id)} style={{ ["--c" as string]: S.HAZARD_COLOR[e.type] }}>
          <span className="dot" /><span className="grow">{e.title}<small>{e.sev} · {e.src} · {ago(e.time)} · {km(e).toLocaleString()} km from {n.name}</small></span>
        </button>
      ))}
      {sel && (() => { const e = events.find(x => x.id === sel); return e && e.url ? <a className="dim" href={e.url} target="_blank" rel="noopener noreferrer">Open the source page for "{e.title.slice(0, 40)}"</a> : null; })()}
      <small className="dim">Sources: USGS, NASA EONET and GDACS. Always follow your national authorities for official warnings.</small>
      <SafetyPlans st={st} app={app} act={act} />
    </>
  );
}

export function AlertBanner({ alerts, onWorld }: { alerts: S.Alert[]; onWorld: () => void }) {
  const t = useT();
  if (!alerts.length) return null;
  const official = S.isOfficial(alerts);
  return (
    <div className={`card alertcard ${official ? "official" : ""}`}>
      <b>{official ? t("Official alert near this neighbourhood") : t("Heads up: hazard activity nearby")}</b>
      {alerts.slice(0, 3).map(a => (
        <div key={a.id}>
          <p>{a.title}{a.km ? `: about ${a.km} km away` : a.area ? `: ${a.area}` : ""}. <small className="dim">{a.src === "CAP" ? "Official alert" : a.src} · {ago(a.time)}</small></p>
          {a.instruction && <p className="pre">{a.instruction}</p>}
        </div>
      ))}
      {official && <p>{t("Follow your national authorities. If anyone is in danger, call your local emergency number first. Read the safety plan from your coordinators below, and check the notices and chat for updates.")}</p>}
      <button onClick={onWorld}>{t("See on the world map")}</button>
    </div>
  );
}
/** Hazards within 100 km of this neighbourhood: official alerts plus the world feed. Coordinators can write a safety plan only while one exists. */
export function nearbyHazards(app: S.AppState): S.Alert[] {
  const n = app.nbhd;
  if (!n) return [];
  const seen = new Set<string>();
  return [...app.alerts.filter(a => a.km <= S.SAFETY_KM), ...S.hazardsNear(app.world ?? [], { lat: n.lat, lng: n.lng })]
    .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
    .sort((a, b) => a.km - b.km);
}

function Row({ label, text }: { label: string; text: string }) {
  return <><p><b>{label}</b></p><p className="pre">{text}</p></>;
}
function PlanBody({ p }: { p: S.SafetyPlan }) {
  return (
    <>
      <Row label="Escape routes" text={p.routes} />
      <Row label="Assembly point" text={p.assembly} />
      {p.contacts && <Row label="Emergency contacts" text={p.contacts} />}
      {p.notes && <Row label="Before you leave" text={p.notes} />}
    </>
  );
}

/** On the normal screen: the approved plan for everyone, and what needs doing for coordinators. */
export function SafetyBanner({ st, app, goWorld }: { st: S.State; app: S.AppState; goWorld: () => void }) {
  const t = useT();
  const all = st.safety ?? [], admin = st.role === "admin";
  const approved = all.filter(p => p.status === "approved");
  const pending = admin ? all.filter(p => p.status === "pending") : [];
  const covered = new Set(all.filter(p => p.status !== "closed").map(p => p.hazardId));
  const open = admin ? nearbyHazards(app).filter(h => !covered.has(h.id)) : [];
  return (
    <>
      {approved.map(p => (
        <div key={p.id} className="card alertcard official">
          <b>{t("Safety plan from your coordinators")}: {p.hazardTitle}</b>
          <small className="dim">About {p.km} km away · approved by {p.approvedBy} · {ago(p.approvedAt ?? p.created)}</small>
          <PlanBody p={p} />
          <small className="dim">{t("This is advice from your neighbourhood coordinators. Follow your national authorities first, and call your local emergency number if anyone is in danger.")}</small>
        </div>
      ))}
      {pending.length > 0 && (
        <div className="card alertcard">
          <b>{pending.length} safety plan{pending.length === 1 ? "" : "s"} waiting for approval</b>
          <button onClick={goWorld}>{t("Review in the World tab")}</button>
        </div>
      )}
      {open.length > 0 && (
        <div className="card alertcard">
          <b>{open[0].title}: about {open[0].km} km away</b>
          <p>{t("A hazard is within 100 km, so you can write a safety plan for the neighbourhood. Another coordinator has to approve it before anyone else sees it.")}</p>
          <button className="go" onClick={goWorld}>{t("Write a safety plan")}</button>
        </div>
      )}
    </>
  );
}

/** Under the world map: approved plans, plans waiting for approval, and the form coordinators use while a hazard is within 100 km. */
export function SafetyPlans({ st, app, act }: { st: S.State; app: S.AppState; act: Act }) {
  const t = useT();
  const admin = st.role === "admin", me = S.myName(), demo = app.mode === "demo";
  const all = st.safety ?? [];
  const near = nearbyHazards(app);
  const covered = new Set(all.filter(p => p.status !== "closed").map(p => p.hazardId));
  const free = near.filter(h => !covered.has(h.id));
  const approved = all.filter(p => p.status === "approved"), pending = all.filter(p => p.status === "pending"), closed = all.filter(p => p.status === "closed");
  const [f, setF] = useState({ hazard: "", routes: "", assembly: "", contacts: "", notes: "" });
  const [why, setWhy] = useState("");
  const chosen = free.find(h => h.id === f.hazard) ?? free[0];
  return (
    <>
      <h3>{t("Safety plans")}</h3>
      {near.length === 0 && <p className="dim">No hazard is within {S.SAFETY_KM} km of this neighbourhood right now. When one is, coordinators can write a safety plan here, and an approved plan appears on the Command tab.</p>}
      {near.length > 0 && <p className="dim">{near.length} hazard{near.length === 1 ? " is" : "s are"} within {S.SAFETY_KM} km: {near.slice(0, 3).map(h => `${h.title} (${h.km} km)`).join(", ")}.</p>}
      {approved.length === 0 && pending.length === 0 && <p className="dim">No safety plan has been approved yet.</p>}
      {approved.map(p => (
        <div key={p.id} className="card alertcard official">
          <b>{p.hazardTitle}</b>
          <small className="dim">About {p.km} km away · approved by {p.approvedBy} · {ago(p.approvedAt ?? p.created)}</small>
          <PlanBody p={p} />
          {admin && <button className="warn" onClick={() => act(() => S.safetyClose(p.id), "Plan closed")}>{t("Close this plan")}</button>}
        </div>
      ))}
      {admin && pending.map(p => (
        <div key={p.id} className="card">
          <b>{p.hazardTitle}: waiting for approval</b>
          <small className="dim">Written by {p.by === me ? "you" : p.by} · {ago(p.created)}. Only coordinators can see it until it is approved.</small>
          <PlanBody p={p} />
          {p.by === me ? (
            <>
              <small className="dim">{t("A different coordinator must approve this plan.")}</small>
              <div className="row wrap">
                <button className="warn" onClick={() => act(() => S.safetyClose(p.id), "Plan withdrawn")}>{t("Withdraw")}</button>
                {demo && <button onClick={() => act(() => S.demoSafetyApprove(p.id), "Approved as another coordinator (demo)")}>{t("Demo: approve as another coordinator")}</button>}
              </div>
            </>
          ) : (
            <div className="row wrap">
              <button className="go" onClick={() => act(() => S.safetyApprove(p.id), "Approved. Everyone can read it on the Command tab")}>{t("Approve")}</button>
              <input value={why} maxLength={200} placeholder={t("Why send it back? (optional)")} onChange={e => setWhy(e.target.value)} aria-label="Reason" />
              <button className="warn" onClick={() => act(async () => { await S.safetyReject(p.id, why); setWhy(""); }, "Plan sent back")}>{t("Send back")}</button>
            </div>
          )}
        </div>
      ))}
      {admin && free.length > 0 && (
        <div className="form">
          <h3>{t("Write a safety plan")}</h3>
          <small className="dim">{t("You can write a plan while a hazard is within 100 km. Another coordinator must approve it before anyone else sees it.")}</small>
          <select value={chosen?.id ?? ""} onChange={e => setF({ ...f, hazard: e.target.value })} aria-label="Hazard">{free.map(h => <option key={h.id} value={h.id}>{h.title} · {h.km} km</option>)}</select>
          <textarea rows={3} maxLength={1200} placeholder={t("Escape routes, e.g. leave by Main Street, avoid the river road")} value={f.routes} onChange={e => setF({ ...f, routes: e.target.value })} />
          <input maxLength={300} placeholder={t("Assembly point, e.g. Community Hall car park")} value={f.assembly} onChange={e => setF({ ...f, assembly: e.target.value })} />
          <input maxLength={400} placeholder={t("Emergency contacts (optional)")} value={f.contacts} onChange={e => setF({ ...f, contacts: e.target.value })} />
          <textarea rows={2} maxLength={800} placeholder={t("Before you leave: water, torch, documents, who to check on (optional)")} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
          <button className="go" onClick={() => act(async () => {
            if (!chosen) throw new Error("Choose a hazard");
            await S.safetyPlan({ hazard: { id: chosen.id, title: chosen.title, type: chosen.type, km: chosen.km }, routes: f.routes, assembly: f.assembly, contacts: f.contacts, notes: f.notes });
            setF({ hazard: "", routes: "", assembly: "", contacts: "", notes: "" });
          }, "Plan sent. A different coordinator must approve it")}>{t("Send for approval")}</button>
        </div>
      )}
      {!admin && <small className="dim">{t("Only coordinators can write a safety plan.")}</small>}
      {admin && closed.length > 0 && (
        <details>
          <summary>{t("Closed plans")} ({closed.length})</summary>
          {closed.map(p => <p key={p.id} className="dim">{p.hazardTitle}: {p.closedNote ?? "Closed"}</p>)}
        </details>
      )}
    </>
  );
}

/** A pop-up for everyone (residents and coordinators): a hazard within 100 km, or a newly approved safety plan. Each one shows once per device. */
export function HazardPopup({ app, st, goWorld, goPlan }: { app: S.AppState; st: S.State; goWorld: () => void; goPlan: () => void }) {
  const t = useT();
  const key = `nos-popup-${app.nbhd?.id ?? "x"}`;
  const [seen, setSeen] = useState<string[]>(() => { try { return JSON.parse(app.mode === "demo" ? "[]" : localStorage.getItem(key) || "[]"); } catch { return []; } });
  const near = nearbyHazards(app);
  const plans = (st.safety ?? []).filter(p => p.status === "approved");
  const items = [
    ...near.map(h => ({ id: `h:${h.id}`, h, p: null as S.SafetyPlan | null })),
    ...plans.map(p => ({ id: `p:${p.id}`, h: null as S.Alert | null, p })),
  ].filter(x => !seen.includes(x.id));
  const cur = items[0];
  const done = () => {
    if (!cur) return;
    const next = [...seen, cur.id].slice(-80);
    setSeen(next);
    if (app.mode !== "demo") { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ } }
  };
  // In the demo, a hazard that goes away can pop up again the next time it is simulated.
  useEffect(() => {
    if (app.mode !== "demo") return;
    const live = new Set(near.map(h => `h:${h.id}`));
    setSeen(o => (o.some(x => x.startsWith("h:") && !live.has(x)) ? o.filter(x => !x.startsWith("h:") || live.has(x)) : o));
  }, [app.mode, near.map(h => h.id).join(",")]);
  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!cur) return null;
  const admin = st.role === "admin";
  return (
    <div role="presentation" onClick={done} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(0,0,0,.55)", padding: 16 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="popup-title" className="card alertcard official" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: "100%", maxHeight: "86vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        {cur.h ? (
          <>
            <b id="popup-title">{t("Hazard near your neighbourhood")}: {cur.h.title}</b>
            <p>About {cur.h.km} km from {app.nbhd?.name}. <small className="dim">{cur.h.sev} · {cur.h.src === "CAP" ? "Official alert" : cur.h.src} · {ago(cur.h.time)}</small></p>
            {cur.h.instruction && <p className="pre">{cur.h.instruction}</p>}
            <p>{t("Follow your national authorities. If anyone is in danger, call your local emergency number first.")}{admin ? ` ${t("As a coordinator you can write a safety plan for the neighbourhood.")}` : ""}</p>
            <div className="row wrap">
              <button className="go" onClick={() => { done(); goWorld(); }}>{admin ? t("Open the World tab") : t("See on the world map")}</button>
              <button onClick={done}>{t("Dismiss")}</button>
            </div>
          </>
        ) : (
          <>
            <b id="popup-title">{t("Safety plan from your coordinators")}: {cur.p!.hazardTitle}</b>
            <Row label="Escape routes" text={cur.p!.routes} />
            <Row label="Assembly point" text={cur.p!.assembly} />
            <div className="row wrap">
              <button className="go" onClick={() => { done(); goPlan(); }}>{t("Read the full plan")}</button>
              <button onClick={done}>{t("Dismiss")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}