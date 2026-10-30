import { renderToString } from "react-dom/server";
import * as S from "../src/store";
import { Detail } from "../src/Detail";
import { Pulse } from "../src/Pulse";
import ListView from "../src/ListView";
import { Reports } from "../src/Reports";
import { AgentPanel } from "../src/AgentPanel";
import { ChatPanel } from "../src/ChatPanel";

S.enterDemo();
S.setRole("admin");
const st = { ...S.reduce(S.seed(), { role: "admin", name: "Coordinator (you)" }, { t: "noticeAdd", title: "x", body: "y", urgent: false, pinned: false }).doc, role: "admin" as const };
const app = { mode: "demo", ready: true, error: "", me: null, mine: [], nbhd: S.DEMO_N, map: null, mapNote: "", online: true, queued: 0, stale: false, alerts: [], world: null, worldInfo: null } as S.AppState;
const act = async () => undefined;
const parts: [string, () => string][] = [
  ["Detail", () => renderToString(<Detail i={st.issues.find(i => i.id === "i4")!} st={st} act={act} close={() => undefined} />)],
  ["Detail resolved", () => renderToString(<Detail i={st.issues.find(i => i.id === "i8")!} st={st} act={act} close={() => undefined} />)],
  ["Pulse", () => renderToString(<Pulse st={st} app={app} act={act} demo />)],
  ["ListView", () => renderToString(<ListView st={st} filter={[...S.STATUSES]} sel={null} onSel={() => undefined} />)],
  ["Reports", () => renderToString(<Reports st={st} app={app} act={act} />)],
  ["AgentPanel", () => renderToString(<AgentPanel i={st.issues.find(i => i.id === "i4")!} st={st} act={act} />)],
  ["ChatPanel", () => renderToString(<ChatPanel st={st} app={app} act={act} />)],
  ["ChatPanel old volunteer role (used to crash)", () => { const h = renderToString(<ChatPanel st={{ ...st, role: "volunteer" as never }} app={app} act={act} />); if (!/Neighbourhood/.test(h)) throw new Error("an old stored role should still get the neighbourhood room"); return h; }],
  ["ChatPanel old moderator role (used to crash)", () => renderToString(<ChatPanel st={{ ...st, role: "moderator" as never }} app={app} act={act} />)],
  ["ChatPanel resident", () => { const h = renderToString(<ChatPanel st={{ ...st, role: "resident" }} app={app} act={act} />); if (/Coordinators/.test(h)) throw new Error("a resident should only see the neighbourhood room"); return h; }],
];
let bad = 0;
{
  // A report written by someone else must show the spam button near the top, before the collapsed "More options".
  const other = { ...st.issues.find(i => i.id === "i4")!, author: "Someone else", flags: [] as string[], hidden: false };
  const h = renderToString(<Detail i={other} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  const a = h.indexOf("Report spam or wrong report"), f = h.indexOf('role="tablist"');
  const okTop = a > -1 && (f === -1 || a < f);
  // Coordinators get one action bar above the tabs: next step, verify, hide, spam, map.
  for (const label of ["Coordinator actions", "Hide report", "Verify", "Start review"]) {
    const at = h.indexOf(label);
    if (at === -1 || (f !== -1 && at > f)) { bad++; console.log(`FAIL coordinator bar is missing "${label}" or it is below the tabs`); } else console.log(`ok coordinator bar has "${label}" above the tabs`);
  }
  const resOut = renderToString(<Detail i={other} st={{ ...st, role: "resident" }} act={act} close={() => undefined} />);
  for (const label of ["Coordinator actions", "Hide report", "Verify", "Start review"]) {
    if (resOut.includes(label)) { bad++; console.log(`FAIL a resident sees "${label}"`); } else console.log(`ok a resident does not see "${label}"`);
  }
  if (!resOut.includes("I see this too")) { bad++; console.log("FAIL a resident cannot confirm a report"); } else console.log("ok a resident sees \"I see this too\"");
  if (!h.includes("Overview") || !h.includes("Activity")) { bad++; console.log("FAIL tabs are missing"); } else console.log("ok the panel has Overview and Activity tabs");
  // Pressed buttons stay visible with a tick (class "ticked") instead of vanishing.
  const tickOf = (out: string, label: string) => { const m = new RegExp(`class="ticked"[^>]*>(?:(?!</button>).)*${label}`).exec(out); return !!m; };
  const check = (name: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", name); };
  const mineOut = renderToString(<Detail i={{ ...other, author: S.myName() }} st={{ ...st, role: "resident" }} act={act} close={() => undefined} />);
  check("the author sees a tick \"You reported this\"", tickOf(mineOut, "You reported this"));
  check("the author has no \"I see this too\" button", !mineOut.includes("I see this too"));
  const confOut = renderToString(<Detail i={{ ...other, confirmedBy: [S.myName()] }} st={{ ...st, role: "resident" }} act={act} close={() => undefined} />);
  check("someone who confirmed sees a tick \"You confirmed this\"", tickOf(confOut, "You confirmed this") && !confOut.includes("I see this too"));
  check("others still get the \"I see this too\" button", resOut.includes("I see this too") && !tickOf(resOut, "You confirmed this"));
  const flagOut = renderToString(<Detail i={{ ...other, log: [...other.log, { t: Date.now(), by: S.myName(), text: "Flagged for coordinator attention" }] }} st={{ ...st, role: "resident" }} act={act} close={() => undefined} />);
  check("a flagged report shows a tick \"Flagged for attention\"", tickOf(flagOut, "Flagged for attention"));
  const verOut = renderToString(<Detail i={{ ...other, verif: "review", verifiedBy: [S.myName()] }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("an old half-checked report still offers the Verify button", !tickOf(verOut, "You verified") && verOut.includes("Verify"));
  const fullOut = renderToString(<Detail i={{ ...other, verif: "verified", verifiedBy: ["A", "B"] }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("a verified report shows a tick \"Verified\" instead of a missing button", tickOf(fullOut, "Verified") && !fullOut.includes("1/1"));
  const spamOut = renderToString(<Detail i={{ ...other, flags: [S.myName()] }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("a coordinator who flagged spam sees a tick \"You flagged spam\"", tickOf(spamOut, "You flagged spam"));
  const hidOut = renderToString(<Detail i={{ ...other, hidden: true }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("a hidden report shows a tick \"Hidden\" and a Restore button", tickOf(hidOut, "Hidden") && hidOut.includes("Restore"));
  // The coordinator who submitted a fix cannot approve it: the button is disabled for them and enabled for another coordinator.
  const pend = { ...other, status: "pending" as const, pendingBy: S.myName(), pendingAt: Date.now(), proof: [{ by: "x", text: "fixed", t: Date.now() }] };
  const ownFix = renderToString(<Detail i={pend} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  const approveBtn = (out: string) => /<button[^>]*>Approve resolution<\/button>/.exec(out)?.[0] ?? "";
  check("the submitter's Approve button is disabled", approveBtn(ownFix).includes("disabled"));
  check("the submitter is told why", ownFix.includes("cannot approve it yourself"));
  const other2 = renderToString(<Detail i={{ ...pend, pendingBy: "Another coordinator" }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("a different coordinator's Approve button is enabled", approveBtn(other2) !== "" && !approveBtn(other2).includes("disabled"));
  const disOut = renderToString(<Detail i={{ ...other, verif: "disputed" }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  check("a disputed report shows a tick \"Marked disputed\"", tickOf(disOut, "Marked disputed"));
  const resSpam = renderToString(<Detail i={other} st={{ ...st, role: "resident" }} act={act} close={() => undefined} />).includes("Report spam or wrong report");
  if (resSpam) { bad++; console.log("FAIL residents still see the spam button"); } else console.log("ok residents do not see the spam button");
  if (!okTop) { bad++; console.log("FAIL spam button is missing or buried"); } else console.log("ok spam button is near the top");
  const own = renderToString(<Detail i={{ ...other, author: S.myName() }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  if (own.includes("Report spam or wrong report")) { bad++; console.log("FAIL author can flag own report"); } else console.log("ok author does not see the spam button");
  // The "Open location in OpenStreetMap" button is for coordinators only.
  for (const [role, expected] of [["admin", true], ["resident", false]] as const) {
    const out = renderToString(<Detail i={other} st={{ ...st, role }} act={act} close={() => undefined} />);
    const has = out.includes("Open location in OpenStreetMap");
    if (has !== expected) { bad++; console.log(`FAIL location button for ${role}: expected ${expected}`); } else console.log(`ok location button ${expected ? "shown" : "hidden"} for ${role}`);
  }
  const hid = renderToString(<Detail i={{ ...other, hidden: true }} st={{ ...st, role: "admin" }} act={act} close={() => undefined} />);
  if (hid.includes("Report spam or wrong report")) { bad++; console.log("FAIL hidden report still offers spam button"); } else console.log("ok hidden report does not offer the spam button");
}
for (const [n, f] of parts) { try { const h = f(); console.log("ok", n, h.length, "chars"); } catch (e) { bad++; console.log("FAIL", n, (e as Error).stack?.split("\n").slice(0, 4).join(" | ")); } }
// The demo chat runs in the browser with the same room rules as the server.
async function demoChat() {
  const ok = (m: string, c: boolean) => { if (!c) bad++; console.log(c ? "ok" : "FAIL", m); };
  const fails = async (m: string, f: () => Promise<unknown>) => { try { await f(); bad++; console.log("FAIL", m); } catch { console.log("ok", m); } };
  S.setRole("resident");
  await fails("demo: a resident cannot read the coordinator room", () => S.chatLoad("coordinators"));
  const sent = await S.chatSend("all", "Testing the chat");
  ok("demo: a resident can post in the neighbourhood room", sent.mine && sent.text === "Testing the chat");
  await fails("demo: links are refused", () => S.chatSend("all", "see www.example.org"));
  const target = (await S.chatLoad("all")).msgs.find(m => !m.mine)!;
  for (const r of ["resident", "resident", "admin"] as const) { S.setRole(r); await S.chatReport("all", target.id); }
  S.setRole("admin");
  const counted = (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!;
  ok("demo: reporting twice counts once, and two reports do not hide a message", counted.state === "ok" && counted.reports === 2);
  await S.chatHide("all", target.id, true);
  S.setRole("resident");
  const after = (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!;
  ok("demo: a hidden message has its text withheld from residents", after.state === "hidden" && after.text === "");
  S.setRole("admin");
  const seen = (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!;
  ok("demo: a coordinator still sees the hidden text and the report count", seen.text !== "" && seen.reports === 2);
  await S.chatHide("all", target.id, false);
  ok("demo: a coordinator can restore it", (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!.state === "ok");
  const ch = await S.chatLoad("all", { since: 0 });
  ok("demo: polling with since returns changes in rev order", ch.msgs.every((m, i) => i === 0 || m.rev > ch.msgs[i - 1].rev));
  S.setRole("resident");
  await fails("demo: you cannot delete someone else's message", () => S.chatDelete("all", target.id));
  await S.chatDelete("all", sent.id);
  ok("demo: you can delete your own message", (await S.chatLoad("all")).msgs.find(m => m.id === sent.id)!.state === "deleted");
  await S.reset();
}
demoChat().catch(e => { bad++; console.log("FAIL demo chat", (e as Error).message); }).finally(() => process.exit(bad ? 1 : 0));