import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, Construction, Cross, Crosshair, Droplets, Flag, Flame, Hammer, HeartHandshake, History, Home, Layers, Lightbulb, Minus, Plus, Search, Siren, Trash2, User, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as S from "./store";
import { fromXY, toXY } from "./geo";
import type { MapData } from "./mapdata";

const K = 0.8, KF = 1.1, KZ = 1.4;
function makeProj(R: number, flat: boolean) {
  if (flat) {
    const OX = R * KF + 140, OY = R * KF + 200;
    return { flat, OX, OY, k: KF, P: (x: number, y: number, _z = 0) => ({ x: OX + x * KF, y: OY + y * KF }), inv: (wx: number, wy: number) => ({ x: (wx - OX) / KF, y: (wy - OY) / KF }) };
  }
  const OX = 2 * R * K + 120, OY = R * K + 300;
  return {
    flat, OX, OY, k: K, P: (x: number, y: number, z = 0) => ({ x: OX + (x - y) * K, y: OY + ((x + y) * K) / 2 - z }),
    inv: (wx: number, wy: number) => { const u = (wx - OX) / K, w = ((wy - OY) * 2) / K; return { x: (u + w) / 2, y: (w - u) / 2 }; },
  };
}
type Proj = ReturnType<typeof makeProj>;
type Pt2 = { x: number; y: number };

const cl = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const grp = (s: S.Status) => (s === "resolved" ? "green" : s === "assigned" || s === "progress" || s === "pending" ? "amber" : "red");
const COL = { red: "#ff3b4e", amber: "#ff9a2e", green: "#2dff9a", cyan: "#3de8ff", blue: "#3b82ff", dim: "#8fb4ff" };
const NEONS = ["#ff9a2e", "#3de8ff", "#ff5ad1", "#2dff9a"];
const trunc = (t: string) => (t.length > 22 ? t.slice(0, 21) + "…" : t);
const CI: Record<S.Cat, LucideIcon> = { pothole: Construction, garbage: Trash2, streetlight: Lightbulb, water: Droplets, unsafe: AlertTriangle, blocked: Ban, other: Wrench };
const RI: Record<S.Kind, LucideIcon> = { shelter: Home, water: Droplets, aid: Cross, donation: HeartHandshake, assembly: Flag, equipment: Hammer };
const isCalm = () => typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("rm"));
const rev = (p: number[]) => { const o: number[] = []; for (let k = p.length - 2; k >= 0; k -= 2) o.push(p[k], p[k + 1]); return o; };
const pts = (a: Pt2[]) => a.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

function Bld({ b, proj, i }: { b: MapData["blds"][number]; proj: Proj; i: number }) {
  const { P } = proj, n = b.p.length / 2, ring: Pt2[] = [];
  for (let k = 0; k < n; k++) ring.push(P(b.p[2 * k], b.p[2 * k + 1]));
  if (proj.flat) return <polygon points={pts(ring)} fill={["#16264a", "#1b2f5c", "#13213f"][i % 3]} stroke="#2c4a86" strokeWidth=".8" />;
  const z = b.h * KZ, up = (q: Pt2) => ({ x: q.x, y: q.y - z });
  const edges = ring.map((a, k) => ({ a, c: ring[(k + 1) % n] })).sort((e, f) => e.a.y + e.c.y - (f.a.y + f.c.y));
  const neon = z > 55 && i % 6 === 0 ? NEONS[i % 4] : undefined, lit = neon ?? "#ffd27a";
  let win = "";
  edges.slice(-2).forEach(e => {
    if (Math.hypot(e.c.x - e.a.x, e.c.y - e.a.y) < 10) return;
    for (let hz = 11, r = 0; hz < z - 6 && r < 8; hz += 13, r++) win += `M${e.a.x.toFixed(1)},${(e.a.y - hz).toFixed(1)}L${e.c.x.toFixed(1)},${(e.c.y - hz).toFixed(1)}`;
  });
  return (
    <g>
      {edges.map((e, k) => <polygon key={k} points={pts([e.a, e.c, up(e.c), up(e.a)])} fill={(e.c.x - e.a.x) * (e.c.y - e.a.y) > 0 ? "#122246" : "#0b1430"} stroke="#0a1226" strokeWidth=".6" />)}
      {win && <path d={win} stroke={lit} strokeWidth="3.5" strokeDasharray="4 7" opacity=".5" fill="none" />}
      <polygon points={pts(ring.map(up))} fill={["#1a2d57", "#203665", "#172a50"][i % 3]} stroke={neon ?? "#2c4a86"} strokeWidth={neon ? 2 : 1} />
    </g>
  );
}

