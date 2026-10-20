import type { HazardType, Sev, WorldEvent } from "../src/world";
import { SEV_RANK } from "../src/world";

const UA = `NeighbourhoodOS/1.0 (${process.env.CONTACT_EMAIL || "contact not set"})`;
export interface Snapshot { events: WorldEvent[]; sources: { name: string; ok: boolean; n: number }[]; updated: number }

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);

async function usgs(): Promise<WorldEvent[]> {
  const d = await getJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
  if (!Array.isArray(d.features)) throw new Error("unexpected format");
  const out: WorldEvent[] = [];
  for (const f of d.features) {
    const c = f.geometry?.coordinates, m = f.properties?.mag;
    if (!Array.isArray(c) || !ok(c[0]) || !ok(c[1]) || !ok(m)) continue;
    out.push({ id: `usgs:${f.id}`, src: "USGS", type: "earthquake", title: `M${m.toFixed(1)} ${String(f.properties.place ?? "earthquake").slice(0, 80)}`, lat: c[1], lng: c[0], sev: m >= 7 ? "severe" : m >= 6 ? "warning" : m >= 5 ? "watch" : "info", time: Number(f.properties.time) || Date.now(), url: typeof f.properties.url === "string" ? f.properties.url : undefined, mag: m });
  }
  return out;
}

const EONET: Record<string, HazardType> = { wildfires: "wildfire", floods: "flood", severeStorms: "storm", volcanoes: "volcano", landslides: "other" };
async function eonet(): Promise<WorldEvent[]> {
  const d = await getJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10&limit=300");
  if (!Array.isArray(d.events)) throw new Error("unexpected format");
  const out: WorldEvent[] = [];
  for (const e of d.events) {
    const type = EONET[e.categories?.[0]?.id];
    const g = [...(e.geometry ?? [])].reverse().find((x: any) => x?.type === "Point" && Array.isArray(x.coordinates));
    if (!type || !g || !ok(g.coordinates[0]) || !ok(g.coordinates[1])) continue;
    out.push({ id: `eonet:${e.id}`, src: "NASA EONET", type, title: String(e.title ?? "Event").slice(0, 90), lat: g.coordinates[1], lng: g.coordinates[0], sev: "watch", time: Date.parse(g.date) || Date.now(), url: typeof e.sources?.[0]?.url === "string" ? e.sources[0].url : undefined });
  }
  return out;
}

const GD: Record<string, HazardType> = { TC: "storm", FL: "flood", VO: "volcano", WF: "wildfire" };
async function gdacs(): Promise<WorldEvent[]> {
  // GDACS now documents the SEARCH address with dates and alert levels. The older MAP address is kept as a fallback.
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const urls = [`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;VO;WF&fromdate=${day(14)}&todate=${day(-1)}&alertlevel=green;orange;red`, "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP"];
  let d: any, last: unknown;
  for (const u of urls) {
    try { const j = await getJson(u); if (Array.isArray(j?.features)) { d = j; break; } last = new Error("unexpected format"); } catch (e) { last = e; }
  }
  if (!d) throw last instanceof Error ? last : new Error("unexpected format");
  const out: WorldEvent[] = [], seen = new Set<string>();
  for (const f of d.features) {
    const p = f.properties ?? {}, type = GD[p.eventtype], c = f.geometry?.coordinates;
    if (!type || f.geometry?.type !== "Point" || !Array.isArray(c) || !ok(c[0]) || !ok(c[1]) || p.iscurrent === "false") continue;
    const key = `${p.eventtype}${p.eventid}`; if (seen.has(key)) continue; seen.add(key);
    const lvl = String(p.alertlevel ?? "").toLowerCase();
    out.push({ id: `gdacs:${key}`, src: "GDACS", type, title: String(p.name || p.eventname || p.description || "Alert").slice(0, 90), lat: c[1], lng: c[0], sev: lvl === "red" ? "severe" : lvl === "orange" ? "warning" : "info", time: Date.parse(p.fromdate) || Date.now(), url: typeof p.url?.report === "string" ? p.url.report : undefined });
  }
  return out;
}

const JOBS: [string, () => Promise<WorldEvent[]>][] = [["USGS", usgs], ["NASA EONET", eonet], ["GDACS", gdacs]];
const bySrc: Record<string, WorldEvent[]> = {};
let snap: Snapshot = { events: [], sources: [], updated: 0 }, inflight: Promise<Snapshot> | null = null;

async function refresh(): Promise<Snapshot> {
  const res = await Promise.allSettled(JOBS.map(([, f]) => f()));
  const sources = res.map((r, i) => {
    const name = JOBS[i][0];
    if (r.status === "fulfilled") bySrc[name] = r.value; else console.warn(`World feed ${name} failed:`, (r.reason as Error).message);
    return { name, ok: r.status === "fulfilled", n: bySrc[name]?.length ?? 0 };
  });
  const events = Object.values(bySrc).flat().sort((a, b) => SEV_RANK[b.sev as Sev] - SEV_RANK[a.sev as Sev] || b.time - a.time).slice(0, 700);
  const anyOk = sources.some(s => s.ok);
  snap = { events, sources, updated: anyOk ? Date.now() : Date.now() - 540000 };
  return snap;
}
export function getWorld(): Promise<Snapshot> {
  if (Date.now() - snap.updated < 600000) return Promise.resolve(snap);
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  return inflight;
}
export function worldSnapshot(): Snapshot { if (Date.now() - snap.updated > 600000) void getWorld(); return snap; }