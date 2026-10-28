import { CAN, can, emptyDoc, reduce, type Doc } from "../src/logic";
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
for (const t of ["mission", "join", "assign", "sos", "sosAck", "availability", "skills", "shareAdd", "addResource", "delivery", "checkinStart", "careSet", "actionPlanApprove", "volunteerArea"] as const)
  check(`removed action is off for everyone: ${t}`, !can("resident", t) && !can("admin", t));

// ---- the flow that is left: report -> confirm -> verify -> advance with proof -> second coordinator approves
let d = step(emptyDoc(), R, { t: "report", title: "Pothole on Main Road", desc: "big hole", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 });
const id = d.issues[0].id;
d = step(d, R2, { t: "merge", id });
check("resident cannot verify", !can("resident", "verify"));
d = step(d, A, { t: "verify", id, v: "verified" });
check("coordinator verified", get(d, id).verif === "verified");
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

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);