import { dist, SAFETY_KM } from "./logic";

export type HazardType = "earthquake" | "wildfire" | "flood" | "storm" | "volcano" | "other";
export type Sev = "info" | "watch" | "warning" | "severe";
export interface WorldEvent { id: string; src: "USGS" | "NASA EONET" | "GDACS" | "Simulated" | "CAP"; type: HazardType; title: string; lat: number; lng: number; sev: Sev; time: number; url?: string; mag?: number; instruction?: string; area?: string }
export interface Alert extends WorldEvent { km: number; radiusKm: number }

export const SEV_RANK: Record<Sev, number> = { info: 0, watch: 1, warning: 2, severe: 3 };
export const HAZARD_COLOR: Record<HazardType, string> = { earthquake: "#ef4444", wildfire: "#f97316", flood: "#3b82f6", storm: "#0ea5c6", volcano: "#d946ef", other: "#64748b" };

export function radiusKm(e: WorldEvent) {
  switch (e.type) {
    case "earthquake": return (e.mag ?? 0) >= 7 ? 300 : (e.mag ?? 0) >= 6 ? 150 : (e.mag ?? 0) >= 5 ? 50 : 0;
    case "wildfire": return 25;
    case "flood": return 100;
    case "storm": return 150;
    case "volcano": return 50;
    default: return 50;
  }
}

export function alertsFor(events: WorldEvent[], c: { lat: number; lng: number }): Alert[] {
  const now = Date.now();
  return events
    .map(e => ({ ...e, km: Math.round(dist(c, e) / 1000), radiusKm: radiusKm(e) }))
    .filter(a => a.radiusKm > 0 && a.km <= a.radiusKm && SEV_RANK[a.sev] >= 1 && now - a.time < (a.type === "earthquake" ? 3 : 14) * 86400000)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || a.km - b.km)
    .slice(0, 5);
}
/** Hazards within 100 km (and recent enough to matter). Coordinators can write a safety plan only while one of these exists. */
export function hazardsNear(events: WorldEvent[], c: { lat: number; lng: number }, km = SAFETY_KM): Alert[] {
  const now = Date.now();
  return events
    .map(e => ({ ...e, km: Math.round(dist(c, e) / 1000), radiusKm: km }))
    .filter(a => a.km <= km && SEV_RANK[a.sev] >= 1 && now - a.time < (a.type === "earthquake" ? 3 : 14) * 86400000)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || a.km - b.km);
}
export const isOfficial = (al: Alert[]) => al.some(a => SEV_RANK[a.sev] >= 2);

export function demoWorld(): WorldEvent[] {
  const t = Date.now(), ev = (id: string, type: HazardType, title: string, lat: number, lng: number, sev: Sev, ago: number, mag?: number): WorldEvent => ({ id, src: "Simulated", type, title: `${title} (simulated)`, lat, lng, sev, time: t - ago * 60000, mag });
  return [
    ev("w1", "earthquake", "M6.8 earthquake", 36.2, 138.2, "warning", 90, 6.8), ev("w2", "wildfire", "Wildfire", 37.6, -120.4, "watch", 600),
    ev("w3", "storm", "Tropical cyclone", 15.2, 125.9, "warning", 300), ev("w4", "flood", "River flooding", 23.8, 90.4, "watch", 1200),
    ev("w5", "volcano", "Volcanic activity", -7.5, 110.4, "watch", 2000), ev("w6", "earthquake", "M5.2 earthquake", -33.4, -70.6, "watch", 200, 5.2),
    ev("w7", "wildfire", "Wildfire", -31.9, 116.0, "watch", 900), ev("w8", "flood", "Flash floods", 51.5, 7.4, "info", 500),
  ];
}
export function simulatedAlert(c: { lat: number; lng: number }): Alert {
  const e: WorldEvent = { id: "sim-eq", src: "Simulated", type: "earthquake", title: "M6.4 earthquake (SIMULATED)", lat: c.lat + 0.35, lng: c.lng - 0.15, sev: "warning", time: Date.now() - 12 * 60000, mag: 6.4 };
  return { ...e, km: Math.round(dist(c, e) / 1000), radiusKm: 150 };
}