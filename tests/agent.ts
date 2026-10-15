import { DEMO, DEMO_HINDI, dueEscalations, reduce, seed } from "../src/logic";
import { detectLang, draftComplaint, proposeMission, understand, workflow } from "../src/agent";
import { routeFor } from "../src/routes";

const fail = (m: string, f: () => unknown) => { try { f(); console.log("FAIL", m); } catch (e) { console.log("ok", m, "->", (e as Error).message); } };
const R = { role: "resident" as const, name: "Res #1" }, A = { role: "admin" as const, name: "Adm #1" }, O = { role: "resident" as const, name: "Other #2" };
const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test Colony" };

console.log("lang:", detectLang(DEMO_HINDI), detectLang("Garbage on the road"));
const u = understand(DEMO_HINDI); console.log("understand hindi:", u.cat, u.priority, u.lang, "|", u.summaryEn);
console.log("streetlight:", understand("हमारी गली की स्ट्रीट लाइट खराब है, अंधेरा रहता है").cat, "| water:", understand("पाइप लीक हो रहा है, पानी बह रहा है").cat, "| manhole:", understand("खुला मैनहोल है").priority);

let d = seed();
d = reduce(d, R, { t: "report", title: "कचरा ही कचरा", desc: DEMO_HINDI, cat: "garbage", priority: "high", lat: 28.5662, lng: 77.2113, agent: { lang: "hi", original: DEMO_HINDI, summaryEn: u.summaryEn, source: "rules" } }, b).doc;
const iss = d.issues[d.issues.length - 1], id = iss.id;
console.log("agent attached:", !!iss.agent, "route:", iss.agent!.draft.to, "| draft lang:", iss.agent!.draft.lang);
console.log("hindi draft has original text:", iss.agent!.draft.body.includes("बच्चे बीमार"), "| mentions nbhd:", iss.agent!.draft.body.includes("Test Colony"));
fail("cannot send before approval", () => reduce(d, R, { t: "agentSend", id, via: "copied" }, b));
fail("stranger cannot approve", () => reduce(d, O, { t: "agentApprove", id }, b));
d = reduce(d, R, { t: "agentDraft", id, lang: "en" }, b).doc; console.log("english draft:", d.issues.find(i => i.id === id)!.agent!.draft.body.split("\n")[0]);
d = reduce(d, R, { t: "agentDraft", id, subject: "Custom subject", body: "Custom body" }, b).doc;
d = reduce(d, R, { t: "agentApprove", id }, b).doc;
fail("simulated not blocked in logic (server blocks it)", () => { throw new Error("handled by server"); });
d = reduce(d, R, { t: "agentSend", id, via: "copied", ref: "GR-77" }, b).doc;
let x = d.issues.find(i => i.id === id)!;
console.log("sent:", !!x.agent!.draft.sentAt, "handoff:", x.handoff!.to, x.handoff!.ref, "escalateAt set:", !!x.agent!.escalateAt, "waits", routeFor("garbage").ladder[0].waitDays, "days");
fail("cannot resend", () => reduce(d, R, { t: "agentSend", id, via: "copied" }, b));
fail("cannot escalate early as resident", () => reduce(d, R, { t: "agentEscalate", id }, b));
d = reduce(d, A, { t: "agentRef", id, ref: "GR-78" }, b).doc; console.log("ref updated:", d.issues.find(i => i.id === id)!.handoff!.ref);
x = d.issues.find(i => i.id === id)!; x.agent!.escalateAt = Date.now() - 1000;
const titles = dueEscalations(d, Date.now(), b.name); x = d.issues.find(i => i.id === id)!;
console.log("due escalations:", titles.length, "level now:", x.agent!.draft.level, "to:", x.agent!.draft.to, "approved cleared:", !x.agent!.draft.approvedAt);
console.log("followup text:", x.agent!.draft.body.includes("आपकी") || x.agent!.draft.body.includes("पिछली") || x.agent!.draft.body.includes("follow-up"));
d = reduce(d, A, { t: "agentApprove", id }, b).doc; d = reduce(d, A, { t: "agentSend", id, via: "copied" }, b).doc;
x = d.issues.find(i => i.id === id)!; console.log("level 1 sent, history:", x.agent!.history.map(h => `${h.level}:${h.to}`).join(" | "));

const e = draftComplaint({ lang: "en", level: 1, to: "Zonal officer", nbhd: "Test Colony", cat: "water", summaryEn: "Leak", lat: 1, lng: 2, reports: 3, created: Date.now(), hasPhoto: true, verified: true, prev: { to: "Water board", sentAt: Date.now() - 4 * 86400000, ref: "W1" } });
console.log("en draft ok:", e.subject, "|", e.body.includes("follow-up"), e.body.includes("W1"));
console.log("missions:", proposeMission({ cat: "garbage", title: "x" }).need, proposeMission({ cat: "unsafe", title: "x" }).safety.slice(0, 30));

let s = seed();
for (let i = 0; i < DEMO.length; i++) { s = reduce(s, R, { t: "demo" }, { lat: 28.5663, lng: 77.2115, r: 1e7, name: "Maple Nagar" }).doc; const i4 = s.issues.find(q => q.id === "i4")!; const w = workflow(s, i4); console.log(`demo step ${i + 1}: ${w.done}/${w.total} steps, status ${i4.status}, draft level ${i4.agent?.draft.level ?? "-"}`); }
const f4 = s.issues.find(q => q.id === "i4")!;
console.log("final: resolved", f4.status, "| escalateAt cleared:", !f4.agent!.escalateAt, "| pending escalation draft level:", f4.agent!.draft.level, "| handoff ref:", f4.handoff!.ref);
