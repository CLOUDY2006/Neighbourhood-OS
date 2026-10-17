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
let plan: Record<string, () => { code: number; body: unknown }> = {};
const srv = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => (raw += c));
  req.on("end", () => {
    seen.push(`${req.url} ${req.headers["user-agent"] ?? ""}`.trim());
    const r = (plan[req.url ?? ""] ?? (() => ({ code: 404, body: {} })))();
    res.writeHead(r.code, { "content-type": "application/json" }); res.end(JSON.stringify(r.body));
  });
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.OVERPASS_URL = `${base}/a, ${base}/b, ${base}/c`;
process.env.OVERPASS_GAP_MS = "10";
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
check("the request identifies the app and a contact", seen.every(s => s.includes("NeighborhoodOS/1.0 (test@example.com)")));
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

srv.close();
if (bad) { console.log(`\n${bad} map data test(s) failed`); process.exit(1); }
console.log("\nall map data tests passed");
process.exit(0);