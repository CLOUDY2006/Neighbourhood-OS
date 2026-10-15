import { DEMO, reduce, seed, emptyDoc, visibleSos, purgeSos, nearestResource } from "../src/logic";
import { alertsFor, isOfficial, simulatedAlert } from "../src/world";
const b = { lat: 28.5663, lng: 77.2115, r: 700 };
const R = { role: "resident" as const, name: "Res #1" }, V = { role: "volunteer" as const, name: "Asha K. (demo)" }, A = { role: "admin" as const, name: "Adm #1" };
let d = seed();
const sosAct = { t: "sos" as const, need: "medical" as const, people: 2, note: "help", lat: 28.567, lng: 77.212, consent: true };
try { reduce(d, R, { ...sosAct, consent: false }, b); console.log("FAIL consent"); } catch (e) { console.log("ok consent:", (e as Error).message); }
try { reduce(d, R, { ...sosAct, lat: 30, lng: 77 }, b); console.log("FAIL bounds"); } catch (e) { console.log("ok bounds:", (e as Error).message); }
d = reduce(d, R, sosAct, b).doc; const id = d.sos![0].id;
try { reduce(d, R, sosAct, b); console.log("FAIL dup"); } catch (e) { console.log("ok one active:", (e as Error).message); }
console.log("visible to other resident:", visibleSos(d, "resident", "Other").length, "| to author:", visibleSos(d, "resident", R.name).length, "| admin:", visibleSos(d, "admin", A.name).length);
console.log("nearest shelter/aid:", nearestResource(d, { lat: 28.567, lng: 77.212 }, ["shelter", "aid"])?.r.name);
try { reduce(d, V, { t: "sosStatus", id, status: "helped" }); console.log("FAIL unassigned vol"); } catch (e) { console.log("ok unassigned volunteer blocked:", (e as Error).message); }
d = reduce(d, A, { t: "sosAck", id }).doc; d = reduce(d, A, { t: "sosAssign", id, name: V.name }).doc;
console.log("visible to assigned volunteer:", visibleSos(d, "volunteer", V.name).length);
d = reduce(d, V, { t: "sosStatus", id, status: "helped" }).doc;
const x = d.sos![0]; console.log("after helped:", x.status, "lat:", x.lat, "note:", JSON.stringify(x.note));
d = reduce(d, R, sosAct, b).doc; const id2 = d.sos![1].id;
d.sos![1].expires = Date.now() - 1000; console.log("purge changed:", purgeSos(d), d.sos![1].status, d.sos![1].lat);
d = reduce(d, R, sosAct, b).doc; d = reduce(d, R, { t: "sosCancel", id: d.sos!.find(s => s.status === "open")!.id }).doc; console.log("cancel ok");
const al = alertsFor([{ id: "e", src: "USGS", type: "earthquake", title: "M6.4", lat: 29.0, lng: 77.0, sev: "warning", time: Date.now() - 600000, mag: 6.4 }, { id: "f", src: "USGS", type: "earthquake", title: "M6.4 far", lat: -30, lng: 100, sev: "warning", time: Date.now(), mag: 6.4 }, { id: "g", src: "USGS", type: "earthquake", title: "M5.2 near", lat: 28.6, lng: 77.2, sev: "watch", time: Date.now() - 4 * 86400000, mag: 5.2 }], b);
console.log("alerts:", al.map(a => `${a.title} ${a.km}km`), "official:", isOfficial(al), "| sim:", simulatedAlert(b).km, "km");
