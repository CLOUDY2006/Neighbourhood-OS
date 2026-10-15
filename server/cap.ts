import { XMLParser } from "fast-xml-parser";
import { dist } from "../src/logic";
import type { Alert, HazardType, Sev } from "../src/world";

const UA = `NeighborhoodOS/1.0 (${process.env.CONTACT_EMAIL || "contact not set"})`;
const FEEDS = (process.env.CAP_FEEDS || "").split(",").map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
export const capFeedCount = () => FEEDS.length;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, trimValues: true });
const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const SEV: Record<string, Sev> = { extreme: "severe", severe: "warning", moderate: "watch", minor: "info" };

export interface Cap { id: string; sender: string; event: string; headline: string; sev: Sev; sent: number; expires: number; area: string; instruction: string; url?: string; polys: [number, number][][]; circles: { lat: number; lng: number; km: number }[] }

const poly = (t: string): [number, number][] => t.trim().split(/\s+/).map(p => p.split(",").map(Number)).filter(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]] as [number, number]);
const circle = (t: string) => { const [c, r] = t.trim().split(/\s+/), [la, lo] = (c ?? "").split(",").map(Number); const km = Number(r); return Number.isFinite(la) && Number.isFinite(lo) && Number.isFinite(km) ? { lat: la, lng: lo, km } : null; };
const text = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");

export function parseCap(xml: string): Cap[] {
  const j = parser.parse(xml), out: Cap[] = [];
  for (const al of arr<any>(j.alert)) {
    if (!al || text(al.status) !== "Actual" || text(al.msgType) === "Cancel") continue;
    const info = arr<any>(al.info)[0];
    if (!info) continue;
    const sent = Date.parse(text(al.sent)) || Date.now(), expires = Date.parse(text(info.expires)) || sent + 86400000;
    const areas = arr<any>(info.area);
    out.push({
      id: text(al.identifier), sender: text(al.sender), event: text(info.event), headline: text(info.headline) || text(info.event),
      sev: SEV[text(info.severity).toLowerCase()] ?? "info", sent, expires, area: areas.map(a => text(a.areaDesc)).filter(Boolean).join("; ").slice(0, 160),
      instruction: text(info.instruction).slice(0, 400), url: text(info.web) || undefined,
      polys: areas.flatMap(a => arr<string>(a.polygon).map(poly)).filter(p => p.length >= 3),
      circles: areas.flatMap(a => arr<string>(a.circle).map(circle)).filter((c): c is NonNullable<typeof c> => !!c),
    });
  }
  return out.filter(c => c.id);
}

async function get(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function readFeed(url: string): Promise<Cap[]> {
  const xml = await get(url), j = parser.parse(xml);
  if (j.alert) return parseCap(xml);
  const links: string[] = [];
  for (const e of arr<any>(j.feed?.entry)) { const l = arr<any>(e.link).map(x => x?.["@_href"]).find(h => typeof h === "string"); if (l) links.push(l); }
  for (const i of arr<any>(j.rss?.channel?.item)) { const l = text(i.link) || text(i.guid); if (/^https?:\/\//.test(l)) links.push(l); }
  const out: Cap[] = [];
  for (let k = 0; k < Math.min(links.length, 40); k += 4) {
    const rs = await Promise.allSettled(links.slice(k, k + 4).map(async l => parseCap(await get(l))));
    rs.forEach(r => { if (r.status === "fulfilled") out.push(...r.value); });
  }
  return out;
}

let snap: { at: number; alerts: Cap[] } = { at: 0, alerts: [] }, inflight: Promise<Cap[]> | null = null;
export function getCap(): Promise<Cap[]> {
  if (!FEEDS.length) return Promise.resolve([]);
  if (Date.now() - snap.at < 300000) return Promise.resolve(snap.alerts);
  if (!inflight) inflight = (async () => {
    const rs = await Promise.allSettled(FEEDS.map(readFeed)), all: Cap[] = [];
    rs.forEach((r, i) => { if (r.status === "fulfilled") all.push(...r.value); else console.warn(`CAP feed failed (${FEEDS[i]}):`, (r.reason as Error).message); });
    const seen = new Set<string>();
    snap = { at: Date.now(), alerts: all.filter(a => a.expires > Date.now() && !seen.has(a.id) && seen.add(a.id)) };
    return snap.alerts;
  })().finally(() => { inflight = null; });
  return inflight;
}
export function capSnapshot(): Cap[] { if (FEEDS.length && Date.now() - snap.at > 300000) void getCap(); return snap.alerts; }

const inside = (lat: number, lng: number, p: [number, number][]) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i], [yj, xj] = p[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const kind = (e: string): HazardType => { const t = e.toLowerCase(); return /flood|rain/.test(t) ? "flood" : /cyclone|storm|wind|thunder|hail|lightning/.test(t) ? "storm" : /fire/.test(t) ? "wildfire" : /earthquake|tsunami/.test(t) ? "earthquake" : /volcan/.test(t) ? "volcano" : "other"; };

export function capAlertsFor(caps: Cap[], c: { lat: number; lng: number }, rMeters: number): Alert[] {
  const now = Date.now();
  return caps.filter(a => a.expires > now && (a.polys.some(p => inside(c.lat, c.lng, p) || p.some(v => dist(c, { lat: v[0], lng: v[1] }) <= rMeters)) || a.circles.some(k => dist(c, k) <= k.km * 1000 + rMeters)))
    .map(a => ({ id: `cap:${a.id}`.slice(0, 120), src: "CAP" as const, type: kind(a.event), title: a.headline.slice(0, 120), lat: c.lat, lng: c.lng, sev: a.sev, time: a.sent, url: a.url, km: 0, radiusKm: 0, instruction: a.instruction, area: a.area }));
}
