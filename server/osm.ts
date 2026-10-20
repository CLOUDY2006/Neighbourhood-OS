const UA = `NeighbourhoodOS/1.0 (${process.env.CONTACT_EMAIL || "contact not set"})`;
// Several public servers, tried in order. The main overpass-api.de server is often overloaded, so it goes last. For more reliability add a free NextGIS key (see the README).
const OVERPASS_LIST = (process.env.OVERPASS_URL || "https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter").split(",").map(x => x.trim()).filter(Boolean);
const GAP = Number(process.env.OVERPASS_GAP_MS ?? 1500);
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";

let chain: Promise<unknown> = Promise.resolve();
const chains = new Map<string, Promise<unknown>>();
/** Runs requests for one key (a server address) one at a time with a pause between them. Different keys do not wait for each other. */
function queue<T>(fn: () => Promise<T>, gap = 1100, key = "default"): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  chains.set(key, p.then(() => new Promise(r => setTimeout(r, gap)), () => new Promise(r => setTimeout(r, gap))));
  return p;
}

const cache = new Map<string, { at: number; v: unknown }>();
const remember = <T>(k: string, v: T) => { cache.set(k, { at: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string); return v; };
const recall = <T>(k: string): T | undefined => { const c = cache.get(k); return c && Date.now() - c.at < 3600000 ? (c.v as T) : undefined; };

export async function geocode(q: string) {
  const key = "g:" + q.toLowerCase();
  const hit = recall<{ name: string; lat: number; lng: number }[]>(key);
  if (hit) return hit;
  const r = await queue(() => fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) }));
  if (!r.ok) throw new Error("Place search is unavailable right now");
  const j: any[] = await r.json();
  return remember(key, j.map(x => ({ name: String(x.display_name), lat: Number(x.lat), lng: Number(x.lon) })));
}

