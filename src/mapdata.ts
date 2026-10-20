export interface Place { n: string; x: number; y: number; k: "society" | "area"; s: number }

export interface MapData {
  source: "osm" | "generated"; r: number; sparse?: boolean;
  roads: { c: number; p: number[]; n?: string }[];
  blds: { p: number[]; h: number }[];
  areas: { k: "park" | "water"; p: number[] }[];
  /** Named societies and area names from OpenStreetMap. Missing on maps saved before names were added. */
  places?: Place[];
}

const rng = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function genCity(r = 650): MapData {
  const rnd = rng(11), U = 50, f = r / 650;
  const roads: MapData["roads"] = [], blds: MapData["blds"] = [], areas: MapData["areas"] = [], parks = new Set<string>();
  const hn: Record<number, string> = { 1: "Elm Street", 2: "Lakeview Rd", 3: "Main Street" }, vn: Record<number, string> = { 2: "Park Lane", 4: "Market Road" };
  for (let j = 0; j < 6; j++) { const y = (j * 4 - 10) * U; roads.push({ c: j === 0 || j === 5 ? 2 : 1, p: [-600, y, 600, y], n: hn[j] }); }
  for (let i = 0; i < 7; i++) { const x = (i * 4 - 12) * U; roads.push({ c: i === 0 || i === 6 ? 2 : 1, p: [x, -500, x, 500], n: vn[i] }); }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
    const bx = (i * 4 + 0.75 - 12) * U, by = (j * 4 + 0.75 - 10) * U;
    if (rnd() < 0.13) { areas.push({ k: "park", p: [bx, by, bx + 130, by, bx + 130, by + 130, bx, by + 130] }); parks.add(`${i},${j}`); continue; }
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      if (rnd() < 0.1) continue;
      const x = bx + a * 70, y = by + b * 70;
      blds.push({ p: [x, y, x + 60, y, x + 60, y + 60, x, y + 60], h: 14 + rnd() * 46 + (rnd() < 0.12 ? 40 : 0) });
    }
  }
  const sc = (p: number[]) => p.map(v => Math.round(v * f));
  // Made-up society names so the demo shows how names look. They are simulated, like the rest of this city.
  const SOC: [number, number, string][] = [[1, 1, "Maple Residency"], [3, 1, "Lakeview Heights"], [2, 3, "Green Park Society"], [4, 3, "Sunrise Apartments"], [0, 2, "Orchard Court"]];
  const places: Place[] = SOC.filter(([i, j]) => !parks.has(`${i},${j}`)).map(([i, j, n]) => ({ n, x: Math.round(((i * 4 + 0.75 - 12) * U + 65) * f), y: Math.round(((j * 4 + 0.75 - 10) * U + 65) * f), k: "society" as const, s: 20000 - i * 100 - j }));
  return { source: "generated", r, roads: roads.map(x => ({ ...x, p: sc(x.p) })), blds: blds.map(x => ({ ...x, p: sc(x.p) })), areas: areas.map(x => ({ ...x, p: sc(x.p) })), places };
}