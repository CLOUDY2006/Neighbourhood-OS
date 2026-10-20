import { genCity, type Place } from "../src/mapdata";
import { labelBudget, layoutPlaceLabels, nearestPlace, type Slot } from "../src/places";
import { osmLink } from "../src/geo";
import { draftComplaint } from "../src/agent";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };

const soc = (n: string, x: number, y: number, s = 1000): Place => ({ n, x, y, k: "society", s });
const area = (n: string, x: number, y: number): Place => ({ n, x, y, k: "area", s: 0 });

check("zoomed out shows no names", labelBudget(0.3) === 0 && labelBudget(0.49) === 0);
check("the budget grows with zoom", labelBudget(0.6) === 4 && labelBudget(0.85) === 8 && labelBudget(1.2) === 14);

const slot = (name: string, x: number, y: number, w = 80, h = 16): Slot => ({ p: soc(name, 0, 0), x, y, w, h });
const kept = layoutPlaceLabels([slot("A", 0, 0), slot("B", 40, 4), slot("C", 200, 0), slot("D", 0, 60)], 10).map(s => s.p.n).join("");
check("overlapping labels are dropped and the more important one stays", kept === "ACD", kept);
check("touching edges do not count as overlap", layoutPlaceLabels([slot("A", 0, 0), slot("B", 80, 0)], 10).length === 2);
check("the limit is respected", layoutPlaceLabels([slot("A", 0, 0), slot("B", 300, 0), slot("C", 600, 0)], 2).length === 2);
check("an empty list is fine", layoutPlaceLabels([], 5).length === 0);

const ps = [soc("Near Soc", 100, 0), soc("Far Soc", 900, 0), area("Sector 9", 20, 0)];
check("the nearest society wins", nearestPlace(ps, 90, 0)?.place.n === "Near Soc");
check("a society is preferred over a closer area name", nearestPlace(ps, 30, 0)?.place.n === "Near Soc");
check("when no society is near, the area name is used", nearestPlace([soc("Far Soc", 900, 0), area("Sector 9", 20, 0)], 0, 0)?.place.n === "Sector 9");
check("nothing is returned when everything is far away", nearestPlace([soc("Far Soc", 5000, 0), area("Far Area", 5000, 0)], 0, 0) === null);
check("no places means no answer", nearestPlace(undefined, 0, 0) === null && nearestPlace([], 0, 0) === null);

const g = genCity(650), g2 = genCity(650);
check("the demo city has a few made-up society names", (g.places?.length ?? 0) >= 3, JSON.stringify(g.places?.map(p => p.n)));
check("the demo names are the same every time", JSON.stringify(g.places) === JSON.stringify(g2.places));
check("the demo names sit inside the map", (g.places ?? []).every(p => Math.abs(p.x) < 650 && Math.abs(p.y) < 650));
const small = genCity(300);
check("a smaller demo map scales the names with it", (small.places ?? []).every(p => Math.abs(p.x) < 300 && Math.abs(p.y) < 300));

// the "Open location in OpenStreetMap" button uses the same link as the complaint draft
check("the location link has the pin and a close zoom", osmLink(28.5921, 77.046) === "https://www.openstreetmap.org/?mlat=28.592100&mlon=77.046000#map=18/28.592100/77.046000", osmLink(28.5921, 77.046));
const drafted = draftComplaint({ lang: "en", level: 1, to: "Municipal office", nbhd: "Test Colony", cat: "pothole", summaryEn: "Pothole near the gate", lat: 28.5921, lng: 77.046, reports: 2, created: Date.now(), hasPhoto: false, verified: false });
check("the complaint draft contains exactly that link", drafted.body.includes(osmLink(28.5921, 77.046)));
check("negative coordinates and rounding are handled", osmLink(-33.8688, 151.2093).includes("mlat=-33.868800&mlon=151.209300"));

if (bad) { console.log(`\n${bad} place test(s) failed`); process.exit(1); }
console.log("\nall place tests passed");