import { CELL_R, cellOf, fromXY } from "../src/geo";
import { fmtDist, hereInfo } from "../src/here";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };

const c = { lat: 28.5972, lng: 77.0386 };
const same = hereInfo(c.lat, c.lng, c, 700);
check("standing at the center is inside with ~0 m distance", same.inside && same.dist < 1, `(${same.dist.toFixed(2)} m)`);

const p300 = fromXY(c, 300, 0), p300i = hereInfo(p300.lat, p300.lng, c, 700);
check("a point 300 m east is inside a 700 m area", p300i.inside && Math.abs(p300i.dist - 300) < 2, `(${p300i.dist.toFixed(1)} m)`);

const p900 = fromXY(c, 0, 900), p900i = hereInfo(p900.lat, p900.lng, c, 700);
check("a point 900 m south is outside a 700 m area", !p900i.inside && Math.abs(p900i.dist - 900) < 2, `(${p900i.dist.toFixed(1)} m)`);

const far = hereInfo(28.7041, 77.1025, c, 700);
check("a point in another part of Delhi is outside and 10+ km away", !far.inside && far.dist > 10000, `(${fmtDist(far.dist)})`);

check("distance labels", fmtDist(42) === "40 m" && fmtDist(5) === "10 m" && fmtDist(640) === "640 m" && fmtDist(1240) === "1.2 km" && fmtDist(12400) === "12 km", `(${fmtDist(42)}, ${fmtDist(1240)}, ${fmtDist(12400)})`);

// Privacy: "Open my area" only sends the cell id. It must not reveal the exact spot.
const exact = { lat: 28.59721234, lng: 77.03861234 }, cell = cellOf(exact.lat, exact.lng);
check("area code has a fixed format with no coordinates", /^c:-?\d+:-?\d+$/.test(cell.id), `(${cell.id})`);
check("the area center is not the exact spot, and the spot is within the cell radius", (cell.lat !== exact.lat || cell.lng !== exact.lng) && hereInfo(exact.lat, exact.lng, cell, CELL_R).inside);
check("two spots in the same cell give the same code", cellOf(exact.lat + 0.0001, exact.lng + 0.0001).id === cell.id);

if (bad) { console.log(`${bad} location test(s) failed`); process.exitCode = 1; } else console.log("all location tests passed");