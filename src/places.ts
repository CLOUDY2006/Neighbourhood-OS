import type { Place } from "./mapdata";

/** How many society names the map may show at a zoom level. Zoomed out shows none, so the map stays calm. */
export const labelBudget = (k: number) => (k < 0.5 ? 0 : k < 0.7 ? 4 : k < 0.95 ? 8 : 14);

export interface Slot { p: Place; x: number; y: number; w: number; h: number }

/** Keep the most important labels that do not overlap. Slots come sorted by importance, centered at x and y. */
export function layoutPlaceLabels(slots: Slot[], limit: number): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    if (out.length >= limit) break;
    if (!out.some(o => Math.abs(o.x - s.x) * 2 < o.w + s.w && Math.abs(o.y - s.y) * 2 < o.h + s.h)) out.push(s);
  }
  return out;
}

/** The society closest to a point, or the closest area name when no society is near. Distances are in meters. */
export function nearestPlace(places: Place[] | undefined, x: number, y: number): { place: Place; dist: number } | null {
  if (!places?.length) return null;
  let best: { place: Place; dist: number } | null = null;
  for (const [kind, max] of [["society", 320], ["area", 800]] as const) {
    for (const p of places) {
      if (p.k !== kind) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= max && (!best || d < best.dist)) best = { place: p, dist: d };
    }
    if (best) return best;
  }
  return null;
}