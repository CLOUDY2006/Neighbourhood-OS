import http from "node:http";
import type { AddressInfo } from "node:net";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };

const way = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({ type: "way", id, tags, geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
const D = 0.0002;
const GOOD = { elements: [
  way(1, { highway: "residential", name: "Test Road" }, [[28.6, 77.0], [28.6005, 77.0005], [28.601, 77.001]]),
  way(2, { building: "yes", "building:levels": "4" }, [[28.6, 77.0], [28.6, 77.0 + D], [28.6 + D, 77.0 + D], [28.6 + D, 77.0], [28.6, 77.0]]),
  way(3, { building: "yes" }, [[28.601, 77.001], [28.601, 77.001 + D], [28.601 + D, 77.001 + D], [28.601 + D, 77.001], [28.601, 77.001]]),
  way(4, { leisure: "park" }, [[28.602, 77.002], [28.602, 77.0035], [28.6035, 77.0035], [28.6035, 77.002], [28.602, 77.002]]),
] };

const seen: string[] = [];
let plan: Record<string, () => { code: number; body: unknown; ms?: number }> = {};
const srv = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => (raw += c));
  req.on("end", () => {
    seen.push(`${req.url} ${req.headers["user-agent"] ?? ""}`.trim());
    const r = (plan[req.url ?? ""] ?? (() => ({ code: 404, body: {} })))();
    setTimeout(() => { if (!res.writableEnded) { res.writeHead(r.code, { "content-type": "application/json" }); res.end(JSON.stringify(r.body)); } }, r.ms ?? 0);
  });
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.OVERPASS_URL = `${base}/a, ${base}/b, ${base}/c`;
process.env.OVERPASS_GAP_MS = "10";
process.env.OVERPASS_HEDGE_MS = "150";
process.env.MAP_INNER_SHARE = "1"; // the older tests below expect a single request; the two-step download is tested at the end
process.env.CONTACT_EMAIL = "test@example.com";
const { fetchMap } = await import("../server/osm");

// 1. first server rate-limits, second answers 200 with a remark and no data, third works
plan = {
  "/a": () => ({ code: 429, body: {} }),
  "/b": () => ({ code: 200, body: { elements: [], remark: "runtime error: Query timed out" } }),
  "/c": () => ({ code: 200, body: GOOD }),
};
const m = await fetchMap(28.6, 77.0, 700);
check("servers are tried in order until one works", seen.map(s => s.split(" ")[0]).join(",") === "/a,/b,/c", seen.join(" | "));
check("the request identifies the app and a contact", seen.every(s => s.includes("NeighbourhoodOS/1.0 (test@example.com)")));
check("a 200 reply with a remark and no data is treated as a failure, not as empty", m.source === "osm" && m.roads.length === 1);
check("the road, two buildings and a park are read", m.roads.length === 1 && m.blds.length === 2 && m.areas.length === 1 && m.areas[0].k === "park", JSON.stringify({ r: m.roads.length, b: m.blds.length, a: m.areas.length }));
const heights = m.blds.map(b => b.h).sort((x, y) => x - y);
check("height comes from building:levels (4 levels is about 13 m)", heights.some(h => Math.abs(h - 13.2) < 0.01), JSON.stringify(heights));
check("a building with no height tag gets an estimate between 6 and 16 m", heights.some(h => h >= 6 && h <= 16 && Math.abs(h - 13.2) > 0.01));

// 2. the first server works: the others are never contacted
seen.length = 0;
plan = { "/a": () => ({ code: 200, body: GOOD }) };
await fetchMap(28.6, 77.0, 700);
check("when the first server works the others are not used", seen.length === 1 && seen[0].startsWith("/a"), seen.join(" | "));

// 3. every server fails: a clear error that names each one
seen.length = 0;
plan = { "/a": () => ({ code: 504, body: {} }), "/b": () => ({ code: 429, body: {} }), "/c": () => ({ code: 200, body: { elements: [], remark: "out of memory" } }) };
let err = "";
try { await fetchMap(28.6, 77.0, 700); } catch (e) { err = (e as Error).message; }
check("all servers failing throws a clear error listing each reason", /Overpass unavailable/.test(err) && /504/.test(err) && /429/.test(err) && /out of memory/.test(err), err.slice(0, 160));

// 4. a real empty answer (200, no remark, no elements) is genuinely "no data"
plan = { "/a": () => ({ code: 200, body: { elements: [] } }) };
const none = await fetchMap(28.6, 77.0, 700);
check("a normal empty answer means the area really has no mapped data", none.roads.length === 0 && none.blds.length === 0);

// 4b. the first server hangs: the next one is asked after a short wait and wins, instead of waiting for the first to time out
seen.length = 0;
plan = { "/a": () => ({ code: 200, body: GOOD, ms: 4000 }), "/b": () => ({ code: 200, body: GOOD }) };
const t0 = Date.now();
const slow = await fetchMap(28.6, 77.0, 700);
const took = Date.now() - t0;
check("a hanging first server does not hold up the map: the second one is asked and answers", slow.source === "osm" && seen.map(s => s.split(" ")[0]).join(",") === "/a,/b" && took < 2000, `(${took} ms, ${seen.map(s => s.split(" ")[0]).join(",")})`);
seen.length = 0;
plan = { "/a": () => ({ code: 200, body: GOOD, ms: 500 }), "/b": () => ({ code: 200, body: GOOD, ms: 5 }), "/c": () => ({ code: 200, body: GOOD }) };
await fetchMap(28.6, 77.0, 700);
check("the first server answering in time means the others are never asked", seen.map(s => s.split(" ")[0]).join(",").startsWith("/a") && !seen.some(s => s.startsWith("/c")), seen.map(s => s.split(" ")[0]).join(","));
seen.length = 0;
plan = { "/a": () => ({ code: 503, body: {} }), "/b": () => ({ code: 503, body: {} }), "/c": () => ({ code: 200, body: GOOD }) };
const t1 = Date.now(); await fetchMap(28.6, 77.0, 700);
check("servers that fail at once are skipped without waiting", Date.now() - t1 < 1000 && seen.length === 3, `(${Date.now() - t1} ms)`);

// 5. society and area names
const sq = (lat: number, lon: number, d: number): [number, number][] => [[lat, lon], [lat, lon + d], [lat + d, lon + d], [lat + d, lon], [lat, lon]];
const PLACES = { elements: [
  way(10, { highway: "residential", name: "Test Road" }, [[28.6, 77.0], [28.6005, 77.0005]]),
  way(11, { landuse: "residential", name: "Maple Residency" }, sq(28.6010, 77.0010, 0.002)),
  way(12, { landuse: "residential", name: "Maple Residency" }, sq(28.6050, 77.0050, 0.0004)),
  way(13, { building: "apartments", name: "Sunrise Heights", "name:en": "Sunrise Heights" }, sq(28.6000, 77.0030, 0.0003)),
  way(14, { building: "residential", name: "\u092e\u0947\u092a\u0932 \u0935\u093f\u0939\u093e\u0930", "name:en": "Maple Vihar" }, sq(28.6000, 77.0040, 0.0003)),
  way(15, { building: "residential", name: "\u0939\u0930\u093f\u092f\u093e\u0932\u0940 \u0938\u094b\u0938\u093e\u0907\u091f\u0940" }, sq(28.6000, 77.0050, 0.0003)),
  way(16, { building: "apartments", name: "Apartments" }, sq(28.6010, 77.0060, 0.0003)),
  way(17, { building: "apartments", name: "12" }, sq(28.6010, 77.0065, 0.0003)),
  way(18, { building: "apartments", name: "AB" }, sq(28.6010, 77.0070, 0.0003)),
  way(19, { building: "yes", name: "Some Shop" }, sq(28.6020, 77.0070, 0.0003)),
  way(20, { landuse: "residential", name: "Faraway Colony" }, sq(28.7000, 77.1000, 0.002)),
  way(21, { building: "apartments" }, sq(28.6020, 77.0080, 0.0003)),
  { type: "node", id: 30, lat: 28.6010, lon: 77.0020, tags: { place: "suburb", name: "Sector 12" } },
  { type: "node", id: 31, lat: 28.6010, lon: 77.0021, tags: { place: "village", name: "Not An Area" } },
] };
plan = { "/a": () => ({ code: 200, body: PLACES }) };
const pm = await fetchMap(28.6, 77.0, 700);
const byName = new Map((pm.places ?? []).map(p => [p.n, p]));
check("a named residential area becomes a society label", byName.get("Maple Residency")?.k === "society", JSON.stringify([...byName.keys()]));
check("the same name keeps only the larger one", (pm.places ?? []).filter(p => p.n === "Maple Residency").length === 1 && (byName.get("Maple Residency")?.s ?? 0) > 10000, String(byName.get("Maple Residency")?.s));
check("a residential area is a label only, not drawn as a park", pm.areas.length === 0);
check("a named apartment building gives a label and is still a building", byName.get("Sunrise Heights")?.k === "society" && pm.blds.length >= 4);
check("the English name is preferred over the local one", byName.has("Maple Vihar") && !(pm.places ?? []).some(p => p.n.includes("\u092e\u0947\u092a\u0932")));
check("a local-language name is kept when there is no English one", byName.has("\u0939\u0930\u093f\u092f\u093e\u0932\u0940 \u0938\u094b\u0938\u093e\u0907\u091f\u0940"));
check("generic, numeric, tiny and missing names are skipped", !byName.has("Apartments") && !byName.has("12") && !byName.has("AB") && !byName.has("Some Shop"));
check("a place far outside the radius is left out", !byName.has("Faraway Colony"));
check("a suburb node becomes an area name, a village node does not", byName.get("Sector 12")?.k === "area" && !byName.has("Not An Area"));
// 0.003 degrees of longitude at latitude 28.6 is about 293 m, plus half the 0.0003 wide building: about 308 m east. The building is just north of the center: about 17 m.
check("labels sit at the right place in meters from the center", Math.abs((byName.get("Sunrise Heights")?.x ?? 1e9) - 308) < 10 && Math.abs((byName.get("Sunrise Heights")?.y ?? 1e9) + 17) < 6, JSON.stringify(byName.get("Sunrise Heights")));
plan = { "/a": () => ({ code: 200, body: GOOD }) };
const plain = await fetchMap(28.6, 77.0, 700);
check("a map without any named places still has an empty list, not a missing one", Array.isArray(plain.places) && plain.places.length === 0);

// 6. MAP_NAMES=off: no names asked for, none returned, buildings and roads unchanged
const bodies: string[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => { if (init?.body) bodies.push(decodeURIComponent(String(init.body))); return origFetch(url, init); }) as typeof fetch;
plan = { "/a": () => ({ code: 200, body: PLACES }) };
const withNames = await fetchMap(28.6, 77.0, 700, true);
const noNames = await fetchMap(28.6, 77.0, 700, false);
globalThis.fetch = origFetch;
check("with names on, the request asks for residential areas and place names", /landuse"="residential"/.test(bodies[0] ?? "") && /place"~/.test(bodies[0] ?? ""));
check("with names off, the request leaves those parts out", !/landuse"="residential"/.test(bodies[1] ?? "") && !/place"~/.test(bodies[1] ?? ""), (bodies[1] ?? "").slice(0, 60));
check("with names off, no places come back but the same buildings and roads do", (noNames.places ?? []).length === 0 && Array.isArray(noNames.places) && noNames.blds.length === withNames.blds.length && noNames.roads.length === withNames.roads.length);

// 7. two-step download: inner buildings first, outer ones only when the area is sparse
const rds = Array.from({ length: 9 }, (_, i) => way(300 + i, { highway: "residential", name: "R" + i }, [[28.6 + i * 0.0002, 77.0], [28.6 + i * 0.0002, 77.002]]));
const blk = (id: number, i: number) => way(id, { building: "yes" }, sq(28.6 + (i % 40) * 0.00008, 77.0 + Math.floor(i / 40) * 0.00008, 0.0002));
const DENSE = { elements: [...rds, ...Array.from({ length: 1100 }, (_, i) => blk(1000 + i, i))] };
const qs: string[] = [];
const keep = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => { if (init?.body) qs.push(decodeURIComponent(String(init.body))); return keep(url, init); }) as typeof fetch;