export async function placeName(lat: number, lng: number) {
  const fallback = `Area near ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  try {
    const r = await queue(() => fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(5000) }));
    if (!r.ok) return fallback;
    const a = ((await r.json()) as any).address ?? {};
    const n = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || a.city;
    return n ? `${String(n).slice(0, 50)} area` : fallback;
  } catch { return fallback; }
}

/** City and state for a point, used only to look up the right official website. Never includes the exact spot. */
export async function cityOf(lat: number, lng: number): Promise<string> {
  const key = `c:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = recall<string>(key);
  if (hit !== undefined) return hit;
  try {
    const r = await queue(() => fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lng}`, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(5000) }));
    if (!r.ok) return "";
    const a = ((await r.json()) as any).address ?? {};
    const city = String(a.city || a.town || a.municipality || a.county || a.state_district || "").slice(0, 60);
    const state = String(a.state || "").slice(0, 60);
    return remember(key, [city, state].filter(Boolean).join(", "));
  } catch { return ""; }
}

type Pt = [number, number];
const HW: Record<string, number> = { motorway: 0, trunk: 0, primary: 0, secondary: 1, tertiary: 1, unclassified: 2, residential: 2, living_street: 2, service: 3, pedestrian: 3 };

function simplify(p: Pt[], tol: number): Pt[] {
  if (p.length < 3) return p;
  const keep = new Array(p.length).fill(false); keep[0] = keep[p.length - 1] = true;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = p[i], [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l)) : 0;
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
const area = (p: Pt[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
const flat = (p: Pt[]) => p.flatMap(q => q);

const HEDGE_MS = Number(process.env.OVERPASS_HEDGE_MS ?? 8000);
const isAbort = (e: unknown) => (e as Error)?.name === "AbortError" || /abort/i.test((e as Error)?.message ?? "");
async function overpassOne(url: string, q: string, signal: AbortSignal): Promise<any[]> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const j = await queue(async () => {
    // The 35 second limit starts when the request really starts, not while it waits in line behind another one.
    const t = new AbortController(), link = () => t.abort();
    if (signal.aborted) throw new Error("aborted");
    signal.addEventListener("abort", link);
    const timer = setTimeout(() => t.abort(), 35000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q), signal: t.signal });
      if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
      return (await res.json()) as any;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", link); }
  }, GAP, url).catch(e => {
    if (String((e as Error).message).startsWith(host)) throw e;
    throw new Error(`${host} ${isAbort(e) ? "gave no answer in time" : e instanceof SyntaxError ? "sent an unreadable reply" : (e as Error).message}`);
  });
  const els: any[] = Array.isArray(j?.elements) ? j.elements : [];
  // A busy server can answer 200 with an empty list and a remark instead of an error. That is a failure, not "no data".
  if (!els.length && typeof j?.remark === "string") throw new Error(`${host} ${String(j.remark).slice(0, 80)}`);
  return els;
}

/**
 * Ask the servers in order. If one fails, the next starts at once. If one is merely slow, the next also starts after a few
 * seconds and the first answer wins, so a hanging server no longer holds up the map.
 */
async function overpass(q: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const errors: string[] = [], ctrls: AbortController[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    let started = 0, pending = 0, done = false;
    const finish = (fn: () => void) => { if (done) return; done = true; timers.forEach(clearTimeout); ctrls.forEach(c => c.abort()); fn(); };
    const next = () => {
      if (done || started >= OVERPASS_LIST.length) return;
      const url = OVERPASS_LIST[started++], c = new AbortController(); ctrls.push(c);
      let settled = false; pending++;
      const hedge = setTimeout(() => { if (!settled) next(); }, HEDGE_MS); timers.push(hedge);
      overpassOne(url, q, c.signal).then(els => finish(() => resolve(els)), e => { if (!done) errors.push((e as Error).message); }).finally(() => {
        settled = true; clearTimeout(hedge); pending--;
        if (done) return;
        if (started < OVERPASS_LIST.length) next();
        else if (pending === 0) finish(() => reject(new Error(`Overpass unavailable (${errors.join("; ")})`)));
      });
    };
    next();
  });
}

export interface Place { n: string; x: number; y: number; k: "society" | "area"; s: number }
const SOCIETY_BUILDING = /^(apartments|residential|dormitory)$/;
const GENERIC_NAME = /^(residential|apartments?|building|house|colony|society|sector|block|park|school)$/i;
/** A name worth showing on the map: English if the map has it, else the local name. Drops numbers, symbols and bare generic words. */
export function mapLabel(t: Record<string, unknown>): string {
  const n = String(t["name:en"] || t.name || "").replace(/\s+/g, " ").trim();
  if (n.length < 3 || /^[\p{N}\p{P}\p{S}\s]+$/u.test(n) || GENERIC_NAME.test(n)) return "";
  return n.slice(0, 36);
}

/** Set MAP_NAMES=off to skip society and area names: a slightly lighter download and no labels, like the first version of the map. */
export const NAMES_ON = (process.env.MAP_NAMES ?? "on").trim().toLowerCase() !== "off";
const nameQuery = (r: number, lat: number, lng: number) =>
  `way["landuse"="residential"]["name"](around:${r},${lat},${lng});node["place"~"^(neighbourhood|quarter|suburb)$"]["name"](around:${r},${lat},${lng});`;

const BLD_CAP = 900;
const BLD_INNER = Math.min(1, Math.max(0.2, Number(process.env.MAP_INNER_SHARE ?? 0.5) || 0.5)); // first ask only for buildings this share of the radius from the center. 1 turns the two-step download off

/**
 * The map keeps the 900 buildings nearest the center. In a dense area they all sit well inside the radius, so first ask for the
 * buildings in the inner half only (about a quarter of the data). If that gives enough, we are done and the result is the same
 * as before. If the area is sparse, the outer buildings are asked for in a second, small request.
 */
async function overpassElements(lat: number, lng: number, r: number, names: boolean, innerShare: number): Promise<any[]> {
  const around = (rr: number) => `(around:${rr},${lat},${lng})`;
  const rest = `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"]${around(r)};way["leisure"~"^(park|garden|playground|pitch)$"]${around(r)};way["natural"="water"]${around(r)};way["landuse"~"^(grass|recreation_ground|forest)$"]${around(r)};${names ? nameQuery(r, lat, lng) : ""}`;
  const run = (body: string) => overpass(`[out:json][timeout:30];(${body});out geom qt;`);
  const inner = innerShare >= 1 ? r : Math.max(150, Math.round(r * innerShare));
  const first = await run(`${rest}way["building"]${around(inner)};`);
  const buildings = first.filter(e => e?.tags?.building).length;
  if (inner >= r || buildings >= BLD_CAP * 1.15) return first;
  try {
    const full = await run(`way["building"]${around(r)};`);
    return [...first.filter(e => !e?.tags?.building), ...full];
  } catch (e) {
    console.warn("Outer buildings not loaded, using the inner ones:", (e as Error).message);
    return first;
  }
}

export async function fetchMap(lat: number, lng: number, r: number, names: boolean = NAMES_ON, innerShare: number = BLD_INNER) {
  const els = await overpassElements(lat, lng, r, names, innerShare);
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const pr = (g: { lat: number; lon: number }): Pt => [Math.round((g.lon - lng) * kx), Math.round((lat - g.lat) * ky)];
  const roads: { c: number; p: number[]; n?: string }[] = [], blds: { p: number[]; h: number; d: number }[] = [], areas: { k: "park" | "water"; p: number[] }[] = [];
  const named = new Map<string, Place>();
  const addPlace = (t: Record<string, unknown>, x: number, y: number, k: Place["k"], s: number) => {
    const n = names ? mapLabel(t) : ""; if (!n) return;
    const key = n.toLowerCase(), old = named.get(key);
    if (!old || s > old.s) named.set(key, { n, x: Math.round(x), y: Math.round(y), k, s: Math.round(s) });
  };
  for (const e of els) {
    if (e.type === "node") {
      if (typeof e.lat === "number" && typeof e.lon === "number" && /^(neighbourhood|quarter|suburb)$/.test(String(e.tags?.place ?? ""))) {
        const [x, y] = pr({ lat: e.lat, lon: e.lon });
        if (Math.hypot(x, y) <= r * 1.1) addPlace(e.tags, x, y, "area", 0);
      }
      continue;
    }
    if (e.type !== "way" || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    const t = e.tags ?? {}, raw: Pt[] = [];
    for (const g of e.geometry) { const q2 = pr(g); const l = raw[raw.length - 1]; if (!l || l[0] !== q2[0] || l[1] !== q2[1]) raw.push(q2); }
    if (t.highway && t.highway in HW) {
      let run: Pt[] = [];
      const flush = () => { if (run.length >= 2) { const s = simplify(run, 2); roads.push({ c: HW[t.highway], p: flat(s), n: t.name ? String(t.name).slice(0, 40) : undefined }); } run = []; };
      for (const q2 of raw) { if (Math.hypot(q2[0], q2[1]) <= r * 1.3) run.push(q2); else flush(); }
      flush();
    } else {
      let ring = raw;
      if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
      if (ring.length < 3) continue;
      const a = area(ring), cx = ring.reduce((s, q2) => s + q2[0], 0) / ring.length, cy = ring.reduce((s, q2) => s + q2[1], 0) / ring.length, d = Math.hypot(cx, cy);
      if (d > r * 1.1) continue;
      if (t.landuse === "residential") { addPlace(t, cx, cy, "society", a); continue; }
      if (t.building) {
        if (a < 25) continue;
        let h = parseFloat(String(t.height ?? "")); if (!isFinite(h)) { const lv = parseFloat(String(t["building:levels"] ?? "")); h = isFinite(lv) ? lv * 3.3 : 6 + (Number(e.id) % 11); }
        const s = simplify([...ring, ring[0]], 1.5).slice(0, -1);
        blds.push({ p: flat(s.length >= 3 ? s : ring), h: Math.max(4, Math.min(120, h)), d });
        if (SOCIETY_BUILDING.test(String(t.building))) addPlace(t, cx, cy, "society", a);
      } else if (a > 200) {
        areas.push({ k: t.natural === "water" ? "water" : "park", p: flat(simplify([...ring, ring[0]], 2).slice(0, -1)) });
      }
    }
  }
  roads.sort((a, b) => a.c - b.c);
  const b2 = blds.sort((a, b) => a.d - b.d).slice(0, BLD_CAP).map(({ p, h }) => ({ p, h }));
  const all = [...named.values()].sort((a, b) => b.s - a.s);
  const places = [...all.filter(p => p.k === "society").slice(0, 50), ...all.filter(p => p.k === "area").slice(0, 10)];
  return { source: "osm" as const, r, sparse: b2.length < 15, roads: roads.slice(0, 2000), blds: b2, areas: areas.slice(0, 150), places };
}