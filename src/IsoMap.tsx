import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, Box, Construction, Cross, Crosshair, Droplets, Flag, Flame, Hammer, HeartHandshake, History, Home, Info, Layers, Lightbulb, List, Map as MapIcon, MapPin, Minus, Navigation2, Plus, Rotate3d, RotateCcw, RotateCw, Search, Siren, Trash2, User, Users, Wrench, X, LocateFixed } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as S from "./store";
import { cellOf, fromXY, toXY } from "./geo";
import { fmtDist, hereInfo, useHere } from "./here";
import { useT } from "./i18n";
import type { MapData } from "./mapdata";
import { nearestPlace } from "./places";
import { buildModel, drawCars, drawGround, drawObjects, K, KF, KZ, makeProj, TILT0, TILT_MAX, TILT_MIN, type Cam } from "./city3d";
import { useA11y, useTheme } from "./a11y";
import { palette } from "./theme";

type Pt2 = { x: number; y: number };

const cl = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const grp = (s: S.Status) => (s === "resolved" ? "green" : s === "assigned" || s === "progress" || s === "pending" ? "amber" : "red");
const SOS_LABEL: Record<S.SosNeed, string> = { medical: "Medical", rescue: "Rescue", shelter: "Shelter", food_water: "Food or water", other: "Help" };
const trunc = (t: string) => (t.length > 22 ? t.slice(0, 21) + "…" : t);
const CI: Record<S.Cat, LucideIcon> = { pothole: Construction, garbage: Trash2, streetlight: Lightbulb, water: Droplets, unsafe: AlertTriangle, blocked: Ban, other: Wrench };
const prefersCalm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TILTS = [TILT0, 0.68, 0.36];
const TILT_NAME = (t: number) => (t > 0.6 ? "high, looking down" : t < 0.42 ? "low, street level" : "standard");

interface Item { id: string; kind: "issue" | "sos"; ax: number; ay: number; col: string; Icon: LucideIcon; label: string; n?: number; pulse: boolean; prog?: number }
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
const VIEWS: [MapView, string, LucideIcon][] = [["iso", "3D", Box], ["flat", "Flat", MapIcon], ["list", "List", List]];
export function ViewSwitch({ view, setView }: { view: MapView; setView: (v: MapView) => void }) {
  return (
    <div className="hud hud-view glass seg" role="group" aria-label="Map view">
      {VIEWS.map(([m, l, Ic]) => <button key={m} className={`tabb ${view === m ? "on" : ""}`} aria-pressed={view === m} onClick={() => setView(m)}><Ic size={14} /> {l}</button>)}
    </div>
  );
}

interface Props {
  st: S.State; name: string; center: { lat: number; lng: number }; map: MapData | null; note: string;
  sos: S.Sos[]; alertText?: string | null; onAlert?: () => void;
  sel: string | null; onSel: (id: string) => void; pick: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void; filter: S.Status[]; setFilter: (f: S.Status[]) => void;
  picking: boolean;
  view: MapView; setView: (v: MapView) => void; heat: boolean; setHeat: (b: boolean) => void;
  timeOn: boolean; onTime: () => void;
}
const GROUPS: [string, S.Status[], string][] = [["Open", ["reported", "review"], "red"], ["In progress", ["assigned", "progress", "pending"], "amber"], ["Fixed", ["resolved"], "green"]];