seen.length = 0; qs.length = 0;
plan = { "/a": () => ({ code: 200, body: DENSE }) };
const dense = await fetchMap(28.6, 77.0, 700, true, 0.5);
check("a dense area needs only one request", seen.length === 1, `(${seen.length})`);
check("that request asks for buildings only within 350 m, not 700 m", /way\["building"\]\(around:350,/.test(qs[0] ?? "") && !/way\["building"\]\(around:700,/.test(qs[0] ?? ""), (qs[0] ?? "").slice(0, 40));
check("roads and parks are still asked for across the full 700 m", /highway"[^;]*\(around:700,/.test(qs[0] ?? ""));
check("the dense result keeps the 900 nearest buildings, as before", dense.blds.length === 900 && dense.roads.length === 9, `(${dense.blds.length} buildings)`);

seen.length = 0; qs.length = 0;
let call = 0;
const INNER = { elements: [...rds, blk(2000, 0), blk(2001, 50), blk(2002, 90)] };
const OUTER = { elements: [blk(2000, 0), blk(2001, 50), blk(2002, 90), blk(2003, 130), blk(2004, 170)] };
plan = { "/a": () => ({ code: 200, body: call++ === 0 ? INNER : OUTER }) };
const sparse = await fetchMap(28.6, 77.0, 700, true, 0.5);
check("a sparse area makes a second request for the outer buildings", seen.length === 2, `(${seen.length})`);
check("the second request asks for buildings only, out to the full 700 m", /way\["building"\]\(around:700,/.test(qs[1] ?? "") && !/highway/.test(qs[1] ?? ""), (qs[1] ?? "").slice(0, 60));
check("the sparse result has the roads from step one and all five buildings from step two", sparse.roads.length === 9 && sparse.blds.length === 5, `(${sparse.roads.length} roads, ${sparse.blds.length} buildings)`);

seen.length = 0; call = 0;
plan = { "/a": () => (call++ === 0 ? { code: 200, body: INNER } : { code: 503, body: {} }), "/b": () => ({ code: 503, body: {} }), "/c": () => ({ code: 503, body: {} }) };
const partial = await fetchMap(28.6, 77.0, 700, true, 0.5);
check("if the outer request fails, the inner buildings are still used and no error is thrown", partial.source === "osm" && partial.roads.length === 9 && partial.blds.length === 3, `(${partial.blds.length} buildings)`);

// the 35 second limit must not run while a request is only waiting in line behind another one
globalThis.fetch = keep;
const hostTag = `127.0.0.1:${(srv.address() as AddressInfo).port}`;
plan = { "/a": () => ({ code: 504, body: {} }), "/b": () => ({ code: 504, body: {} }), "/c": () => ({ code: 504, body: {} }) };
let allFail = ""; try { await fetchMap(28.6, 77.0, 700, true, 1); } catch (e) { allFail = (e as Error).message; }
check("every failure names its server", (allFail.match(new RegExp(hostTag.replace(/\./g, "\\."), "g")) ?? []).length === 3, allFail.slice(0, 120));

srv.close();
if (bad) { console.log(`\n${bad} map data test(s) failed`); process.exit(1); }
console.log("\nall map data tests passed");
process.exit(0);