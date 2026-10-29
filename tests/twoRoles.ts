import { CAN, can, emptyDoc, purgeSafety, purgeSos, reduce, visibleSos, type Doc } from "../src/logic";
import { hazardsNear, type WorldEvent } from "../src/world";
import { ROOMS, canModerateChat, roomsFor } from "../src/chat";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const throws = (m: string, f: () => unknown, part = "") => { try { f(); bad++; console.log("FAIL", m, "(did not throw)"); } catch (e) { const hit = !part || (e as Error).message.includes(part); if (!hit) bad++; console.log(hit ? "ok" : "FAIL", m, "-", (e as Error).message); } };

const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test" };
const R = { role: "resident" as const, name: "Res #1" }, R2 = { role: "resident" as const, name: "Res #2" };
const A = { role: "admin" as const, name: "Adm #1" }, A2 = { role: "admin" as const, name: "Adm #2" };
const step = (d: Doc, w: typeof R | typeof A, a: Parameters<typeof reduce>[2]) => reduce(d, w, a, b).doc;
const get = (d: Doc, id: string) => d.issues.find(i => i.id === id)!;

// ---- permission table: only resident and admin may do anything
const used = new Set(Object.values(CAN).flat());
check("only resident and admin appear in the permission table", [...used].every(r => r === "resident" || r === "admin"), [...used].join(","));
for (const t of ["mission", "join", "assign", "availability", "skills", "shareAdd", "addResource", "delivery", "checkinStart", "careSet", "actionPlanApprove", "volunteerArea"] as const)
  check(`removed action is off for everyone: ${t}`, !can("resident", t) && !can("admin", t));

// ---- the flow that is left: report -> confirm -> verify -> advance with proof -> second coordinator approves
let d = step(emptyDoc(), R, { t: "report", title: "Pothole on Main Road", desc: "big hole", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 });
const id = d.issues[0].id;
d = step(d, R2, { t: "merge", id });
check("resident cannot verify", !can("resident", "verify"));
d = step(d, A, { t: "verify", id, v: "verified" });
check("one coordinator is not enough to verify", get(d, id).verif !== "verified", get(d, id).verif);
throws("the same coordinator cannot verify twice", () => step(d, A, { t: "verify", id, v: "verified" }), "different coordinator");
d = step(d, A2, { t: "verify", id, v: "verified" });
check("a second, different coordinator verifies", get(d, id).verif === "verified");

// ---- fake reports: only coordinators flag, and two different coordinators delete it completely
check("residents can no longer flag spam", !can("resident", "spam") && can("admin", "spam"));
let sp = step(emptyDoc(), R, { t: "report", title: "Fake", desc: "x", cat: "garbage", priority: "low", lat: 28.567, lng: 77.212 });
const sid = sp.issues[0].id;
sp = step(sp, A, { t: "spam", id: sid });
check("one coordinator flag does not remove a report", get(sp, sid).hidden !== true && sp.issues.length === 1);
throws("the same coordinator cannot flag twice", () => step(sp, A, { t: "spam", id: sid }), "already flagged");
sp = step(sp, A2, { t: "spam", id: sid });
check("two coordinators delete it completely", sp.issues.length === 0 && !sp.issues.some(i => i.id === sid));
check("the author is told it was removed", sp.events.some(e => e.to === "Res #1" && e.text.includes("removed")));
throws("a removed report cannot be restored", () => step(sp, A, { t: "restore", id: sid }), "not found");
for (let n = 0; n < 6 && get(d, id).status !== "pending"; n++) {
  if (get(d, id).status === "progress" && !get(d, id).proof.length) d = step(d, A, { t: "proof", id, text: "filled the hole" });
  d = step(d, A, { t: "advance", id });
}
check("coordinator alone can move a report to pending with proof, no mission needed", get(d, id).status === "pending" && d.missions.length === 0, get(d, id).status);
throws("the coordinator who submitted cannot approve their own fix", () => step(d, A, { t: "approveResolution", id }), "different reviewer");
const approved = step(d, A2, { t: "approveResolution", id });
check("a different coordinator can approve", get(approved, id).status === "resolved");
const confirmed = step(d, R, { t: "reporterConfirm", id, ok: true });
check("or the reporter can confirm", get(confirmed, id).status === "resolved", get(confirmed, id).status);

// ---- notices still work for coordinators only
check("coordinator can post a notice", can("admin", "noticeAdd") && !can("resident", "noticeAdd"));

// ---- chat: two rooms
check("chat has exactly two rooms: all, coordinators", ROOMS.map(r => r.id).join(",") === "all,coordinators");
check("resident sees only the neighbourhood room", roomsFor("resident").map(r => r.id).join(",") === "all");
check("coordinator sees both rooms", roomsFor("admin").map(r => r.id).join(",") === "all,coordinators");
check("only a coordinator can moderate chat", canModerateChat("admin", "all") && !canModerateChat("resident", "all"));

