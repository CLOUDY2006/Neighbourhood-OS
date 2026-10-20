import assert from "node:assert/strict";
import { coordinatorBoard, emptyDoc, monthStart, nextMonthStart, reduce, seed, type Doc } from "../src/logic";

const real = Date.now;
let clock = Date.UTC(2026, 9, 15, 10);
Date.now = () => clock;
const A = "Asha #aaaaaa", B = "Bela #bbbbbb", C = "Cara #cccccc", R = "Resi #rrrrrr";
const coords = [{ name: A, role: "admin" }, { name: B, role: "admin" }, { name: C, role: "admin" }];
const as = (d: Doc, role: "admin" | "resident" | "moderator", name: string, a: any) => reduce(d, { role, name }, a).doc;
const bd = (d: Doc) => Object.fromEntries(coordinatorBoard(d, coords, clock).rows.map(r => [r.name, r]));

let d = emptyDoc();
d = as(d, "resident", R, { t: "report", title: "Pothole on Main", desc: "deep", cat: "pothole", priority: "high", lat: 28.5, lng: 77.2 });
const id = d.issues[0].id;

// Everyone is listed, even with no work
assert.equal(coordinatorBoard(d, coords, clock).rows.length, 3);

// verify, then repeating it earns nothing more
d = as(d, "admin", A, { t: "verify", id, v: "verified" });
d = as(d, "admin", A, { t: "verify", id, v: "verified" });
assert.equal(bd(d)[A].score, 2);

// A resident can never earn coordinator credit
const before = (d.coordLog ?? []).length;
d = as(d, "resident", R, { t: "report", title: "Other", desc: "x", cat: "garbage", priority: "low", lat: 28.5, lng: 77.2 });
assert.equal((d.coordLog ?? []).length, before);

// Full fix: A submits, B approves. A gets submit + resolved credit, B gets approve credit
d = as(d, "admin", A, { t: "advance", id }); // review
d = as(d, "admin", A, { t: "advance", id }); // assigned
d = as(d, "admin", A, { t: "proof", id, text: "filled" });
d = as(d, "admin", A, { t: "advance", id }); // pending
d = as(d, "admin", B, { t: "approveResolution", id });
let t = bd(d);
assert.equal(t[B].score, 3, "approver gets 3");
assert.equal(t[A].fixes, 1);
assert.equal(t[A].score, 2 + 1 + 2 + 5, "verify 2 + step 1 + submit 2 + resolved 5"); // advance to review/assigned dedupe to one 'step'
// Self-approval is still blocked by the reducer
let d2 = as(emptyDoc(), "resident", R, { t: "report", title: "Leak", desc: "x", cat: "water", priority: "high", lat: 28.5, lng: 77.2 });
const id2 = d2.issues[0].id;
["advance", "advance"].forEach(() => { d2 = as(d2, "admin", A, { t: "advance", id: id2 }); });
d2 = as(d2, "admin", A, { t: "proof", id: id2, text: "done" });
d2 = as(d2, "admin", A, { t: "advance", id: id2 });
assert.throws(() => as(d2, "admin", A, { t: "approveResolution", id: id2 }));
// Send back: reviewer +1, submitter -2
d2 = reduce(d2, { role: "admin", name: B }, { t: "rejectResolution", id: id2, reason: "not done" }).doc;
t = bd(d2);
assert.equal(t[B].score, 1);
assert.equal(t[A].reopened, 1);
assert.ok(t[A].score < 5);

// Ratings only show from 5 ratings
assert.equal(bd(d)[A].rating, null);
const dr = structuredClone(d);
dr.issues[0].feedback = Object.fromEntries(["n1", "n2", "n3", "n4", "n5"].map((n, k) => [n, { ok: k < 4, note: "", t: clock }]));
assert.deepEqual(bd(dr)[A].rating, { ok: 4, total: 5 });

// Notices are capped at 3 per month
let dn = emptyDoc();
for (let k = 0; k < 6; k++) dn = as(dn, "admin", C, { t: "noticeAdd", title: `N${k}`, body: "", urgent: false, pinned: false });
assert.equal(bd(dn)[C].score, 3);

// Ranking: ties share a rank, sorted by score
t = coordinatorBoard(d, coords, clock).rows;
assert.equal(t[0].name, A); assert.equal(t[0].rank, 1);
const tie = coordinatorBoard(emptyDoc(), coords, clock).rows;
assert.ok(tie.every(r => r.rank === 1));

// The table restarts every month: next month the same work no longer counts
clock = nextMonthStart(clock) + 3600_000;
assert.ok(coordinatorBoard(d, coords, clock).rows.every(r => r.score === 0 && r.fixes === 0));
assert.equal(monthStart(clock), nextMonthStart(Date.UTC(2026, 9, 15)));
// ...and a new action next month starts fresh credit
d = as(d, "admin", B, { t: "noticeAdd", title: "New month", body: "", urgent: false, pinned: false });
assert.equal(bd(d)[B].score, 1);
assert.equal(bd(d)[A].score, 0);

// Demo seed shows simulated coordinators
Date.now = real;
const sd = seed();
const names = [...new Set((sd.coordLog ?? []).map(e => e.by))].map(name => ({ name, role: "admin" }));
assert.ok(coordinatorBoard(sd, names).rows.some(r => r.score > 0));

console.log("coordinator board: all checks passed");