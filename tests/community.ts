import { DEMO, reduce, seed, emptyDoc, suggest, myStats, BADGES, leaderboard, hotspots, publicSummary, weeklyDigest, insights } from "../src/logic";
const b = { lat: 28.5663, lng: 77.2115, r: 700 };
const R = { role: "resident" as const, name: "Res #1" }, R2 = { role: "resident" as const, name: "Res #2" }, V = { role: "volunteer" as const, name: "Vol #1" }, A = { role: "admin" as const, name: "Adm #1" };
const fail = (m: string, f: () => unknown) => { try { f(); console.log("FAIL", m); } catch (e) { console.log("ok", m, "->", (e as Error).message); } };
let d = seed();
for (let i = 0; i < DEMO.length; i++) d = reduce(d, R, { t: "demo" }).doc;
console.log("demo end:", d.issues.find(i => i.id === "i4")!.status, "reports", d.issues.find(i => i.id === "i4")!.reports);
const s = suggest(seed(), { title: "Garbage all over Lakeview Road", desc: "Trash dumped near the bins", cat: "garbage", lat: 28.5654, lng: 77.2126 });
console.log("dup:", s.dup?.id, "candidates:", s.candidates.map(c => `${c.issue.id}:${c.score.toFixed(2)}`).join(" "));

d = emptyDoc();
d = reduce(d, A, { t: "checkinStart", title: "Are you safe?" }, b).doc;
d = reduce(d, R, { t: "checkinReply", ok: true }, b).doc; d = reduce(d, R2, { t: "checkinReply", ok: false, note: "trapped" }, b).doc;
console.log("checkin replies:", Object.keys(d.checkin!.replies).length);
fail("resident cannot start checkin", () => reduce(d, R, { t: "checkinStart", title: "x" }));
d = reduce(d, A, { t: "checkinClose" }).doc; fail("reply after close", () => reduce(d, R, { t: "checkinReply", ok: true }));
fail("care needs consent", () => reduce(d, R, { t: "careSet", need: "mobility", note: "", consent: false }));
d = reduce(d, R, { t: "careSet", need: "mobility", note: "second floor", consent: true }).doc; console.log("care:", d.care!.length);
d = reduce(d, A, { t: "planSet", routes: "Go north", notes: "bag", contacts: "x" }).doc; console.log("plan by:", d.plan!.by);
fail("resident cannot set plan", () => reduce(d, R, { t: "planSet", routes: "", notes: "", contacts: "" }));
d = reduce(d, V, { t: "abilities", abilities: ["first_aid", "bogus"] }).doc; console.log("abilities:", d.volunteers[0].abilities);

d = reduce(d, R, { t: "shareAdd", kind: "offer", cat: "tools", title: "Ladder", note: "" }).doc; const sh = d.shares![0].id;
fail("cannot claim own", () => reduce(d, R, { t: "shareClaim", id: sh }));
d = reduce(d, R2, { t: "shareClaim", id: sh }).doc; d = reduce(d, R2, { t: "shareMsg", id: sh, text: "Thanks!" }).doc;
fail("stranger cannot finish", () => reduce(d, V, { t: "shareDone", id: sh }));
d = reduce(d, R, { t: "shareDone", id: sh }).doc; console.log("share:", d.shares![0].status, d.shares![0].thread.length);
fail("author cannot remove others'", () => reduce(d, R2, { t: "shareRemove", id: sh }));

d = reduce(d, A, { t: "noticeAdd", title: "Water cut", body: "Tomorrow", urgent: true, pinned: false }, b).doc; console.log("notices:", d.notices!.length);
fail("resident cannot post notice", () => reduce(d, R, { t: "noticeAdd", title: "x", body: "", urgent: false, pinned: false }));

d = reduce(d, R, { t: "report", title: "Pothole on Main", desc: "deep", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 }, b).doc;
const iid = d.issues[0].id;
d = reduce(d, A, { t: "authoritySet", name: "Roads dept", email: "roads@example.org", phone: "" }).doc;
fail("bad email", () => reduce(d, A, { t: "authoritySet", name: "X", email: "nope", phone: "" }));
const au = d.authorities![0].id;
d = reduce(d, A, { t: "handoff", id: iid, authorityId: au, ref: "R-1" }).doc; d = reduce(d, A, { t: "handoffStatus", id: iid, status: "acknowledged" }).doc;
console.log("handoff:", d.issues[0].handoff!.to, d.issues[0].handoff!.status);
fail("bad handoff status", () => reduce(d, A, { t: "handoffStatus", id: iid, status: "x" as never }));
d = reduce(d, R2, { t: "merge", id: iid }).doc; d = reduce(d, A, { t: "verify", id: iid, v: "verified" }).doc;
const st = myStats(d, R.name); console.log("stats reporter:", st.reports, "badges:", BADGES.filter(x => x.test(st)).map(x => x.label), "leaderboard:", leaderboard(d).map(x => `${x.name}:${x.pts}`));
console.log("summary:", JSON.stringify(publicSummary(d)));
let h = seed(); h = reduce(h, R, { t: "report", title: "Garbage again", desc: "", cat: "garbage", priority: "low" as const, lat: 28.5655, lng: 77.2125 }, b).doc;
console.log("hotspots:", hotspots(h).length, "insights bullets:", insights(h).bullets.length, "digest:", weeklyDigest(h).body.split("\n")[0]);
console.log("old share purge:", (() => { const x = reduce(d, R, { t: "careRemove" }).doc; x.shares![0].expires = Date.now() - 9 * 86400000; return reduce(x, R, { t: "careRemove" }).doc.shares!.length; })());