const CityLayer = memo(function CityLayer({ map, proj }: { map: MapData; proj: Proj }) {
  const { P } = proj, R = map.r, c0 = P(0, 0), k = proj.k;
  const pl = (p: number[]) => { let d = ""; for (let q = 0; q < p.length; q += 2) { const a = P(p[q], p[q + 1]); d += `${q ? "L" : "M"}${a.x.toFixed(1)},${a.y.toFixed(1)}`; } return d; };
  const byC = [0, 1, 2, 3].map(c => map.roads.filter(r => r.c === c).map(r => pl(r.p)).join(""));
  const WID = proj.flat ? [26, 20, 14] : [30, 24, 17];
  const len = (p: number[]) => { let s = 0; for (let q = 2; q < p.length; q += 2) s += Math.hypot(p[q] - p[q - 2], p[q + 1] - p[q - 1]); return s; };
  const long = map.roads.filter(r => r.c <= 2 && r.p.length >= 4).map(r => ({ r, l: len(r.p) })).sort((a, b) => b.l - a.l);
  const cars = isCalm() ? [] : long.slice(0, 10);
  const labels = long.filter(x => x.r.n).slice(0, 6);
  const blds = [...map.blds].sort((a, b) => a.p.reduce((s, v) => s + v, 0) / a.p.length - b.p.reduce((s, v) => s + v, 0) / b.p.length);
  return (
    <g>
      {proj.flat ? (
        <>
          <circle cx={c0.x} cy={c0.y} r={R * k * 1.04} fill="#060b18" stroke="#16315e" strokeWidth="2" />
          <circle cx={c0.x} cy={c0.y} r={R * k} fill="none" stroke="#3de8ff" strokeWidth="2" strokeDasharray="14 10" opacity=".35" />
        </>
      ) : (
        <>
          <ellipse cx={c0.x} cy={c0.y} rx={R * k * 1.5} ry={R * k * 0.75} fill="#060b18" stroke="#16315e" strokeWidth="2" />
          <ellipse cx={c0.x} cy={c0.y} rx={R * k * 1.414} ry={R * k * 0.707} fill="none" stroke="#3de8ff" strokeWidth="2" strokeDasharray="14 10" opacity=".35" />
        </>
      )}
      {map.areas.map((a, i) => <path key={i} d={pl(a.p) + "Z"} fill={a.k === "park" ? "#0e3d2c" : "#0b3a66"} fillOpacity=".8" stroke={a.k === "park" ? "#2dff9a" : "#3b82ff"} strokeOpacity=".35" />)}
      <path d={byC[0] + byC[1] + byC[2]} fill="none" stroke="#ff7a1a" strokeWidth="46" strokeLinecap="round" opacity=".5" filter="url(#blur6)" />
      {[2, 1, 0].map(c => <path key={"e" + c} d={byC[c]} fill="none" stroke="#ff8a2a" strokeWidth={WID[c] + 7} strokeLinecap="round" strokeLinejoin="round" />)}
      {[2, 1, 0].map(c => <path key={"a" + c} d={byC[c]} fill="none" stroke="#0a1020" strokeWidth={WID[c]} strokeLinecap="round" strokeLinejoin="round" />)}
      <path d={byC[0] + byC[1]} fill="none" stroke="#ffcf9a" strokeOpacity=".28" strokeWidth="1.6" strokeDasharray="10 12" />
      <path d={byC[3]} fill="none" stroke="#ff8a2a" strokeWidth="2.5" strokeDasharray="2 5" opacity=".6" />
      {labels.map(({ r }, i) => {
        const m = Math.floor(r.p.length / 4) * 2, a = P(r.p[Math.max(0, m - 2)], r.p[Math.max(1, m - 1)]), b = P(r.p[Math.min(r.p.length - 2, m + 2)], r.p[Math.min(r.p.length - 1, m + 3)]), q = P(r.p[m], r.p[m + 1]);
        let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
        return <text key={i} transform={`translate(${q.x},${q.y}) rotate(${deg})`} textAnchor="middle" dy="4" fontSize="11" letterSpacing="3" fill="#ffcf9a" opacity=".75">{(r.n ?? "").toUpperCase()}</text>;
      })}
      {cars.map(({ r, l }, i) => (
        <g key={i}>
          <circle r="10" fill={["#ffd23f", "#3b82ff", "#ffffff"][i % 3]} opacity=".4" filter="url(#blur3)" />
          <rect x="-7" y="-4" width="14" height="8" rx="3" fill={["#ffd23f", "#3b82ff", "#ffffff"][i % 3]} />
          <animateMotion dur={`${Math.max(14, l / 16)}s`} begin={`-${i * 3}s`} repeatCount="indefinite" rotate="auto" path={pl(i % 2 ? r.p : rev(r.p))} />
        </g>
      ))}
      {blds.map((b, i) => <Bld key={i} b={b} proj={proj} i={i} />)}
    </g>
  );
});

