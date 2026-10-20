/** The link used in complaint drafts and by the "Open location" button: a pin on OpenStreetMap, zoomed in close. */
export const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=18/${lat.toFixed(6)}/${lng.toFixed(6)}`;

export const CELL = 0.009;
export const CELL_R = 700;
export interface LL { lat: number; lng: number }

export function cellFromRC(row: number, col: number) {
  const clat = (row + 0.5) * CELL, step = CELL / Math.cos((clat * Math.PI) / 180);
  return { id: `c:${row}:${col}`, lat: clat, lng: (col + 0.5) * step };
}
export function cellOf(lat: number, lng: number) {
  const row = Math.floor(lat / CELL), step = CELL / Math.cos(((row + 0.5) * CELL * Math.PI) / 180);
  return cellFromRC(row, Math.floor(lng / step));
}
export function parseCell(id: string) {
  const m = /^c:(-?\d{1,5}):(-?\d{1,7})$/.exec(id);
  if (!m) return null;
  const row = Number(m[1]);
  if (Math.abs(row) > 10000) return null;
  return cellFromRC(row, Number(m[2]));
}
export function neighborsOf(c: LL) {
  const step = CELL / Math.cos((c.lat * Math.PI) / 180), out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) out.push(cellOf(c.lat + dr * CELL, c.lng + dc * step));
  return out;
}

const M_LAT = 110540;
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
export const toXY = (c: LL, lat: number, lng: number) => ({ x: (lng - c.lng) * mLng(c.lat), y: (c.lat - lat) * M_LAT });
export const fromXY = (c: LL, x: number, y: number) => ({ lat: c.lat - y / M_LAT, lng: c.lng + x / mLng(c.lat) });