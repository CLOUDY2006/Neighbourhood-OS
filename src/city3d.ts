import type { MapData, Place } from "./mapdata";
import { labelBudget, layoutPlaceLabels, type Slot } from "./places";
import type { City, RGB } from "./theme";

/* Canvas renderer for the 3D neighbourhood: a floating diorama slab, lit buildings with cast shadows,
   trees, street lamps and traffic. The camera can rotate around the city and tilt. Pins and overlays
   are drawn in SVG on top using the same projection. */

export interface Cam { rot: number; tilt: number }
export const K = 0.8, KF = 1.1, KZ = 1.4, TILT0 = 0.5, TILT_MIN = 0.3, TILT_MAX = 0.86;
const SUN = (() => { const x = -0.35, y = 1, l = Math.hypot(x, y); return { x: x / l, y: y / l }; })(); // toward the sun (south-southwest)
const SHX = -SUN.x * 0.85, SHY = -SUN.y * 0.85; // shadow offset per unit of height
const HALF = [16.5, 13.8, 10.6, 4]; // road half width in meters, including the sidewalk

export function makeProj(R: number, flat: boolean, cam: Cam) {
  const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  if (flat) {
    const OX = R * KF + 140, OY = R * KF + 200;
    return {
      flat, OX, OY, k: KF, t: 1, zf: 0, c, s,
      P: (x: number, y: number, _z = 0) => ({ x: OX + (x * c - y * s) * KF, y: OY + (x * s + y * c) * KF }),
      inv: (wx: number, wy: number) => { const a = (wx - OX) / KF, b = (wy - OY) / KF; return { x: a * c + b * s, y: -a * s + b * c }; },
      depth: (x: number, y: number) => x * s + y * c,
    };
  }
  const t = cam.tilt, zf = (KZ * Math.sqrt(1 - t * t)) / Math.sqrt(0.75), OX = 2 * R * K + 120, OY = R * K + 300;
  return {
    flat, OX, OY, k: K, t, zf, c, s,
    P: (x: number, y: number, z = 0) => { const a = x * c - y * s, b = x * s + y * c; return { x: OX + (a - b) * K, y: OY + (a + b) * K * t - z * zf }; },
    inv: (wx: number, wy: number) => { const u = (wx - OX) / K, w = (wy - OY) / (K * t), a = (u + w) / 2, b = (w - u) / 2; return { x: a * c + b * s, y: -a * s + b * c }; },
    depth: (x: number, y: number) => x * c - y * s + x * s + y * c,
  };
}
export type Proj = ReturnType<typeof makeProj>;

