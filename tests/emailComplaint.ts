import { emptyDoc, isEmail, reduce, type Doc } from "../src/logic";
import { buildComplaintEmail, osmUrl } from "../src/complaintMail";
import { gmailUrl, mailtoUrl, MAILTO_MAX } from "../src/complaintMail";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const throws = (m: string, f: () => unknown, part = "") => { try { f(); bad++; console.log("FAIL", m, "(did not throw)"); } catch (e) { const hit = !part || (e as Error).message.includes(part); if (!hit) bad++; console.log(hit ? "ok" : "FAIL", m, "-", (e as Error).message); } };

const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test Nagar" };
const R = { role: "resident" as const, name: "Res #1" }, A = { role: "admin" as const, name: "Adm #1" }, A2 = { role: "admin" as const, name: "Adm #2" };
const step = (d: Doc, w: typeof R | typeof A, a: Parameters<typeof reduce>[2]) => reduce(d, w, a, b).doc;

// ---- address check
for (const ok of ["ward@mcd.gov.in", "a.b+c@dept.nic.in"]) check(`valid address: ${ok}`, isEmail(ok));
for (const no of ["", "no-at-sign", "a@b", "a b@c.in", "x@y.in, z@y.in", "<x@y.in>", 5, undefined]) check(`invalid address: ${String(no)}`, !isEmail(no));

// ---- a report with an approved draft
let d = step(emptyDoc(), R, { t: "report", title: "Pothole on Main Road", desc: "big hole", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 });
const id = d.issues[0].id;
d = step(d, R, { t: "agentStart", id, lang: "en", original: "big hole", summaryEn: "A large pothole on Main Road", source: "rules" });
const get = () => d.issues.find(i => i.id === id)!;

throws("cannot send before approval", () => step(d, A, { t: "agentSend", id, via: "emailed", emailTo: "ward@mcd.gov.in" }), "Approve");
d = step(d, A, { t: "agentApprove", id });
throws("a resident cannot record an emailed complaint", () => step(d, R, { t: "agentSend", id, via: "emailed", emailTo: "ward@mcd.gov.in" }), "coordinator");
throws("an emailed complaint needs a valid address", () => step(d, A, { t: "agentSend", id, via: "emailed", emailTo: "not-an-email" }), "valid email");
d = step(d, A, { t: "agentSend", id, via: "emailed", ref: "GR-9", emailTo: "ward@mcd.gov.in" });
check("recorded as emailed with the address", get().agent!.draft.via === "emailed" && get().agent!.draft.emailedTo === "ward@mcd.gov.in");
check("the hand-off keeps the address and reference", get().handoff?.email === "ward@mcd.gov.in" && get().handoff?.ref === "GR-9" && get().handoff?.status === "sent");
check("the log says it was emailed", get().log.some(l => l.text.includes("emailed to ward@mcd.gov.in")));
throws("cannot send the same complaint twice", () => step(d, A2, { t: "agentSend", id, via: "emailed", emailTo: "ward@mcd.gov.in" }), "already sent");

// ---- recording the authority's reply
throws("a resident cannot record a reply", () => reduce(d, R, { t: "agentReply", id, text: "hi" }, b), "");
throws("a reply needs some text", () => step(d, A2, { t: "agentReply", id, text: "   " }), "required");
d = step(d, A2, { t: "agentReply", id, text: "Received. Team will visit on Monday.", ref: "MCD/4471", status: "acknowledged" });
check("reply is saved with who recorded it", get().agent!.replies?.length === 1 && get().agent!.replies![0].by === "Adm #2");
check("reply updates reference and status", get().handoff?.ref === "MCD/4471" && get().handoff?.status === "acknowledged");
throws("an invalid status is refused", () => step(d, A, { t: "agentReply", id, text: "x", status: "bogus" as never }), "Invalid status");
let early = step(emptyDoc(), R, { t: "report", title: "Leak", desc: "x", cat: "water", priority: "high", lat: 28.567, lng: 77.212 });
early = step(early, R, { t: "agentStart", id: early.issues[0].id, lang: "en", original: "x", summaryEn: "x", source: "rules" });
throws("a reply is refused before anything was sent", () => step(early, A, { t: "agentReply", id: early.issues[0].id, text: "x" }), "Send the complaint first");

// ---- the email text
const mail = buildComplaintEmail(get(), "Test Nagar", "GR-9");
check("subject carries the case id", mail.subject.startsWith(`[NOS-${id}]`), mail.subject);
check("body has the complaint text", mail.text.includes(get().agent!.draft.body.trim().slice(0, 40)));
check("body has the map link", mail.text.includes(osmUrl(28.567, 77.212)));
check("body has the reference and case id", mail.text.includes("Reference: GR-9") && mail.text.includes(`NOS-${id}`));
check("body says verification status honestly", mail.text.includes("Not yet verified by a coordinator"), "(this report was not verified)");
check("body never names the reporter", !mail.text.includes("Res #1"));
const verified = buildComplaintEmail({ ...get(), verif: "verified", verifiedBy: ["Adm #1", "Adm #2"] }, "Test Nagar", "");
check("verified report says verified by a coordinator", verified.text.includes("Verified by a coordinator"));
check("no reference line when there is none", !verified.text.includes("Reference:"));
throws("no draft, no email", () => buildComplaintEmail({ ...get(), agent: undefined }, "x", ""), "no complaint draft");

// ---- "I sent it from my own email" (the coordinator presses Send in their own mail app)
let m = step(emptyDoc(), R, { t: "report", title: "Streetlight out", desc: "dark", cat: "streetlight", priority: "medium", lat: 28.567, lng: 77.212 });
const mid = m.issues[0].id;
m = step(m, R, { t: "agentStart", id: mid, lang: "en", original: "dark", summaryEn: "Streetlight is out", source: "rules" });
m = step(m, A, { t: "agentApprove", id: mid });
throws("a resident cannot record an own-email send", () => step(m, R, { t: "agentSend", id: mid, via: "mailto", emailTo: "w@mcd.gov.in" }), "coordinator");
throws("an own-email send needs a valid address", () => step(m, A, { t: "agentSend", id: mid, via: "mailto", emailTo: "nope" }), "valid email");
m = step(m, A, { t: "agentSend", id: mid, via: "mailto", ref: "", emailTo: "w@mcd.gov.in" });
const mi = m.issues.find(x => x.id === mid)!;
check("own-email send is recorded with the address", mi.agent!.draft.via === "mailto" && mi.agent!.draft.emailedTo === "w@mcd.gov.in" && mi.handoff?.email === "w@mcd.gov.in");
check("the log says it came from the coordinator's own email", mi.log.some(l => l.text.includes("own email")));

// ---- link helpers
const mt = mailtoUrl("w@mcd.gov.in", "Subject & more", "Line one\nLine two");
check("mailto keeps the @ and encodes the subject", mt.startsWith("mailto:w@mcd.gov.in?subject=Subject%20%26%20more&body="), mt.slice(0, 60));
check("mailto uses CRLF line breaks", mt.includes("Line%20one%0D%0ALine%20two"));
check("a long complaint is shortened for mailto", decodeURIComponent(mailtoUrl("a@b.in", "s", "word ".repeat(1000))).length < MAILTO_MAX + 250);
check("short complaints are not cut", decodeURIComponent(mailtoUrl("a@b.in", "s", "short")).endsWith("short"));
const gm = gmailUrl("w@mcd.gov.in", "Hi", "Body");
check("gmail link opens a compose window with the address", gm.startsWith("https://mail.google.com/mail/?view=cm") && gm.includes("to=w%40mcd.gov.in") && gm.includes("su=Hi"));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);