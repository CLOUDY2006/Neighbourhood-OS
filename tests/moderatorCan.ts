import { CAN, DEMO, can, emptyDoc, reduce, seed, type Action, type Role } from "../src/logic";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const throws = (m: string, f: () => unknown, part: string) => { try { f(); bad++; console.log("FAIL", m, "(no error)"); } catch (e) { const t = (e as Error).message; const ok = t.includes(part); if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, ok ? "" : `-> ${t}`); } };

const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test" };
const M = { role: "moderator" as const, name: "Mod #1" }, A = { role: "admin" as const, name: "Adm #1" }, R = { role: "resident" as const, name: "Res #1" }, V = { role: "volunteer" as const, name: "Vol #1" };

// ---- the table: a moderator can do everything a neighbour can, except the resident-only "flag" and the volunteer-only jobs
const everyday: Action["t"][] = ["report", "merge", "sos", "sosCancel", "checkinReply", "careSet", "careRemove", "shareAdd", "shareClaim", "shareMsg", "shareDone", "shareRemove", "agentStart", "agentDraft", "agentApprove", "agentSend", "agentRef", "withdraw", "spam", "reporterConfirm", "feedback", "update", "demo", "reset"];
check("a moderator may do every everyday action", everyday.every(t => can("moderator", t)), everyday.filter(t => !can("moderator", t)).join(","));
check("every role that could do those before still can", everyday.every(t => can("resident", t) && can("volunteer", t) && can("admin", t)));
const adminOnly = (Object.keys(CAN) as Action["t"][]).filter(t => CAN[t].length === 1 && CAN[t][0] === "admin");
check("admin-only actions are still admin-only (none gained the moderator)", adminOnly.length > 10 && adminOnly.every(t => !can("moderator", t)), adminOnly.join(","));
check("review powers are unchanged: moderators verify, approve, reject, hide, restore and close", (["verify", "approveResolution", "rejectResolution", "hide", "restore", "closeUnconfirmed"] as const).every(t => can("moderator", t)));
check("volunteer-only jobs are still not moderator jobs", !can("moderator", "join") && !can("moderator", "availability") && !can("moderator", "skills") && !can("moderator", "abilities") && !can("moderator", "proof"));
check("resident-only flag is unchanged", CAN.flag.length === 1 && CAN.flag[0] === "resident");

// ---- the reducer lets a moderator do them
let d = emptyDoc();
d = reduce(d, M, { t: "report", title: "Pothole on Main Street", desc: "deep pothole", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 }, b).doc;
check("a moderator can report a problem", d.issues.length === 1 && d.issues[0].author === "Mod #1");
const id = d.issues[0].id;
d = reduce(d, R, { t: "merge", id }, b).doc;
check("a moderator's report can be confirmed by a neighbour like any other", d.issues[0].reports === 2);
const mine = reduce(d, M, { t: "withdraw", id }, b).doc;
check("a moderator can withdraw their own report (it is hidden)", mine.issues[0].hidden === true && d.issues[0].hidden !== true);
throws("but not someone else's", () => reduce(d, { role: "moderator" as const, name: "Mod #2" }, { t: "withdraw", id }, b), "");
const s1 = reduce(emptyDoc(), M, { t: "sos", need: "medical" as never, people: 1, note: "test", lat: 28.567, lng: 77.212, consent: true }, b);
check("a moderator can send an SOS", (s1.doc.sos ?? []).length === 1);
let c = reduce(emptyDoc(), A, { t: "checkinStart", title: "Are you safe?" }, b).doc;
c = reduce(c, M, { t: "checkinReply", ok: true }, b).doc;
check("a moderator can answer a safety check-in", c.checkin?.replies?.["Mod #1"]?.ok === true);

// ---- the demo works with the Role menu on Moderator
let demo = seed();
for (let i = 0; i < DEMO.length; i++) demo = reduce(demo, M, { t: "demo" }, b).doc;
check("Run next step works as a moderator all the way to the end", demo.demo === DEMO.length, `(${demo.demo} of ${DEMO.length})`);
check("Reset demo works as a moderator", reduce(demo, M, { t: "reset" }, b).doc.demo === 0);
throws("the demo stops at the end for a moderator too", () => reduce(demo, M, { t: "demo" }, b), "Demo finished");

// ---- what a moderator still cannot do
const adminOnlyChecks: [string, Action][] = [
  ["advance a report", { t: "advance", id }], ["assign a volunteer", { t: "assign", mid: "x", name: "y" }], ["create a mission", { t: "mission", title: "x", need: 3 }],
  ["post a notice", { t: "noticeAdd", title: "x", body: "y", urgent: false, pinned: false }], ["start a check-in", { t: "checkinStart", title: "x" }],
  ["join a mission", { t: "join", mid: "x" }], ["add proof", { t: "proof", id, text: "x" }],
];
for (const [what, act] of adminOnlyChecks) throws(`a moderator still cannot ${what}`, () => reduce(d, M, act, b), "not allowed");

if (bad) { console.log(`\n${bad} moderator test(s) failed`); process.exit(1); }
console.log("\nall moderator tests passed");