const rng = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function hull(p: number[]) {
  const pts: [number, number][] = [];
  for (let k = 0; k < p.length; k += 2) pts.push([p[k], p[k + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let k = pts.length - 1; k >= 0; k--) { const q = pts[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].flat();
}
const pip = (p: number[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};
function grid<T>(cell: number) {
  const m = new Map<number, T[]>(), key = (i: number, j: number) => i * 100003 + j;
  return {
    add(x0: number, y0: number, x1: number, y1: number, v: T) {
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
        const k = key(i, j), a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
      }
    },
    get: (x: number, y: number) => m.get(key(Math.floor(x / cell), Math.floor(y / cell))) ?? [],
  };
}

interface Bld { p: number[]; n: number; h: number; cx: number; cy: number; mat: number; roof: number; neon: number; nx: number[]; ny: number[]; lit: number[]; hull: number[]; seed: number }
interface Tree { x: number; y: number; r: number; h: number }
interface Car { p: number[]; cum: number[]; len: number; dur: number; phase: number; rev: boolean }
interface Label { x: number; y: number; ax: number; ay: number; bx: number; by: number; text: string }
export interface Model { R: number; slabR: number; blds: Bld[]; trees: Tree[]; lamps: number[]; cars: Car[]; labels: Label[]; places: Place[]; roads: MapData["roads"]; areas: MapData["areas"] }

const plen = (p: number[]) => { let s = 0; for (let q = 2; q < p.length; q += 2) s += Math.hypot(p[q] - p[q - 2], p[q + 1] - p[q - 1]); return s; };

export function buildModel(map: MapData): Model {
  const R = map.r, slabR = R * 1.08, rnd = rng(7);
  const blds: Bld[] = [], bg = grid<number[]>(60), rg = grid<[number, number, number, number, number]>(60);
  map.blds.forEach((b, i) => {
    const n = b.p.length / 2;
    if (n < 3) return;
    let cx = 0, cy = 0, A = 0;
    for (let k = 0; k < n; k++) { const j = (k + 1) % n; cx += b.p[2 * k]; cy += b.p[2 * k + 1]; A += b.p[2 * k] * b.p[2 * j + 1] - b.p[2 * j] * b.p[2 * k + 1]; }
    cx /= n; cy /= n;
    if (Math.hypot(cx, cy) > R * 1.02) return;
    const sg = A >= 0 ? 1 : -1, nx: number[] = [], ny: number[] = [], lit: number[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, ex = b.p[2 * j] - b.p[2 * k], ey = b.p[2 * j + 1] - b.p[2 * k + 1], l = Math.hypot(ex, ey) || 1;
      const ox = (sg * ey) / l, oy = (-sg * ex) / l;
      nx.push(ox); ny.push(oy); lit.push(Math.max(0, Math.min(1, 0.5 + 0.5 * (ox * SUN.x + oy * SUN.y))));
      x0 = Math.min(x0, b.p[2 * k]); x1 = Math.max(x1, b.p[2 * k]); y0 = Math.min(y0, b.p[2 * k + 1]); y1 = Math.max(y1, b.p[2 * k + 1]);
    }
    const ext = [...b.p];
    for (let k = 0; k < n; k++) ext.push(b.p[2 * k] + SHX * b.h, b.p[2 * k + 1] + SHY * b.h);
    blds.push({ p: b.p, n, h: b.h, cx, cy, mat: b.h > 45 ? 1 : i % 7 === 3 ? 2 : 0, roof: i, neon: b.h > 40 && i % 5 === 0 ? i % 4 : -1, nx, ny, lit, hull: hull(ext), seed: i });
    bg.add(x0 - 4, y0 - 4, x1 + 4, y1 + 4, b.p);
  });
  for (const r of map.roads) for (let q = 2; q < r.p.length; q += 2) {
    const s: [number, number, number, number, number] = [r.p[q - 2], r.p[q - 1], r.p[q], r.p[q + 1], r.c];
    rg.add(Math.min(s[0], s[2]) - 20, Math.min(s[1], s[3]) - 20, Math.max(s[0], s[2]) + 20, Math.max(s[1], s[3]) + 20, s);
  }
  const water = map.areas.filter(a => a.k === "water");
  const free = (x: number, y: number, pad: number) =>
    Math.hypot(x, y) < slabR * 0.94 && !bg.get(x, y).some(p => pip(p, x, y)) && !rg.get(x, y).some(s => segDist(x, y, s[0], s[1], s[2], s[3]) < HALF[s[4]] + pad) && !water.some(a => pip(a.p, x, y));

  const trees: Tree[] = [];
  for (const a of map.areas) {
    if (a.k !== "park") continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, A = 0;
    for (let k = 0; k < a.p.length; k += 2) { x0 = Math.min(x0, a.p[k]); x1 = Math.max(x1, a.p[k]); y0 = Math.min(y0, a.p[k + 1]); y1 = Math.max(y1, a.p[k + 1]); const j = (k + 2) % a.p.length; A += a.p[k] * a.p[j + 1] - a.p[j] * a.p[k + 1]; }
    const want = Math.min(34, Math.floor(Math.abs(A) / 2 / 650));
    for (let tries = 0, got = 0; tries < want * 4 && got < want && trees.length < 380; tries++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      if (pip(a.p, x, y) && free(x, y, 3)) { trees.push({ x, y, r: 4.2 + rnd() * 3.2, h: 9 + rnd() * 7 }); got++; }
    }
  }
  const lamps: number[] = [];
  for (const r of map.roads) {
    if (r.c > 2 || r.p.length < 4) continue;
    let side = 1, carry = rnd() * 30, lampCarry = rnd() * 40;
    for (let q = 2; q < r.p.length; q += 2) {
      const xa = r.p[q - 2], ya = r.p[q - 1], xb = r.p[q], yb = r.p[q + 1], L = Math.hypot(xb - xa, yb - ya);
      if (!L) continue;
      const ux = (xb - xa) / L, uy = (yb - ya) / L;
      for (let d = carry; d < L && trees.length < 520; d += 30 + rnd() * 14) {
        const off = (HALF[r.c] + 5) * side; side = -side;
        const x = xa + ux * d - uy * off, y = ya + uy * d + ux * off;
        if (free(x, y, 2.5)) trees.push({ x, y, r: 3.6 + rnd() * 2.2, h: 8 + rnd() * 5 });
      }
      for (let d = lampCarry; d < L && lamps.length < 520; d += 58) {
        const off = (HALF[r.c] - 2) * (lamps.length % 4 < 2 ? 1 : -1);
        const x = xa + ux * d - uy * off, y = ya + uy * d + ux * off;
        if (Math.hypot(x, y) < slabR * 0.96) lamps.push(x, y);
      }
      carry = Math.max(0, carry - L); lampCarry = Math.max(0, lampCarry - L);
    }
  }
  const long = map.roads.filter(r => r.c <= 2 && r.p.length >= 4).map(r => ({ r, l: plen(r.p) })).sort((a, b) => b.l - a.l);
  const cars: Car[] = long.slice(0, 12).map(({ r, l }, i) => {
    const cum = [0];
    for (let q = 2; q < r.p.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(r.p[q] - r.p[q - 2], r.p[q + 1] - r.p[q - 1]));
    return { p: r.p, cum, len: l, dur: Math.max(14, l / 16), phase: (i * 0.37) % 1, rev: i % 2 === 1 };
  });
  const labels: Label[] = long.filter(x => x.r.n).slice(0, 6).map(({ r }) => {
    const m = Math.floor(r.p.length / 4) * 2, a = Math.max(0, m - 2), b = Math.min(r.p.length - 2, m + 2);
    return { x: r.p[m], y: r.p[m + 1], ax: r.p[a], ay: r.p[a + 1], bx: r.p[b], by: r.p[b + 1], text: (r.n ?? "").toUpperCase() };
  });
  const places = (map.places ?? []).filter(p => p.k === "society");
  return { R, slabR, blds, trees, lamps, cars, labels, places, roads: map.roads, areas: map.areas };
}

/* ---------- drawing ---------- */

const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const sprites = new Map<string, HTMLCanvasElement>();
function glow(col: string) {
  let s = sprites.get(col);
  if (!s) {
    s = document.createElement("canvas"); s.width = s.height = 64;
    const g = s.getContext("2d")!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hexA(col, 0.6)); gr.addColorStop(0.3, hexA(col, 0.24)); gr.addColorStop(1, hexA(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); sprites.set(col, s);
  }
  return s;
}
const luts = new WeakMap<City, string[][]>();
function wallLut(pal: City) {
  let l = luts.get(pal);
  if (!l) {
    const mix = (a: RGB, b: RGB, f: number) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
    l = pal.walls.map(w => Array.from({ length: 17 }, (_, i) => mix(w.shade, w.lit, i / 16)));
    luts.set(pal, l);
  }
  return l;
}

export interface View { x: number; y: number; k: number; w: number; h: number }

function slabShape(m: Model, pr: Proj) {
  const c0 = pr.P(0, 0), rx = pr.flat ? m.slabR * KF : m.slabR * K * Math.SQRT2;
  return { c0, rx, ry: pr.flat ? rx : rx * pr.t, T: pr.flat ? 0 : 34 * (pr.zf / KZ) };
}

export function drawGround(ctx: CanvasRenderingContext2D, m: Model, pr: Proj, pal: City) {
  const { P } = pr, { c0, rx, ry, T } = slabShape(m, pr);
  // soft drop shadow under the floating slab
  ctx.save(); ctx.translate(c0.x, c0.y + T + (pr.flat ? 8 : 22)); ctx.scale(1, ry / rx);
  const ds = ctx.createRadialGradient(0, 0, rx * 0.72, 0, 0, rx * 1.14);
  ds.addColorStop(0, pal.dropShadow); ds.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ds; ctx.beginPath(); ctx.arc(0, 0, rx * 1.14, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  if (T > 0) {
    const gs = ctx.createLinearGradient(0, c0.y, 0, c0.y + ry + T);
    gs.addColorStop(0, pal.slabSide[0]); gs.addColorStop(1, pal.slabSide[1]);
    ctx.beginPath(); ctx.moveTo(c0.x - rx, c0.y); ctx.lineTo(c0.x - rx, c0.y + T); ctx.ellipse(c0.x, c0.y + T, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(c0.x + rx, c0.y); ctx.ellipse(c0.x, c0.y, rx, ry, 0, 0, Math.PI, false); ctx.closePath();
    ctx.fillStyle = gs; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = pal.strata;
    for (const f of [0.38, 0.7]) { ctx.beginPath(); ctx.ellipse(c0.x, c0.y + T * f, rx, ry, 0, 0.02, Math.PI - 0.02, false); ctx.stroke(); }
  }
  ctx.beginPath(); ctx.ellipse(c0.x, c0.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.slabTop; ctx.fill();
  ctx.save(); ctx.clip();

  const poly = (p: number[], path: Path2D | CanvasRenderingContext2D = ctx) => { for (let q = 0; q < p.length; q += 2) { const a = P(p[q], p[q + 1]); if (q) path.lineTo(a.x, a.y); else path.moveTo(a.x, a.y); } };
  for (const a of m.areas) {
    ctx.beginPath(); poly(a.p); ctx.closePath();
    ctx.fillStyle = a.k === "park" ? pal.park : pal.water; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = a.k === "park" ? pal.parkEdge : pal.waterEdge; ctx.stroke();
  }
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (const r of m.roads) poly(r.p, paths[Math.min(3, r.c)]);
  const WID = pr.flat ? [26, 20, 14, 7] : [30, 24, 17, 8];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = pal.walk;
  for (const c of [2, 1, 0]) { ctx.lineWidth = WID[c] + 7; ctx.stroke(paths[c]); }
  ctx.lineWidth = WID[3] + 3; ctx.stroke(paths[3]);
  for (const c of [3, 2, 1, 0]) { ctx.lineWidth = WID[c]; ctx.strokeStyle = pal.road[c]; ctx.stroke(paths[c]); }
  ctx.setLineDash([10, 12]); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.lane; ctx.globalAlpha = pal.laneAlpha;
  ctx.stroke(paths[0]); ctx.stroke(paths[1]);
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // one union path for every shadow so overlaps do not darken twice
  const sp = new Path2D();
  for (const b of m.blds) { poly(b.hull, sp); sp.closePath(); }
  for (const t of m.trees) {
    const cx = t.x + SHX * t.h * 0.7, cy = t.y + SHY * t.h * 0.7;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, q = P(cx + Math.cos(a) * t.r, cy + Math.sin(a) * t.r); if (k) sp.lineTo(q.x, q.y); else sp.moveTo(q.x, q.y); }
    sp.closePath();
  }
  ctx.globalAlpha = pal.shadowAlpha; ctx.fillStyle = pal.shadow; ctx.fill(sp, "nonzero"); ctx.globalAlpha = 1;

  if (pal.lamp) {
    const g = glow(pal.lamp), w = 44, h = 44 * pr.t;
    for (let q = 0; q < m.lamps.length; q += 2) { const a = P(m.lamps[q], m.lamps[q + 1]); ctx.drawImage(g, a.x - w / 2, a.y - h / 2, w, h); }
    ctx.fillStyle = pal.lamp;
    for (let q = 0; q < m.lamps.length; q += 2) { const a = P(m.lamps[q], m.lamps[q + 1]); ctx.beginPath(); ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();

  // neighbourhood boundary
  const br = pr.flat ? m.R * KF : m.R * K * Math.SQRT2;
  ctx.beginPath(); ctx.ellipse(c0.x, c0.y, br, pr.flat ? br : br * pr.t, 0, 0, Math.PI * 2);
  ctx.setLineDash([14, 10]); ctx.lineWidth = 2; ctx.strokeStyle = pal.slabRing; ctx.globalAlpha = 0.4; ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.ellipse(c0.x, c0.y, rx, ry, 0, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.roofEdge; ctx.stroke();
}

function drawBld(ctx: CanvasRenderingContext2D, b: Bld, pr: Proj, pal: City, lut: string[][], showWin: boolean) {
  const { P } = pr, n = b.n, roof = pal.roofs[b.roof % pal.roofs.length];
  if (pr.flat) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const a = P(b.p[2 * k], b.p[2 * k + 1]); if (k) ctx.lineTo(a.x, a.y); else ctx.moveTo(a.x, a.y); }
    ctx.closePath(); ctx.fillStyle = roof; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = pal.roofEdge; ctx.stroke();
    return;
  }
  const base: { x: number; y: number }[] = new Array(n), top: { x: number; y: number }[] = new Array(n);
  for (let k = 0; k < n; k++) { base[k] = P(b.p[2 * k], b.p[2 * k + 1], 0); top[k] = P(b.p[2 * k], b.p[2 * k + 1], b.h); }
  const ws: number[] = [];
  for (let k = 0; k < n; k++) { const rx = b.nx[k] * pr.c - b.ny[k] * pr.s, ry = b.nx[k] * pr.s + b.ny[k] * pr.c; if (rx + ry > 0.001) ws.push(k); }
  if (ws.length > 2) ws.sort((a, c) => base[a].y + base[(a + 1) % n].y - base[c].y - base[(c + 1) % n].y);
  const shades = lut[b.mat];
  ctx.lineWidth = 0.7; ctx.lineJoin = "round";
  for (const k of ws) {
    const j = (k + 1) % n, col = shades[Math.round(b.lit[k] * 16)];
    ctx.beginPath(); ctx.moveTo(base[k].x, base[k].y); ctx.lineTo(base[j].x, base[j].y); ctx.lineTo(top[j].x, top[j].y); ctx.lineTo(top[k].x, top[k].y); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = col; ctx.stroke();
  }
  if (showWin && b.h > 8) {
    const fl = Math.max(1, Math.round(b.h / 4.6));
    ctx.beginPath();
    for (const k of ws) {
      const j = (k + 1) % n;
      if (Math.hypot(base[j].x - base[k].x, base[j].y - base[k].y) < 8) continue;
      const xa = b.p[2 * k], ya = b.p[2 * k + 1], xb = b.p[2 * j], yb = b.p[2 * j + 1], ix = (xb - xa) * 0.1, iy = (yb - ya) * 0.1;
      for (let f = 0; f < fl && f < 14; f++) {
        const z = (b.h * (f + 0.5)) / fl, a = P(xa + ix, ya + iy, z), c = P(xb - ix, yb - iy, z);
        ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
      }
    }
    ctx.setLineDash([3, 4.5]); ctx.lineDashOffset = b.seed % 7; ctx.lineWidth = 2.6; ctx.strokeStyle = pal.win; ctx.globalAlpha = pal.winAlpha;
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  for (let k = 0; k < n; k++) { if (k) ctx.lineTo(top[k].x, top[k].y); else ctx.moveTo(top[k].x, top[k].y); }
  ctx.closePath(); ctx.fillStyle = roof; ctx.fill();
  const neon = b.neon >= 0 && pal.neon.length ? pal.neon[b.neon % pal.neon.length] : null;
  ctx.lineWidth = neon ? 1.8 : 0.9; ctx.strokeStyle = neon ?? pal.roofEdge; ctx.stroke();
}

function drawTree(ctx: CanvasRenderingContext2D, t: Tree, pr: Proj, pal: City) {
  const { P } = pr, g = P(t.x, t.y, 0), sd = P(t.x + SUN.x, t.y + SUN.y, 0), sl = Math.hypot(sd.x - g.x, sd.y - g.y) || 1, ux = (sd.x - g.x) / sl, uy = (sd.y - g.y) / sl;
  if (pr.flat) {
    const r = t.r * KF;
    ctx.fillStyle = pal.tree[1]; ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.tree[0]; ctx.beginPath(); ctx.arc(g.x + ux * r * 0.25, g.y + uy * r * 0.25, r * 0.66, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const m = P(t.x, t.y, t.h * 0.45), c = P(t.x, t.y, t.h * 0.8), r = t.r * K * 1.25;
  ctx.strokeStyle = pal.trunk; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(m.x, m.y); ctx.stroke();
  ctx.fillStyle = pal.tree[1]; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.tree[0]; ctx.beginPath(); ctx.arc(c.x + ux * r * 0.26, c.y + uy * r * 0.26 - r * 0.2, r * 0.66, 0, Math.PI * 2); ctx.fill();
}

export function drawObjects(ctx: CanvasRenderingContext2D, m: Model, pr: Proj, pal: City, view: View, opt: { labels?: boolean; windows?: boolean } = {}) {
  const { P } = pr, M = 60, x0 = -view.x / view.k - M, x1 = (view.w - view.x) / view.k + M, y0 = -view.y / view.k - M, y1 = (view.h - view.y) / view.k + 260;
  const items: { d: number; b?: Bld; t?: Tree }[] = [];
  const on = (x: number, y: number) => { const a = P(x, y); return a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1; };
  for (const b of m.blds) if (on(b.cx, b.cy)) items.push({ d: pr.depth(b.cx, b.cy), b });
  for (const t of m.trees) if (on(t.x, t.y)) items.push({ d: pr.depth(t.x, t.y), t });
  items.sort((a, b) => a.d - b.d);
  const lut = wallLut(pal), showWin = opt.windows ?? view.k > 0.4;
  for (const it of items) { if (it.b) drawBld(ctx, it.b, pr, pal, lut, showWin); else drawTree(ctx, it.t!, pr, pal); }
  if (opt.labels === false || view.k < 0.35) return;
  ctx.font = "600 11px Sora, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "2.5px";
  ctx.lineJoin = "round";
  for (const l of m.labels) {
    const a = P(l.ax, l.ay), b = P(l.bx, l.by), q = P(l.x, l.y);
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(ang);
    ctx.lineWidth = 4; ctx.strokeStyle = pal.halo; ctx.strokeText(l.text, 0, 0);
    ctx.fillStyle = pal.label; ctx.fillText(l.text, 0, 0); ctx.restore();
  }
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
  drawPlaces(ctx, m, pr, pal, view);
}

/** Society names: small, soft text with a dot, kept the same size on screen at any zoom. Hidden when zoomed out. */
function drawPlaces(ctx: CanvasRenderingContext2D, m: Model, pr: Proj, pal: City, view: View) {
  const limit = labelBudget(view.k);
  if (!limit || !m.places.length) return;
  const { P } = pr, k = view.k, size = 10.5 / k, pad = 8 / k, lift = 11 / k;
  const x0 = -view.x / k, x1 = (view.w - view.x) / k, y0 = -view.y / k, y1 = (view.h - view.y) / k;
  ctx.save();
  ctx.font = `600 ${size}px Sora, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const slots: Slot[] = [];
  for (const p of m.places) {
    const a = P(p.x, p.y);
    if (a.x < x0 || a.x > x1 || a.y < y0 + lift || a.y > y1) continue;
    slots.push({ p, x: a.x, y: a.y - lift, w: ctx.measureText(p.n).width + pad, h: size + pad });
  }
  for (const s of layoutPlaceLabels(slots, limit)) {
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = 3 / k; ctx.strokeStyle = pal.halo; ctx.strokeText(s.p.n, s.x, s.y);
    ctx.fillStyle = pal.label; ctx.fillText(s.p.n, s.x, s.y);
    ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(s.x, s.y + lift, 2.2 / k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawCars(ctx: CanvasRenderingContext2D, m: Model, pr: Proj, pal: City, time: number) {
  const { P } = pr, head = pal.lamp ? glow(pal.lamp) : null;
  m.cars.forEach((c, i) => {
    let u = (time / c.dur + c.phase) % 1;
    if (c.rev) u = 1 - u;
    const d = u * c.len;
    let k = 1;
    while (k < c.cum.length - 1 && c.cum[k] < d) k++;
    const sl = c.cum[k] - c.cum[k - 1] || 1, f = (d - c.cum[k - 1]) / sl;
    const xa = c.p[2 * k - 2], ya = c.p[2 * k - 1], xb = c.p[2 * k], yb = c.p[2 * k + 1];
    let dx = (xb - xa) / sl, dy = (yb - ya) / sl;
    if (c.rev) { dx = -dx; dy = -dy; }
    const x = xa + (xb - xa) * f - dy * 4, y = ya + (yb - ya) * f + dx * 4, p = P(x, y), q = P(x + dx, y + dy);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x));
    if (head) { ctx.globalAlpha = 0.7; ctx.drawImage(head, 2, -9, 26, 18); ctx.globalAlpha = 1; }
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(-6, -2.6, 13, 6.8);
    ctx.fillStyle = pal.cars[i % pal.cars.length];
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-6.5, -3.4, 13, 6.8, 2.2); else ctx.rect(-6.5, -3.4, 13, 6.8);
    ctx.fill();
    ctx.fillStyle = "rgba(15,23,42,.35)"; ctx.fillRect(1.2, -2.5, 2.6, 5);
    ctx.restore();
  });
}