export default function IsoMap({ st, name, center, map, note, sos, alertText, onAlert, sel, onSel, pick, onPick, filter, setFilter, picking, view, setView, heat, setHeat, timeOn, onTime }: Props) {
  const theme = useTheme(), pal = palette(theme), a11y = useA11y(), calm = a11y.motion || prefersCalm();
  const flat = view === "flat";
  const box = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), cvs = useRef<HTMLCanvasElement>(null), inited = useRef("");
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; orbit?: { cam: Cam; pv: Pt2 } } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 650 });
  const [v, setV] = useState({ x: 0, y: 0, k: 0.85 });
  const [cam, setCam] = useState<Cam>({ rot: 0, tilt: TILT0 });
  const [hov, setHov] = useState<string | null>(null);
  const [cur, setCur] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState("");
  const [legend, setLegend] = useState(false);
  const R = map?.r ?? 650;
  const tr = useT(), app = S.useApp(), { here, start, stop } = useHere();
  const [opening, setOpening] = useState(false), [openErr, setOpenErr] = useState("");
  const hi = here.status === "on" && here.lat != null && here.lng != null ? hereInfo(here.lat, here.lng, center, R) : null;
  const openMine = async () => {
    if (here.lat == null || here.lng == null) return;
    setOpening(true); setOpenErr("");
    try { await S.joinCell(cellOf(here.lat, here.lng).id); } catch (e) { setOpenErr((e as Error).message); }
    setOpening(false);
  };
  const proj = useMemo(() => makeProj(R, flat, cam), [R, flat, cam]);
  const { P } = proj, t = proj.t, lift = flat ? 72 : 120 * (proj.zf / KZ);
  const model = useMemo(() => (map ? buildModel(map) : null), [map]);
  // The society (or area name) nearest to the middle of what you are looking at. Helps you place yourself without sharing location.
  const nearPlace = useMemo(() => {
    if (!map?.places?.length || size.w < 2) return null;
    const c = proj.inv((size.w / 2 - v.x) / v.k, (size.h / 2 - v.y) / v.k);
    return nearestPlace(map.places, c.x, c.y);
  }, [map, proj, v, size]);

  // canvas city: two cached layers (ground, objects) drawn with some margin around the view. Panning only shifts the
  // cached images; zoom, camera, theme or data changes redraw them. Cars animate between the two layers.
  const live = useRef({ model, proj, v, size, city: pal.city, calm, full: true, moved: 0 });
  live.current = { ...live.current, model, proj, v, size, city: pal.city, calm };
  useEffect(() => { live.current.full = true; }, [model, proj, size, pal]);
  useEffect(() => { live.current.moved = performance.now(); }, [v]);
  useEffect(() => {
    const OV = 200, ground = document.createElement("canvas"), obj = document.createElement("canvas");
    let raf = 0, cache = { x: NaN, y: NaN, k: NaN }, shown = { x: NaN, y: NaN };
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const L = live.current, c = cvs.current;
      if (!c || !L.model || L.size.w < 2 || L.size.h < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(L.size.w * dpr), H = Math.round(L.size.h * dpr);
      const CW = Math.round((L.size.w + 2 * OV) * dpr), CH = Math.round((L.size.h + 2 * OV) * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      if (ground.width !== CW || ground.height !== CH) { ground.width = obj.width = CW; ground.height = obj.height = CH; L.full = true; }
      const dx = L.v.x - cache.x, dy = L.v.y - cache.y;
      const stale = L.full || L.v.k !== cache.k || Math.abs(dx) > OV || Math.abs(dy) > OV || ((dx || dy) && ts - L.moved > 160);
      if (stale) {
        L.full = false; cache = { ...L.v };
        const vt: [number, number, number, number, number, number] = [dpr * L.v.k, 0, 0, dpr * L.v.k, dpr * (L.v.x + OV), dpr * (L.v.y + OV)];
        const g = ground.getContext("2d")!, o = obj.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, CW, CH); g.setTransform(...vt); drawGround(g, L.model, L.proj, L.city);
        o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, CW, CH); o.setTransform(...vt);
        drawObjects(o, L.model, L.proj, L.city, { x: L.v.x + OV, y: L.v.y + OV, k: L.v.k, w: L.size.w + 2 * OV, h: L.size.h + 2 * OV });
      }
      const cars = !L.calm && L.model.cars.length > 0;
      if (!stale && !cars && shown.x === L.v.x && shown.y === L.v.y) return;
      shown = { x: L.v.x, y: L.v.y };
      const x = c.getContext("2d")!, ox = Math.round((L.v.x - cache.x - OV) * dpr), oy = Math.round((L.v.y - cache.y - OV) * dpr);
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.drawImage(ground, ox, oy);
      if (cars) { x.setTransform(dpr * L.v.k, 0, 0, dpr * L.v.k, dpr * L.v.x, dpr * L.v.y); drawCars(x, L.model, L.proj, L.city, ts / 1000); x.setTransform(1, 0, 0, 1, 0, 0); }
      x.drawImage(obj, ox, oy);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const A = (lat: number, lng: number) => {
    let { x, y } = toXY(center, lat, lng);
    const d = Math.hypot(x, y), lim = R * 0.96;
    if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; }
    return P(x, y);
  };

  const { items, pos } = useMemo(() => {
    const its: Item[] = [];
    st.issues.filter(i => filter.includes(i.status)).forEach(i => {
      const a = A(i.lat, i.lng), k = grp(i.status), w = i.agent ? S.workflow(st, i) : null;
      its.push({ id: i.id, kind: "issue", ax: a.x, ay: a.y, col: pal[k], Icon: CI[i.cat], label: trunc(i.title), n: i.reports, pulse: k !== "green", prog: w ? w.done / w.total : undefined });
    });
    // An open SOS request is an emergency, so it is always drawn, whatever the status filter says.
    sos.forEach(x => {
      if (x.lat == null || x.lng == null || !["open", "acknowledged", "assigned"].includes(x.status)) return;
      const a = A(x.lat, x.lng);
      its.push({ id: x.id, kind: "sos", ax: a.x, ay: a.y, col: "#ef4444", Icon: Siren, label: `SOS · ${SOS_LABEL[x.need]}`, n: x.people, pulse: true });
    });
    return { items: its, pos: layout(its, lift) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.issues, sos, filter, center.lat, center.lng, proj, pal]);

  const centerOn = (wx: number, wy: number, k: number) => setV({ k, x: size.w / 2 - wx * k, y: size.h / 2 - wy * k });
  const homeTarget = () => {
    const n = items.length, c0 = P(0, 0);
    const cx = n ? items.reduce((a, i) => a + i.ax, 0) / n : c0.x, cy = n ? items.reduce((a, i) => a + i.ay, 0) / n : c0.y;
    return { wx: cx, wy: cy - lift / 2, k: size.w < 600 ? 0.62 : 0.85 };
  };
  const home = () => { const h = homeTarget(); centerOn(h.wx, h.wy, h.k); };
  const zoomAt = (cx: number, cy: number, f: number) => setV(o => { const k = cl(o.k * f, 0.3, 2.4), r = k / o.k; return { k, x: cx - (cx - o.x) * r, y: cy - (cy - o.y) * r }; });

  // camera: rotate and tilt around the ground point under the middle of the screen
  const camGoal = useRef<Cam>(cam), anim = useRef(0);
  const pivotNow = () => proj.inv((size.w / 2 - v.x) / v.k, (size.h / 2 - v.y) / v.k);
  const pivotTo = (nc: Cam, pv: Pt2, k?: number) => {
    const p = makeProj(R, flat, nc).P(pv.x, pv.y);
    setCam(nc);
    setV(o => { const kk = k ?? o.k; return { k: kk, x: size.w / 2 - p.x * kk, y: size.h / 2 - p.y * kk }; });
  };
  const animateCam = (to: Cam, ms = 650, from: Cam = cam, pv: Pt2 = pivotNow(), k?: number) => {
    cancelAnimationFrame(anim.current);
    camGoal.current = to;
    if (calm) { pivotTo(to, pv, k); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / ms), e = 1 - (1 - f) ** 3;
      pivotTo({ rot: from.rot + (to.rot - from.rot) * e, tilt: from.tilt + (to.tilt - from.tilt) * e }, pv, k);
      if (f < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const rotate = (d: number) => animateCam({ ...camGoal.current, rot: camGoal.current.rot + d });
  const cycleTilt = () => { const i = TILTS.findIndex(x => Math.abs(x - camGoal.current.tilt) < 0.03); animateCam({ ...camGoal.current, tilt: TILTS[(i + 1) % TILTS.length] }); };
  const nUp = (() => { const a = P(0, 0), b = P(0, -100); return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90; })();
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = `${center.lat},${center.lng},${R},${flat}`;
    if (!map || inited.current === key || size.w <= 0) return;
    const first = !inited.current;
    inited.current = key;
    const h = homeTarget();
    if (first && !flat && !calm) {
      const pv = proj.inv(h.wx, h.wy);
      animateCam({ rot: 0, tilt: TILT0 }, 1700, { rot: -0.75, tilt: 0.78 }, pv, h.k);
    } else centerOn(h.wx, h.wy, h.k);
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

  const open = st.issues.filter(i => i.status !== "resolved" && !i.hidden);
  const selRing = pal.dark ? "#ffffff" : "#1c1917";

  const pin = (it: Item, p: Pt2) => {
    const on = sel === it.id, show = on || hov === it.id || v.k > 1.5, sc = on ? 1.12 : 1;
    const w = it.label.length * 7 + 24;
    return (
      <g key={it.id} transform={`translate(${p.x},${p.y}) scale(${sc})`} className={`mpin ${on ? "on" : ""}`} style={{ cursor: "pointer", ["--pc" as string]: it.col }}
        tabIndex={0} role="button" aria-label={`${it.kind === "sos" ? "SOS request" : "Issue"}: ${it.label}`}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSel(it.id); } }}
        onPointerDown={e => e.stopPropagation()} onClick={() => onSel(it.id)}
        onPointerEnter={() => setHov(it.id)} onPointerLeave={() => setHov(null)}>
        {it.prog != null && <circle r="31" fill="none" stroke={it.col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${it.prog * 194.8} 194.8`} transform="rotate(-90)" />}
        {it.kind === "sos" && <><circle r="30" fill={it.col} fillOpacity=".18" className="ring" /><circle r="46" fill="none" stroke={it.col} strokeWidth="2" className="ring" style={{ animationDelay: ".8s" }} /></>}
        <g className="mpin-head">
          <path d="M-8,19 L0,29 L8,19Z" fill={it.col} />
          <rect className="mpin-bg" x="-22" y="-22" width="44" height="44" rx="13" stroke={on ? selRing : it.col} strokeWidth="2.5" style={on ? { fill: it.col } : undefined} />
          <it.Icon x={-12} y={-12} size={24} color={on ? pal.onCol : it.col} strokeWidth={2.2} />
        </g>
        {(it.n ?? 0) > 1 && <g transform="translate(20,-20)"><circle r="10" fill={it.col} style={{ stroke: "var(--pin-bg)" }} strokeWidth="2" /><text textAnchor="middle" y="4" fontSize="11" fontWeight="700" fill={pal.onCol}>{it.n}</text></g>}
        {show && <g transform="translate(0,-46)"><rect className="mpin-label" x={-w / 2} y="-12" width={w} height="24" rx="12" style={{ stroke: it.col }} /><text className="mpin-text" textAnchor="middle" y="4" fontSize="12">{it.label}</text></g>}
      </g>
    );
  };

  const order = items.map((it, n) => ({ it, p: pos[n] })).sort((a, b) => Number(a.it.id === sel) - Number(b.it.id === sel) || a.p.y - b.p.y);
  const pk = pick && (() => { const a = A(pick.lat, pick.lng); return { a, p: { x: a.x, y: a.y - lift } }; })();
  const count = (g: S.Status[]) => st.issues.filter(i => g.includes(i.status)).length;
  const hy = flat ? 120 * KF : 150 * K * 1.4, zr = flat ? 250 * KF : 283;
  const tip = (s: string) => ({ "data-tip": s, "aria-label": s });

  return (
    <div className={`iso ${flat ? "isflat" : ""}`} ref={box}>
      <canvas ref={cvs} className="citycanvas" aria-hidden="true" />
      <svg ref={svg} role="img" aria-label="Interactive 3D neighbourhood map. The same items are listed in the side panel." className={`isosvg ${picking ? "picking" : ""}`}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          const orbit = e.button === 2 || e.shiftKey;
          drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false, orbit: orbit ? { cam, pv: pivotNow() } : undefined };
          if (orbit) cancelAnimationFrame(anim.current);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.hypot(dx, dy) > 4) d.moved = true;
            if (!d.moved) return;
            if (d.orbit) { const nc = { rot: d.orbit.cam.rot + dx * 0.006, tilt: flat ? d.orbit.cam.tilt : cl(d.orbit.cam.tilt - dy * 0.0025, TILT_MIN, TILT_MAX) }; camGoal.current = nc; pivotTo(nc, d.orbit.pv); }
            else setV(o => ({ ...o, x: d.vx + dx, y: d.vy + dy }));
          } else { const r = rel(e); setCur(llAt(r.x, r.y)); }
        }}
        onPointerUp={e => {
          const d = drag.current; drag.current = null;
          if (d && !d.moved && !d.orbit && picking) { const r = rel(e), ll = llAt(r.x, r.y); onPick(ll.lat, ll.lng); }
        }}
        onPointerLeave={() => setCur(null)}>
        <defs>
          <filter id="blur18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22" /></filter>
        </defs>
        <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
          {heat && (
            <g filter="url(#blur18)" style={{ mixBlendMode: pal.heatBlend }}>
              {open.map(i => { const a = A(i.lat, i.lng), w = S.priorityScore(st, i).score / 100; return <g key={"h" + i.id}><ellipse cx={a.x} cy={a.y} rx={hy * 1.5} ry={hy * 1.5 * t} fill={pal.heat[0]} fillOpacity={0.12 + 0.22 * w} /><ellipse cx={a.x} cy={a.y} rx={hy} ry={hy * t} fill={pal.heat[1]} fillOpacity={0.2 + 0.4 * w} /></g>; })}
            </g>
          )}
          {order.map(({ it, p }) => {
            const sc = sel === it.id ? 1.12 : 1;
            return (
              <g key={"l" + it.id}>
                {sel === it.id && <line x1={p.x} y1={p.y + 29 * sc} x2={it.ax} y2={it.ay} stroke={it.col} strokeWidth="9" strokeOpacity=".18" strokeLinecap="round" />}
                <line x1={p.x} y1={p.y + 29 * sc} x2={it.ax} y2={it.ay} stroke={it.col} strokeWidth="2" strokeOpacity=".9" />
                {it.pulse && <ellipse cx={it.ax} cy={it.ay} rx="22" ry={22 * t} fill="none" stroke={it.col} strokeWidth="2.5" className="ring" />}
                <ellipse cx={it.ax} cy={it.ay} rx="15" ry={15 * t} fill={it.col} fillOpacity=".25" stroke={it.col} strokeWidth="2" />
                <ellipse cx={it.ax} cy={it.ay} rx="4" ry={4 * t} fill={it.col} />
              </g>
            );
          })}
          {order.map(({ it, p }) => pin(it, p))}
          {pk && (
            <g>
              <ellipse cx={pk.a.x} cy={pk.a.y} rx="22" ry={22 * t} fill="none" stroke={pal.accent} strokeWidth="2.5" className="ring" />
              <ellipse cx={pk.a.x} cy={pk.a.y} rx="15" ry={15 * t} fill={pal.accent} fillOpacity=".25" stroke={pal.accent} strokeWidth="2" />
              <line x1={pk.p.x} y1={pk.p.y + 29} x2={pk.a.x} y2={pk.a.y} stroke={pal.accent} strokeWidth="2" />
              <g transform={`translate(${pk.p.x},${pk.p.y})`} className="mpin">
                <g className="mpin-head" style={{ ["--pc" as string]: pal.accent }}>
                  <path d="M-8,19 L0,29 L8,19Z" fill={pal.accent} />
                  <rect x="-22" y="-22" width="44" height="44" rx="13" fill={pal.accent} />
                  <Plus x={-12} y={-12} size={24} color={pal.onCol} strokeWidth={2.6} />
                </g>
                <g transform="translate(0,-46)"><rect className="mpin-label" x="-68" y="-12" width="136" height="24" rx="12" style={{ stroke: pal.accent }} /><text className="mpin-text" textAnchor="middle" y="4" fontSize="12">Chosen location</text></g>
              </g>
            </g>
          )}
          {hi?.inside && (() => { const a = A(here.lat!, here.lng!); return (
            <g pointerEvents="none" aria-hidden="true">
              <ellipse cx={a.x} cy={a.y} rx="26" ry={26 * t} fill="none" stroke="#2563eb" strokeWidth="2.5" className="ring" />
              <ellipse cx={a.x} cy={a.y} rx="9" ry={9 * t} fill="#2563eb" stroke="#fff" strokeWidth="3" />
              <text x={a.x} y={a.y - 22} textAnchor="middle" fontSize="13" fontWeight="700" fill={pal.city.label} stroke={pal.city.halo} strokeWidth="4" paintOrder="stroke">{tr("YOU ARE HERE")}</text>
            </g>); })()}
        </g>
      </svg>

      {!map && <div className="maploading"><span className="spinner" />Loading neighbourhood map…</div>}
      {note && <div className="mapnote glass">{note}</div>}
      {picking && !pick && <div className="pickhint glass"><Crosshair size={14} /> Click the map to choose a location</div>}

      <div className="hud hud-top glass">
        <span className="hdot" aria-hidden="true" />
        <b className="hname">{name}</b>
        <span className="mono">{info.lat.toFixed(4)}, {info.lng.toFixed(4)}</span>
        <label className="hsearchwrap"><Search size={15} aria-hidden="true" />
          <input className="hsearch" placeholder="Find an issue" aria-label="Find an issue" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              const s = q.trim().toLowerCase(), h = st.issues.find(i => i.title.toLowerCase().includes(s));
              if (!h) return;
              const a = A(h.lat, h.lng); centerOn(a.x, a.y - 60, 1.1); onSel(h.id);
            }} />
        </label>
      </div>
      <ViewSwitch view={view} setView={setView} />
      {nearPlace && !picking && (
        <div className="hud hud-near glass" role="status" aria-live="off">
          <MapPin size={13} aria-hidden="true" /> <span className="dim">{tr("Near")}</span> <b>{nearPlace.place.n}</b>
        </div>
      )}
      {here.status !== "off" && (
        <div className="hud hud-here glass" role="status" aria-live="polite">
          {here.status === "asking" && <span>{tr("Finding your location…")}</span>}
          {here.status === "denied" && <span>{tr("Location is blocked. Allow it in your browser's site settings, then try again.")}</span>}
          {here.status === "unsupported" && <span>{tr("Your browser does not support location.")}</span>}
          {here.status === "error" && <span>{tr("Could not get your location. Try again.")}</span>}
          {hi && <>
            <i className="herepoint" />
            <span><b>{tr("You are here")}</b> · {hi.inside ? tr("inside this neighbourhood") : `${fmtDist(hi.dist)} ${tr("from the center of this neighbourhood")}`}{here.acc != null && here.acc > 50 ? ` · ±${Math.round(here.acc)} m` : ""}</span>
            {!hi.inside && app.mode === "live" && <button className="go" disabled={opening} onClick={openMine}>{tr("Open my area")}</button>}
            {!hi.inside && app.mode !== "live" && <span className="dim">{tr("This demo area is simulated, so you will not appear on it.")}</span>}
          </>}
          <button className="tabb" onClick={stop}>{here.status === "on" || here.status === "asking" ? tr("Stop") : tr("Close")}</button>
          {openErr && <small className="bad">{openErr}</small>}
          <small className="dim">{tr("Your location stays on this device. Opening your area sends only a 1 km area code.")}</small>
        </div>
      )}

      <div className="hud hud-right">
        {alertText && <button className="active-pill" onClick={onAlert}><AlertTriangle size={16} /> {alertText}</button>}
        <div className="tgroup glass" role="group" aria-label="Zoom">
          <button className="rbtn" {...tip("Zoom in")} onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)}><Plus size={18} /></button>
          <button className="rbtn" {...tip("Zoom out")} onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)}><Minus size={18} /></button>
        </div>
        <div className="tgroup glass" role="group" aria-label="Camera">
          <button className="rbtn" {...tip("Rotate left")} onClick={() => rotate(-Math.PI / 4)}><RotateCcw size={17} /></button>
          <button className="rbtn compass" {...tip("Reset camera")} onClick={() => animateCam({ rot: 0, tilt: TILT0 })}><Navigation2 size={17} style={{ transform: `rotate(${nUp}deg)` }} /><span className="nlbl" style={{ transform: `rotate(${nUp}deg) translateY(-15px) rotate(${-nUp}deg)` }}>N</span></button>
          <button className="rbtn" {...tip("Rotate right")} onClick={() => rotate(Math.PI / 4)}><RotateCw size={17} /></button>
          {!flat && <button className="rbtn" {...tip(`Tilt: ${TILT_NAME(cam.tilt)}`)} onClick={cycleTilt}><Rotate3d size={17} /></button>}
        </div>
        <div className="tgroup glass" role="group" aria-label="Map layers">
          <button className={`rbtn ${heat ? "on" : ""}`} aria-pressed={heat} {...tip("Issue heatmap")} onClick={() => setHeat(!heat)}><Flame size={17} /></button>
          <button className={`rbtn ${timeOn ? "on" : ""}`} aria-pressed={timeOn} {...tip("Then vs now")} onClick={onTime}><History size={17} /></button>
        </div>
        <div className="tgroup glass">
          <button className={`rbtn ${here.status === "on" ? "on" : ""}`} {...tip(tr("Show my location"))} onClick={() => { if (here.status !== "on") start(); else if (hi?.inside) { const a = A(here.lat!, here.lng!); centerOn(a.x, a.y - 40, 1.1); } }}><LocateFixed size={17} /></button>
          <button className="rbtn" {...tip("Recenter on the issues")} onClick={home}><Crosshair size={17} /></button>
        </div>
      </div>

      <div className="hud hud-bottom glass" role="group" aria-label="Show on the map">
        {GROUPS.map(([label, g, c]) => {
          const on = g.every(s => filter.includes(s));
          return <button key={label} className={`tabb fchip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setFilter(on ? filter.filter(s => !g.includes(s)) : [...new Set([...filter, ...g])])}><i className={`dotc ${c}`} />{label}<sup>{count(g)}</sup></button>;
        })}
      </div>

      <div className="hud hud-legend">
        {legend && (
          <div className="legend glass" role="dialog" aria-label="Map key">
            <div className="row between"><b>Map key</b><button className="x icon" aria-label="Close map key" onClick={() => setLegend(false)}><X size={14} /></button></div>
            <ul>
              <li><i className="lg-dot red" />Open: reported or under review</li>
              <li><i className="lg-dot amber" />In progress: assigned, being fixed or awaiting approval</li>
              <li><i className="lg-dot green" />Fixed and approved by a coordinator</li>
              <li><i className="lg-prog" />Ring around a pin: AI agent progress</li>
              <li><b className="lg-num">3</b>Neighbors who reported the same problem</li>
            </ul>
            <small className="dim">Drag to move · scroll to zoom · Shift + drag (or right-drag) to rotate and tilt the city.</small>
          </div>
        )}
        <button className="keybtn glass" aria-expanded={legend} onClick={() => setLegend(!legend)}><Info size={15} /> Map key</button>
        <div className="scale"><span>120 m</span><i style={{ width: 120 * (flat ? KF : K * 1.118) * v.k }} /></div>
      </div>
    </div>
  );
}