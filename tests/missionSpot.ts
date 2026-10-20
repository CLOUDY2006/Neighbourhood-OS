import assert from "node:assert/strict";
import { emptyDoc, missionSpot, reduce, type Doc } from "../src/logic";

const bounds = { lat: 28.6, lng: 77.0, r: 500 };
const as = (d: Doc, role: "admin" | "resident" | "volunteer", name: string, a: any) => reduce(d, { role, name }, a, bounds).doc;

// A standalone mission keeps the spot the coordinator marked
let d = as(emptyDoc(), "admin", "A #1", { t: "mission", title: "Park cleanup", need: 5, lat: 28.6012345, lng: 77.0009876 });
const m = d.missions[0];
assert.deepEqual(missionSpot(d, m), { lat: 28.60123, lng: 77.00099 });

// A spot outside the neighbourhood is refused
assert.throws(() => as(emptyDoc(), "admin", "A #1", { t: "mission", title: "Far away", need: 3, lat: 29.5, lng: 77.0 }), /outside/);
// Only one coordinate is refused too
assert.throws(() => as(emptyDoc(), "admin", "A #1", { t: "mission", title: "Half", need: 3, lat: 28.6 }));

// A mission linked to a report uses that report's location
d = as(emptyDoc(), "resident", "R #1", { t: "report", title: "Garbage pile", desc: "x", cat: "garbage", priority: "high", lat: 28.601, lng: 77.002 });
d = as(d, "admin", "A #1", { t: "mission", title: "Clear garbage", need: 4, issueId: d.issues[0].id });
assert.deepEqual(missionSpot(d, d.missions[0]), { lat: 28.601, lng: 77.002 });

// Old missions with no location still work and simply have no spot
const old = { id: "m0", title: "Old", need: 2, joined: [], hours: 0, done: false };
assert.equal(missionSpot(emptyDoc(), old), null);

// Joining a located mission still works as before
d = as(emptyDoc(), "admin", "A #1", { t: "mission", title: "Tree planting", need: 2, lat: 28.6, lng: 77.0 });
d = as(d, "volunteer", "V #1", { t: "join", mid: d.missions[0].id });
assert.deepEqual(d.missions[0].joined, ["V #1"]);
console.log("mission location: all checks passed");