// ---- SOS: everyone can send one and everyone sees it. Only a coordinator closes it, and closing wipes the location
const sosA = { t: "sos" as const, need: "medical" as const, people: 2, note: "2nd floor, water rising", lat: 28.567, lng: 77.212, consent: true };
throws("an SOS needs the sender's consent", () => step(emptyDoc(), R, { ...sosA, consent: false }), "agree");
const sosDoc = step(emptyDoc(), R, sosA), sosId = sosDoc.sos![0].id;
check("a resident can send an SOS", sosDoc.sos!.length === 1 && sosDoc.sos![0].lat === 28.567);
check("every member sees every SOS, with its location", visibleSos(sosDoc).length === 1 && visibleSos(sosDoc)[0].lat === 28.567);
throws("only one active SOS per person", () => step(sosDoc, R, sosA), "already have");
throws("a resident cannot close someone else's SOS", () => step(sosDoc, R2, { t: "sosStatus", id: sosId, status: "helped" }), "not allowed");
const sosAckd = step(sosDoc, A, { t: "sosAck", id: sosId });
check("a coordinator can acknowledge it", sosAckd.sos![0].status === "acknowledged");
const sosHelped = step(sosAckd, A, { t: "sosStatus", id: sosId, status: "helped" });
check("closing it deletes the location and the note", sosHelped.sos![0].lat === null && sosHelped.sos![0].note === "" && sosHelped.sos![0].status === "helped");
const sosCancelled = step(sosDoc, R, { t: "sosCancel", id: sosId });
check("the author can cancel it, and the location is deleted", sosCancelled.sos![0].status === "closed" && sosCancelled.sos![0].lat === null);
throws("another resident cannot cancel it", () => step(sosDoc, R2, { t: "sosCancel", id: sosId }), "author");
const sosOld = structuredClone(sosDoc); sosOld.sos![0].expires = Date.now() - 1;
check("an SOS closes itself after 24 hours and loses its location", purgeSos(sosOld) && sosOld.sos![0].status === "closed" && sosOld.sos![0].lat === null);

// ---- world hazards: only those within 100 km count
const homePt = { lat: 28.5663, lng: 77.2115 };
const mkQuake = (id: string, dLat: number, ago: number): WorldEvent => ({ id, src: "USGS", type: "earthquake", title: "M6 mkQuake", lat: homePt.lat + dLat, lng: homePt.lng, sev: "warning", time: Date.now() - ago * 3600000, mag: 6 });
const nearEv = hazardsNear([mkQuake("close", 0.4, 1), mkQuake("far", 1.5, 1), mkQuake("sosOld", 0.4, 100)], homePt);
check("only a recent hazard within 100 km counts", nearEv.length === 1 && nearEv[0].id === "close" && nearEv[0].km <= 100, nearEv.map(n => `${n.id}:${n.km}km`).join(","));

// ---- safety plans: only while a hazard is within 100 km, and a different coordinator approves
const hazard = { id: "close", title: "M6 mkQuake", type: "earthquake", km: 44 };
const planA = { t: "safetyPlan" as const, hazard: hazard, routes: "Leave by Main Street. Avoid the river road.", assembly: "Community Hall car park", contacts: "Ward office 0000", notes: "Water, torch, documents" };
check("a resident cannot write or approve a safety plan", !can("resident", "safetyPlan") && !can("resident", "safetyApprove"));
throws("no plan when the hazard is farther than 100 km", () => step(emptyDoc(), A, { ...planA, hazard: { ...hazard, km: 140 } }), "100 km");
throws("a plan needs escape routes", () => step(emptyDoc(), A, { ...planA, routes: "" }), "required");
const planDoc0 = step(emptyDoc(), A, planA), planId = planDoc0.safety![0].id;
check("a new plan is pending", planDoc0.safety![0].status === "pending" && planDoc0.safety![0].by === "Adm #1");
throws("the author cannot approve their own plan", () => step(planDoc0, A, { t: "safetyApprove", id: planId }), "different coordinator");
throws("only one open plan per hazard", () => step(planDoc0, A2, planA), "already a plan");
const planDoc1 = step(planDoc0, A2, { t: "safetyApprove", id: planId });
check("a different coordinator can approve it", planDoc1.safety![0].status === "approved" && planDoc1.safety![0].approvedBy === "Adm #2");
const planBack = step(planDoc0, A2, { t: "safetyReject", id: planId, reason: "add a second route" });
check("a different coordinator can send it back", planBack.safety![0].status === "closed" && !!planBack.safety![0].closedNote?.includes("add a second route"));
check("a coordinator can close an approved plan", step(planDoc1, A, { t: "safetyClose", id: planId }).safety![0].status === "closed");
const planAged = structuredClone(planDoc1); planAged.safety![0].approvedAt = Date.now() - 8 * 86400000;
check("an approved plan closes itself after 7 days", purgeSafety(planAged) && planAged.safety![0].status === "closed");
const planStale = structuredClone(planDoc0); planStale.safety![0].created = Date.now() - 4 * 86400000;
check("a plan nobody approves closes after 3 days", purgeSafety(planStale) && planStale.safety![0].status === "closed");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);