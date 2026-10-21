import { UNCONFIRMED_AFTER_MS, canConfirmFix, emptyDoc, pendingSince, reduce, statsFor, type Doc } from "../src/logic";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const throws = (m: string, f: () => unknown, part = "") => { try { f(); bad++; console.log("FAIL", m, "(did not throw)"); } catch (e) { const msg = (e as Error).message, hit = !part || msg.includes(part); if (!hit) bad++; console.log(hit ? "ok" : "FAIL", m, "->", msg); } };

const b = { lat: 28.5663, lng: 77.2115, r: 700, name: "Test" };
const R = { role: "resident" as const, name: "Res #1" }, R2 = { role: "resident" as const, name: "Res #2" }, R3 = { role: "resident" as const, name: "Res #3" };
const V = { role: "volunteer" as const, name: "Vol #1" }, A = { role: "admin" as const, name: "Adm #1" }, M = { role: "moderator" as const, name: "Mod #1" };
const step = (d: Doc, w: typeof R | typeof A | typeof V | typeof M, a: Parameters<typeof reduce>[2]) => reduce(d, w, a, b).doc;
const get = (d: Doc, id: string) => d.issues.find(i => i.id === id)!;

/** A report by `author`, confirmed by `with2`, taken all the way to "pending" by coordinator A. */
function pendingDoc(author = R, confirmers: (typeof R)[] = [R2]) {
  let d = step(emptyDoc(), author, { t: "report", title: "Pothole on Main Road", desc: "big hole", cat: "pothole", priority: "high", lat: 28.567, lng: 77.212 });
  const id = d.issues[0].id;
  confirmers.forEach(c => { d = step(d, c, { t: "merge", id }); });
  d = step(d, A, { t: "advance", id }); d = step(d, A, { t: "actionPlanApprove", id }); d = step(d, V, { t: "join", mid: d.missions[0].id });
  for (let n = 0; n < 6 && get(d, id).status !== "pending"; n++) {
    if (get(d, id).status === "progress" && !get(d, id).proof.length) d = step(d, V, { t: "proof", id, text: "filled the hole" });
    d = step(d, A, { t: "advance", id });
  }
  return { d, id };
}

// ---- 1. everyone who reported or confirmed is asked, the submitter is not
let { d, id } = pendingDoc();
check("fix is waiting for confirmation", get(d, id).status === "pending" && !!get(d, id).pendingAt);
const asked = (name: string) => d.events.filter(e => e.to === name && /Is the problem fixed/.test(e.text)).length;
check("the original reporter is asked", asked("Res #1") === 1);
check("a person who confirmed the problem is asked too", asked("Res #2") === 1);
check("the coordinator who submitted is not asked", asked("Adm #1") === 0);
check("a neighbor who never reported it is not asked", asked("Res #3") === 0);
check("canConfirmFix: reporter and confirmer yes, outsider and submitter no", canConfirmFix(get(d, id), "Res #1") && canConfirmFix(get(d, id), "Res #2") && !canConfirmFix(get(d, id), "Res #3") && !canConfirmFix(get(d, id), "Adm #1"));

// ---- 2. who may answer
throws("an outsider cannot answer", () => step(d, R3, { t: "reporterConfirm", id, ok: true }), "Only the person who reported");
throws("the coordinator who submitted cannot confirm their own fix", () => step(d, A, { t: "reporterConfirm", id, ok: true }), "someone else");
throws("the submitter still cannot approve it either", () => step(d, A, { t: "approveResolution", id }), "different reviewer");
throws("a moderator who did not report it cannot use the reporter path", () => step(d, M, { t: "reporterConfirm", id, ok: true }), "Only the person who reported");

// ---- 3. reporter says fixed -> resolved
const done = step(d, R, { t: "reporterConfirm", id, ok: true, note: "Road is smooth now" });
check("reporter says fixed: resolved, closure 'reporter'", get(done, id).status === "resolved" && get(done, id).closure === "reporter" && get(done, id).verif === "resolved" && get(done, id).reviewedBy === "Res #1");
check("the other reporter is told it was resolved", done.events.some(e => e.to === "Res #2" && /confirmed by a reporter/.test(e.text)));
check("mission is marked done", !get(done, id).missionId || done.missions.find(m => m.id === get(done, id).missionId)!.done === true);
check("a person who only confirmed the problem can also resolve it", get(step(d, R2, { t: "reporterConfirm", id, ok: true }), id).status === "resolved");
check("a reporter-confirmed fix still earns the volunteer proof points", statsFor(done).get("Vol #1")?.proofs === 1, `(proofs: ${statsFor(done).get("Vol #1")?.proofs})`);

