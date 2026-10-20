import assert from "node:assert/strict";
import { afterPhoto, emptyDoc, reduce, type Doc } from "../src/logic";

const P1 = "data:image/png;base64,AAAA", P2 = "data:image/png;base64,BBBB";
const as = (d: Doc, role: "admin" | "resident", name: string, a: any) => reduce(d, { role, name }, a).doc;
let d = as(emptyDoc(), "resident", "Resi #1", { t: "report", title: "Pothole", desc: "x", cat: "pothole", priority: "high", lat: 28.5, lng: 77.2 });
const id = d.issues[0].id;
["advance", "advance"].forEach(() => { d = as(d, "admin", "A #1", { t: "advance", id }); });
d = as(d, "admin", "A #1", { t: "proof", id, text: "first try", photo: P1 });
assert.equal(afterPhoto(d.issues[0]), P1);
d = as(d, "admin", "A #1", { t: "advance", id });
d = as(d, "admin", "B #2", { t: "rejectResolution", id, reason: "still a hole" });
assert.equal(d.issues[0].status, "progress");
// New evidence after the rejection replaces the "after" photo, and the old proof is kept in the list
d = as(d, "admin", "A #1", { t: "proof", id, text: "second try", photo: P2 });
assert.equal(afterPhoto(d.issues[0]), P2);
assert.equal(d.issues[0].proof.length, 2);
// A newer note without a photo does not remove the last photo
d = as(d, "admin", "A #1", { t: "proof", id, text: "note only" });
assert.equal(afterPhoto(d.issues[0]), P2);
assert.equal(afterPhoto({ proof: [] }), undefined);
console.log("after photo: all checks passed");