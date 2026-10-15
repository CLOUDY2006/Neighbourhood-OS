import { memo, useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import land from "./land.json";
import * as S from "./store";
import { useT } from "./i18n";

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

export function WorldPanel({ app, sel, onSel }: { app: S.AppState; sel: string | null; onSel: (id: string | null) => void }) {
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
    </>
  );
}

export function AlertBanner({ alerts, onWorld }: { alerts: S.Alert[]; onWorld: () => void }) {
  const t = useT();
  if (!alerts.length) return null;
  const official = S.isOfficial(alerts);
  return (
    <div className={`card alertcard ${official ? "official" : ""}`}>
      <b>{official ? t("Official alert near this neighborhood") : t("Heads up: hazard activity nearby")}</b>
      {alerts.slice(0, 3).map(a => (
        <div key={a.id}>
          <p>{a.title}{a.km ? `: about ${a.km} km away` : a.area ? `: ${a.area}` : ""}. <small className="dim">{a.src === "CAP" ? "Official alert" : a.src} · {ago(a.time)}</small></p>
          {a.instruction && <p className="pre">{a.instruction}</p>}
        </div>
      ))}
      {official && <p>{t("Follow your national authorities. If anyone is in danger, call your local emergency number first. Crisis Mode is on: use the SOS tab if you need help and the Resources tab to find shelters.")}</p>}
      <button onClick={onWorld}>{t("See on the world map")}</button>
    </div>
  );
}
