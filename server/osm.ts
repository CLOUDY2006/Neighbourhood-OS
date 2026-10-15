const UA = `NeighborhoodOS/1.0 (${process.env.CONTACT_EMAIL || "contact not set"})`;
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";

let chain: Promise<unknown> = Promise.resolve();
function queue<T>(fn: () => Promise<T>, gap = 1100): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.then(() => new Promise(r => setTimeout(r, gap)), () => new Promise(r => setTimeout(r, gap)));
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

export async function fetchMap(lat: number, lng: number, r: number) {
  const q = `[out:json][timeout:30];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"](around:${r},${lat},${lng});way["building"](around:${r},${lat},${lng});way["leisure"~"^(park|garden|playground|pitch)$"](around:${r},${lat},${lng});way["natural"="water"](around:${r},${lat},${lng});way["landuse"~"^(grass|recreation_ground|forest)$"](around:${r},${lat},${lng}););out geom;`;
  const res = await queue(() => fetch(OVERPASS, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(45000) }), 2000);
  if (!res.ok) throw new Error(`Overpass responded with ${res.status}`);
  const els: any[] = ((await res.json()) as any).elements ?? [];
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const pr = (g: { lat: number; lon: number }): Pt => [Math.round((g.lon - lng) * kx), Math.round((lat - g.lat) * ky)];
  const roads: { c: number; p: number[]; n?: string }[] = [], blds: { p: number[]; h: number; d: number }[] = [], areas: { k: "park" | "water"; p: number[] }[] = [];
  for (const e of els) {
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
      if (t.building) {
        if (a < 25) continue;
        let h = parseFloat(String(t.height ?? "")); if (!isFinite(h)) { const lv = parseFloat(String(t["building:levels"] ?? "")); h = isFinite(lv) ? lv * 3.3 : 6 + (Number(e.id) % 11); }
        const s = simplify([...ring, ring[0]], 1.5).slice(0, -1);
        blds.push({ p: flat(s.length >= 3 ? s : ring), h: Math.max(4, Math.min(120, h)), d });
      } else if (a > 200) {
        areas.push({ k: t.natural === "water" ? "water" : "park", p: flat(simplify([...ring, ring[0]], 2).slice(0, -1)) });
      }
    }
  }
  roads.sort((a, b) => a.c - b.c);
  const b2 = blds.sort((a, b) => a.d - b.d).slice(0, 900).map(({ p, h }) => ({ p, h }));
  return { source: "osm" as const, r, sparse: b2.length < 15, roads: roads.slice(0, 2000), blds: b2, areas: areas.slice(0, 150) };
}