interface Item { id: string; kind: "issue" | "res" | "sos" | "vol"; ax: number; ay: number; col: string; Icon: LucideIcon; label: string; n?: number; pulse: boolean; prog?: number; mission?: string; dashed?: boolean }
function layout(its: Item[], lift: number) {
  const pos = its.map(i => ({ x: i.ax, y: i.ay - lift }));
  for (let it = 0; it < 70; it++) {
    for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) {
      let dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      if (Math.abs(dx) + Math.abs(dy) < 1) { dx = b - a; dy = 0.5; }
      const d = Math.hypot(dx * 0.6, dy), min = 86;
      if (d < min) { const f = (min - d) / 2 / d; pos[a].x -= dx * f; pos[a].y -= dy * f; pos[b].x += dx * f; pos[b].y += dy * f; }
    }
    pos.forEach((p, n) => { p.x += (its[n].ax - p.x) * 0.02; p.y += (its[n].ay - lift - p.y) * 0.02; });
  }
  return pos;
}

export type MapView = "iso" | "flat" | "list";
interface Props {
  st: S.State; name: string; center: { lat: number; lng: number }; map: MapData | null; note: string; sos: S.Sos[]; official: boolean;
  sel: string | null; onSel: (id: string) => void; pick: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void; filter: S.Status[]; setFilter: (f: S.Status[]) => void;
  res: boolean; setRes: (b: boolean) => void; picking: boolean; zones: { cat: S.Cat; lat: number; lng: number; count: number }[];
  view: MapView; setView: (v: MapView) => void; heat: boolean; setHeat: (b: boolean) => void; showVol: boolean; setShowVol: (b: boolean) => void;
  canSeeVol: boolean; sim: Record<string, number | null> | null; timeOn: boolean; onTime: () => void;
}
const GROUPS: [string, S.Status[]][] = [["Open", ["reported", "review"]], ["In progress", ["assigned", "progress", "pending"]], ["Fixed", ["resolved"]]];