// ---- 4. reporter says not fixed -> reopens
const re = step(d, R2, { t: "reporterConfirm", id, ok: false, note: "Still a hole on the left" });
const ri = get(re, id);
check("not fixed: back in progress, disputed, one rejection, pending cleared", ri.status === "progress" && ri.verif === "disputed" && ri.rejections === 1 && !ri.pendingBy && !ri.pendingAt && !ri.closure);
check("not fixed: the other reporter and the submitter's team can see the reopen", re.events.some(e => e.to === "Res #1" && /not fully fixed/.test(e.text)) && ri.log.some(l => /not fully fixed/.test(l.text)));
const again = step(re, A, { t: "advance", id });
check("after reopening the coordinator can submit a second time and reporters are asked again", get(again, id).status === "pending" && again.events.filter(e => e.to === "Res #1" && /Is the problem fixed/.test(e.text)).length === 2);

// ---- 5. neighbors who disagree can block a "fixed" answer
let neigh = step(d, R3, { t: "feedback", id, ok: false, note: "still broken" });
neigh = step(neigh, V, { t: "feedback", id, ok: false });
throws("a majority of 'not fixed' neighbor feedback blocks a reporter's 'fixed'", () => step(neigh, R, { t: "reporterConfirm", id, ok: true }), "Other neighbors");

// ---- 6. nobody answers -> closed without confirmation after 7 days
throws("cannot close without confirmation right away", () => step(d, A, { t: "closeUnconfirmed", id }), "more day");
throws("a resident cannot close without confirmation", () => step(d, R, { t: "closeUnconfirmed", id }), "not allowed");
const old = structuredClone(d); get(old, id).pendingAt = Date.now() - UNCONFIRMED_AFTER_MS - 1000;
const closed = step(old, A, { t: "closeUnconfirmed", id, note: "Checked on site" });
const ci = get(closed, id);
check("after 7 days the submitting coordinator can close it as 'unconfirmed'", ci.status === "resolved" && ci.closure === "unconfirmed" && ci.verif !== "resolved", `(verif stays '${ci.verif}')`);
check("closing without confirmation tells all reporters", closed.events.some(e => e.to === "Res #1" && /without confirmation/.test(e.text)) && closed.events.some(e => e.to === "Res #2" && /without confirmation/.test(e.text)));
check("closing without confirmation earns no proof points", (statsFor(closed).get("Vol #1")?.proofs ?? 0) === 0, `(proofs: ${statsFor(closed).get("Vol #1")?.proofs ?? 0})`);
throws("a 'fixed' answer on an unconfirmed closure is not accepted", () => step(closed, R, { t: "reporterConfirm", id, ok: true }), "not waiting");
const reopened = step(closed, R, { t: "reporterConfirm", id, ok: false, note: "Still broken" });
check("a reporter can reopen a report that was closed without confirmation", get(reopened, id).status === "progress" && !get(reopened, id).closure && !get(reopened, id).resolvedAt);
throws("neighbors' 'not fixed' majority also blocks closing without confirmation", () => { const x = structuredClone(neigh); get(x, id).pendingAt = Date.now() - UNCONFIRMED_AFTER_MS - 1000; return step(x, A, { t: "closeUnconfirmed", id }); }, "Neighbors say");

// ---- 7. legacy reports without a timestamp use the activity log
const legacy = structuredClone(d); get(legacy, id).pendingAt = undefined;
check("older reports fall back to the 'moved to pending' log entry", Math.abs(pendingSince(get(legacy, id)) - get(d, id).pendingAt!) < 5000);

// ---- 8. a coordinator who is also the only reporter cannot self-resolve
const solo = pendingDoc(A, []);
throws("coordinator who reported AND submitted cannot confirm", () => step(solo.d, A, { t: "reporterConfirm", id: solo.id, ok: true }), "someone else");
check("a different reviewer can still approve normally", get(step(solo.d, M, { t: "approveResolution", id: solo.id }), solo.id).closure === "reviewer");

// ---- 9. normal approval records who closed it
check("normal approval records closure 'reviewer'", get(step(d, M, { t: "approveResolution", id }), id).closure === "reviewer");

if (bad) { console.log(`${bad} reporter-confirmation test(s) failed`); process.exitCode = 1; } else console.log("all reporter-confirmation tests passed");