export default function IsoMap({ st, name, center, map, note, sos, official, sel, onSel, pick, onPick, filter, setFilter, res, setRes, picking, zones, view, setView, heat, setHeat, showVol, setShowVol, canSeeVol, sim, timeOn, onTime }: Props) {
  const flat = view === "flat", lift = flat ? 72 : 120;
  const box = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), inited = useRef("");
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 650 });
  const [v, setV] = useState({ x: 0, y: 0, k: 0.85 });
  const [hov, setHov] = useState<string | null>(null);
  const [cur, setCur] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState("");
  const R = map?.r ?? 650;
  const proj = useMemo(() => makeProj(R, flat), [R, flat]);
  const { P } = proj;

  const A = (lat: number, lng: number) => {
    let { x, y } = toXY(center, lat, lng);
    const d = Math.hypot(x, y), lim = R * 0.96;
    if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; }
    return P(x, y);
  };

  const { items, pos } = useMemo(() => {
    const its: Item[] = [];
    st.issues.filter(i => filter.includes(i.status)).forEach(i => {
      const a = A(i.lat, i.lng), k = grp(i.status), w = i.agent ? S.workflow(st, i) : null, m = st.missions.find(x => x.id === i.missionId);
      const day = sim && i.status !== "resolved" ? sim[i.id] : undefined;
      const col = sim && i.status !== "resolved" ? (day != null && day <= 7 ? COL.green : day != null && day <= 14 ? COL.amber : COL.red) : COL[k];
      its.push({ id: i.id, kind: "issue", ax: a.x, ay: a.y, col, Icon: CI[i.cat], label: sim && i.status !== "resolved" ? (day != null ? `Day ${day} (simulated)` : "Backlog (simulated)") : trunc(i.title), n: i.reports, pulse: !sim && k !== "green", prog: sim ? undefined : w ? w.done / w.total : undefined, mission: m ? `${m.joined.length}/${m.need}` : undefined, dashed: !!sim && i.status !== "resolved" });
    });
    sos.forEach(x => {
      if (x.lat == null || x.lng == null) return;
      const a = A(x.lat, x.lng);
      its.push({ id: x.id, kind: "sos", ax: a.x, ay: a.y, col: COL.red, Icon: Siren, label: "SOS request", pulse: x.status !== "closed" && x.status !== "helped" });
    });
    if (res) st.resources.forEach(r => {
      const a = A(r.lat, r.lng);
      its.push({ id: r.id, kind: "res", ax: a.x, ay: a.y, col: r.low ? COL.amber : COL.cyan, Icon: RI[r.kind], label: trunc(r.name), pulse: !!r.low });
    });
    if (showVol && canSeeVol) st.volunteers.forEach(vo => {
      if (vo.lat == null || vo.lng == null) return;
      const a = A(vo.lat, vo.lng);
      its.push({ id: "v:" + vo.id, kind: "vol", ax: a.x, ay: a.y, col: vo.available ? COL.dim : "#5d6b8c", Icon: User, label: trunc(vo.name), pulse: false });
    });
    return { items: its, pos: layout(its, lift) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.issues, st.resources, st.missions, st.volunteers, sos, filter, res, showVol, canSeeVol, sim, center.lat, center.lng, R, flat]);

  const centerOn = (wx: number, wy: number, k: number) => setV({ k, x: size.w / 2 - wx * k, y: size.h / 2 - wy * k });
  const home = () => {
    const n = items.length, c0 = P(0, 0);
    const cx = n ? items.reduce((a, i) => a + i.ax, 0) / n : c0.x, cy = n ? items.reduce((a, i) => a + i.ay, 0) / n : c0.y;
    centerOn(cx, cy - lift / 2, size.w < 600 ? 0.65 : 0.85);
  };
  const zoomAt = (cx: number, cy: number, f: number) => setV(o => { const k = cl(o.k * f, 0.3, 2.4), r = k / o.k; return { k, x: cx - (cx - o.x) * r, y: cy - (cy - o.y) * r }; });

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = `${center.lat},${center.lng},${R},${flat}`;
    if (map && inited.current !== key && size.w > 0) { inited.current = key; home(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, size.w, flat]);
  useEffect(() => {
    const s = svg.current!;
    const h = (e: WheelEvent) => { e.preventDefault(); const r = s.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89); };
    s.addEventListener("wheel", h, { passive: false });
    return () => s.removeEventListener("wheel", h);
  }, []);

  const rel = (e: { clientX: number; clientY: number }) => { const r = svg.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const llAt = (cx: number, cy: number) => {
    let { x, y } = proj.inv((cx - v.x) / v.k, (cy - v.y) / v.k);
    const d = Math.hypot(x, y), lim = R * 0.96;
    if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; }
    return fromXY(center, x, y);
  };
  const info = cur ?? llAt(size.w / 2, size.h / 2);

  const resIts = items.filter(i => i.kind === "res");
  const near = (it: Item) => resIts.reduce<Item | null>((b, r) => (!b || Math.hypot(r.ax - it.ax, r.ay - it.ay) < Math.hypot(b.ax - it.ax, b.ay - it.ay) ? r : b), null);
  const routes = sim ? [] : st.issues.filter(i => (i.missionId || i.id === sel) && i.status !== "resolved").map(i => {
    const it = items.find(x => x.id === i.id), r = it && near(it);
    return it && r ? { id: i.id, it, r, col: i.id === sel ? COL.cyan : COL.blue } : null;
  }).filter(Boolean) as { id: string; it: Item; r: Item; col: string }[];
  const links = !sim && showVol && canSeeVol ? st.missions.flatMap(m => {
    const it = items.find(x => x.id === m.issueId);
    return it && !m.done ? m.joined.flatMap(n => { const vo = st.volunteers.find(x => x.name === n), vi = vo && items.find(x => x.id === "v:" + vo.id); return vi ? [{ k: m.id + n, a: vi, b: it }] : []; }) : [];
  }) : [];
  const open = st.issues.filter(i => i.status !== "resolved" && !i.hidden);

  const pin = (it: Item, p: Pt2) => {
    const on = sel === it.id, small = it.kind === "vol", show = on || hov === it.id || v.k > 1.5, w = it.label.length * 7 + 22, sc = (on ? 1.14 : 1) * (small ? 0.78 : 1);
    return (
      <g key={it.id} transform={`translate(${p.x},${p.y}) scale(${sc})`} style={{ cursor: small ? "default" : "pointer" }} tabIndex={small ? -1 : 0} role={small ? undefined : "button"} aria-label={small ? undefined : `${it.kind === "sos" ? "SOS request" : it.kind === "res" ? "Resource" : "Issue"}: ${it.label}`}
        onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && it.kind !== "res" && !small) { e.preventDefault(); onSel(it.id); } }}
        onPointerDown={e => e.stopPropagation()} onClick={() => it.kind !== "res" && !small && onSel(it.id)}
        onPointerEnter={() => setHov(it.id)} onPointerLeave={() => setHov(null)}>
        {it.pulse && <circle r="30" fill={it.col} className="ring" />}
        {it.prog != null && <circle r="30" fill="none" stroke={it.col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${it.prog * 188.5} 188.5`} transform="rotate(-90)" opacity=".95" />}
        <rect x="-24" y="-24" width="48" height="48" rx={it.kind === "res" || small ? 24 : 14} fill="#091226" stroke={on ? "#fff" : it.col} strokeWidth="2.5" strokeDasharray={it.dashed ? "6 4" : undefined} style={{ filter: `drop-shadow(0 0 9px ${it.col})` }} />
        <it.Icon x={-13} y={-13} size={26} color={it.col} strokeWidth={2.2} />
        {(it.n ?? 0) > 1 && <g transform="translate(21,-21)"><circle r="10" fill={it.col} /><text textAnchor="middle" y="4" fontSize="11" fontWeight="700" fill="#04060c">{it.n}</text></g>}
        {it.mission && <g transform="translate(-22,22)"><rect x="-17" y="-10" width="34" height="20" rx="10" fill="#091226" stroke={COL.cyan} /><text textAnchor="middle" y="4" fontSize="10" fill={COL.cyan}>👥{it.mission}</text></g>}
        {(show || it.dashed) && <g transform="translate(0,43)"><rect x={-w / 2} y="-12" width={w} height="24" rx="12" fill="#0a1226" stroke={it.col} strokeOpacity=".7" /><text textAnchor="middle" y="4" fontSize="12" fill="#e8f0ff">{it.label}</text></g>}
      </g>
    );
  };

  const order = items.map((it, n) => ({ it, p: pos[n] })).sort((a, b) => Number(a.it.id === sel) - Number(b.it.id === sel) || a.p.y - b.p.y);
  const pk = pick && (() => { const a = A(pick.lat, pick.lng); return { a, p: { x: a.x, y: a.y - lift } }; })();
  const count = (g: S.Status[]) => st.issues.filter(i => g.includes(i.status)).length;
  const hy = flat ? 120 * KF : 150 * K * 1.4, hyy = flat ? 120 * KF : 150 * K * 0.7;

  return (
    <div className="iso" ref={box}>
      <svg ref={svg} role="img" aria-label="Interactive neighborhood map. The same items are listed in the panel on the right." className={`isosvg ${picking ? "picking" : ""}`}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          const d = drag.current;
          if (d) { const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.hypot(dx, dy) > 4) d.moved = true; if (d.moved) setV(o => ({ ...o, x: d.vx + dx, y: d.vy + dy })); }
          else { const r = rel(e); setCur(llAt(r.x, r.y)); }
        }}
        onPointerUp={e => {
          const d = drag.current; drag.current = null;
          if (d && !d.moved && picking) { const r = rel(e), ll = llAt(r.x, r.y); onPick(ll.lat, ll.lng); }
        }}
        onPointerLeave={() => setCur(null)}>
        <defs>
          <filter id="blur6" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7" /></filter>
          <filter id="blur3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
          <filter id="blur18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22" /></filter>
        </defs>
        <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
          {map && <CityLayer map={map} proj={proj} />}
          {heat && (
            <g filter="url(#blur18)" style={{ mixBlendMode: "screen" }}>
              {open.map(i => { const a = A(i.lat, i.lng), w = S.priorityScore(st, i).score / 100; return <g key={"h" + i.id}><ellipse cx={a.x} cy={a.y} rx={hy * 1.5} ry={hyy * 1.5} fill="#ff9a2e" fillOpacity={0.1 + 0.22 * w} /><ellipse cx={a.x} cy={a.y} rx={hy} ry={hyy} fill="#ff3b4e" fillOpacity={0.18 + 0.4 * w} /></g>; })}
            </g>
          )}
          {zones.map((z, n) => { const a = A(z.lat, z.lng); return <g key={n} className="crisis-z"><ellipse cx={a.x} cy={a.y} rx={flat ? 250 * KF : 283} ry={flat ? 250 * KF : 141} fill="#ff3b4e" fillOpacity=".12" stroke="#ff3b4e" strokeWidth="2" strokeDasharray="10 8" /><text x={a.x} y={a.y + (flat ? 250 * KF + 20 : 165)} textAnchor="middle" fontSize="13" letterSpacing="3" fill="#ff7683">CRISIS ZONE · {z.count} REPORTS</text></g>; })}
          {routes.map(r => <path key={r.id} className="flow" d={`M${r.r.ax},${r.r.ay} Q${(r.r.ax + r.it.ax) / 2},${Math.min(r.r.ay, r.it.ay) - 100} ${r.it.ax},${r.it.ay}`} fill="none" stroke={r.col} strokeWidth="3" strokeDasharray="10 8" style={{ filter: `drop-shadow(0 0 6px ${r.col})` }} />)}
          {links.map(l => <path key={l.k} className="flow fast" d={`M${l.a.ax},${l.a.ay} Q${(l.a.ax + l.b.ax) / 2},${Math.min(l.a.ay, l.b.ay) - 70} ${l.b.ax},${l.b.ay}`} fill="none" stroke={COL.cyan} strokeWidth="2.5" strokeDasharray="4 7" style={{ filter: `drop-shadow(0 0 6px ${COL.cyan})` }} />)}
          {order.map(({ it, p }) => <g key={"l" + it.id}><ellipse cx={it.ax} cy={it.ay} rx="24" ry="12" fill={it.col} fillOpacity=".18" stroke={it.col} strokeWidth="2" /><line x1={p.x} y1={p.y + 26} x2={it.ax} y2={it.ay} stroke={it.col} strokeWidth="2" strokeOpacity=".8" /></g>)}
          {order.map(({ it, p }) => pin(it, p))}
          {pk && <g><ellipse cx={pk.a.x} cy={pk.a.y} rx="24" ry="12" fill={COL.blue} fillOpacity=".25" stroke={COL.blue} strokeWidth="2" /><line x1={pk.p.x} y1={pk.p.y + 26} x2={pk.a.x} y2={pk.a.y} stroke={COL.blue} strokeWidth="2" /><g transform={`translate(${pk.p.x},${pk.p.y})`}><circle r="30" fill={COL.blue} className="ring" /><rect x="-24" y="-24" width="48" height="48" rx="14" fill="#091226" stroke={COL.blue} strokeWidth="2.5" /><Plus x={-13} y={-13} size={26} color={COL.blue} /><g transform="translate(0,43)"><rect x="-70" y="-12" width="140" height="24" rx="12" fill="#0a1226" stroke={COL.blue} /><text textAnchor="middle" y="4" fontSize="12" fill="#e8f0ff">Chosen location</text></g></g></g>}
        </g>
      </svg>

      {!map && <div className="maploading">Loading neighborhood map…</div>}
      {note && <div className="mapnote glass">{note}</div>}
      {sim && <div className="simbanner glass">SIMULATION: estimates from simple assumptions, not real outcomes</div>}

      <div className="hud hud-top glass">
        <b className="hname">{name.toUpperCase()}</b>
        <span className="mono">{info.lat.toFixed(4)}, {info.lng.toFixed(4)}</span>
        <Search size={16} />
        <input className="hsearch" placeholder="Find an issue or resource" aria-label="Find an issue or resource" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key !== "Enter") return;
            const t = q.trim().toLowerCase(), h = st.issues.find(i => i.title.toLowerCase().includes(t)), rs = st.resources.find(r => r.name.toLowerCase().includes(t));
            const tgt = h ?? rs; if (!tgt) return;
            const a = A(tgt.lat, tgt.lng); centerOn(a.x, a.y - 60, 1.1); if (h) onSel(h.id);
          }} />
      </div>
      <div className="hud hud-view glass" role="group" aria-label="Map view">
        {(["iso", "flat", "list"] as MapView[]).map(m => <button key={m} className={`tabb ${view === m ? "on" : ""}`} onClick={() => setView(m)}>{m === "iso" ? "Isometric" : m === "flat" ? "Flat" : "List"}</button>)}
      </div>

      <div className="hud hud-right">
        {(zones.length > 0 || official) && <button className="active-pill" onClick={() => { if (zones.length) { const a = A(zones[0].lat, zones[0].lng); centerOn(a.x, a.y - 40, 1); } }}><AlertTriangle size={18} /> {official ? "OFFICIAL ALERT" : "CRISIS ACTIVE"}</button>}
        <button className="rbtn glass" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)}><Plus size={18} /></button>
        <button className="rbtn glass" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)}><Minus size={18} /></button>
        <button className={`rbtn glass ${res ? "on" : ""}`} aria-label="Toggle resources" title="Resources" onClick={() => setRes(!res)}><Layers size={18} /></button>
        <button className={`rbtn glass ${heat ? "on" : ""}`} aria-label="Toggle heatmap" title="Issue heatmap" onClick={() => setHeat(!heat)}><Flame size={18} /></button>
        {canSeeVol && <button className={`rbtn glass ${showVol ? "on" : ""}`} aria-label="Toggle volunteers" title="Volunteers and connections" onClick={() => setShowVol(!showVol)}><Users size={18} /></button>}
        <button className={`rbtn glass ${timeOn ? "on" : ""}`} aria-label="Then and now" title="Then vs now" onClick={onTime}><History size={18} /></button>
        <button className="rbtn glass" aria-label="Recenter" onClick={home}><Crosshair size={18} /></button>
      </div>

      <div className="hud hud-bottom glass">
        {GROUPS.map(([label, g]) => {
          const on = g.every(s => filter.includes(s));
          return <button key={label} className={`tabb ${on ? "on" : ""}`} onClick={() => setFilter(on ? filter.filter(s => !g.includes(s)) : [...new Set([...filter, ...g])])}>{label}<sup>{count(g)}</sup></button>;
        })}
        <button className={`tabb ${res ? "on" : ""}`} onClick={() => setRes(!res)}>Resources<sup>{st.resources.length}</sup></button>
      </div>

      <div className="hud scale"><span>120 m</span><i style={{ width: 120 * (flat ? KF : K * 1.118) * v.k }} /></div>
    </div>
  );
}
