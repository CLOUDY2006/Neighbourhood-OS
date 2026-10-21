import { renderToString } from "react-dom/server";
import * as S from "../src/store";
import { Detail } from "../src/Detail";
import { Pulse } from "../src/Pulse";
import { Simulator } from "../src/Simulator";
import ListView from "../src/ListView";
import { Prepare } from "../src/Prepare";
import { Reports } from "../src/Reports";
import { AgentPanel } from "../src/AgentPanel";
import { ChatPanel } from "../src/ChatPanel";
import { PlanSheet, PlanSummary } from "../src/PlanSheet";
import { actionPlan } from "../src/plan";

S.enterDemo();
S.setRole("admin");
const st = { ...S.reduce(S.seed(), { role: "admin", name: "Coordinator (you)" }, { t: "noticeAdd", title: "x", body: "y", urgent: false, pinned: false }).doc, role: "admin" as const };
const app = { mode: "demo", ready: true, error: "", me: null, mine: [], nbhd: S.DEMO_N, map: null, mapNote: "", online: true, queued: 0, stale: false, alerts: [], world: null, worldInfo: null } as S.AppState;
const act = async () => undefined;
const parts: [string, () => string][] = [
  ["Detail", () => renderToString(<Detail i={st.issues.find(i => i.id === "i4")!} st={st} act={act} close={() => undefined} />)],
  ["Detail resolved", () => renderToString(<Detail i={st.issues.find(i => i.id === "i8")!} st={st} act={act} close={() => undefined} />)],
  ["Pulse", () => renderToString(<Pulse st={st} app={app} act={act} demo />)],
  ["Simulator", () => renderToString(<Simulator st={st} onOverlay={() => undefined} />)],
  ["ListView", () => renderToString(<ListView st={st} filter={[...S.STATUSES]} sel={null} onSel={() => undefined} />)],
  ["Prepare", () => renderToString(<Prepare st={st} app={app} act={act} />)],
  ["Reports", () => renderToString(<Reports st={st} app={app} act={act} />)],
  ["AgentPanel", () => renderToString(<AgentPanel i={st.issues.find(i => i.id === "i4")!} st={st} act={act} />)],
  ["PlanSheet", () => { const i = st.issues.find(x => x.id === "i4")!, h = renderToString(<PlanSheet plan={actionPlan(st, i)} issue={i} />); if (!/ACTION PLAN/.test(h) || !/Done when/.test(h) || !/Step by step/.test(h)) throw new Error("the plan sheet is missing its main parts"); return h; }],
  ["PlanSheet resolved", () => { const i = st.issues.find(x => x.id === "i8")!, h = renderToString(<PlanSheet plan={actionPlan(st, i)} issue={i} />); if (!/resolved/.test(h)) throw new Error("a resolved report should say resolved"); return h; }],
  ["ChatPanel", () => renderToString(<ChatPanel st={st} app={app} act={act} onSos={() => undefined} />)],
  ["ChatPanel resident", () => { const h = renderToString(<ChatPanel st={{ ...st, role: "resident" }} app={app} act={act} onSos={() => undefined} />); if (/Coordinators|Volunteers/.test(h)) throw new Error("a resident should only see the neighbourhood room"); return h; }],
  ["PlanSummary", () => { const i = st.issues.find(x => x.id === "i4")!; return renderToString(<PlanSummary plan={actionPlan(st, i)} />); }],
];
let bad = 0;
{
  // A report written by someone else must show the spam button near the top, before the collapsed "More options".
  const other = { ...st.issues.find(i => i.id === "i4")!, author: "Someone else", flags: [] as string[], hidden: false };
  const h = renderToString(<Detail i={other} st={st} act={act} close={() => undefined} />);
  const a = h.indexOf("Report spam or wrong report"), f = h.indexOf("More options");
  const okTop = a > -1 && (f === -1 || a < f);
  if (!okTop) { bad++; console.log("FAIL spam button is missing or buried"); } else console.log("ok spam button is near the top");
  const own = renderToString(<Detail i={{ ...other, author: S.myName() }} st={st} act={act} close={() => undefined} />);
  if (own.includes("Report spam or wrong report")) { bad++; console.log("FAIL author can flag own report"); } else console.log("ok author does not see the spam button");
  // The "Open location in OpenStreetMap" button is for coordinators and moderators only.
  for (const [role, expected] of [["admin", true], ["moderator", true], ["resident", false], ["volunteer", false]] as const) {
    const out = renderToString(<Detail i={other} st={{ ...st, role }} act={act} close={() => undefined} />);
    const has = out.includes("Open location in OpenStreetMap");
    if (has !== expected) { bad++; console.log(`FAIL location button for ${role}: expected ${expected}`); } else console.log(`ok location button ${expected ? "shown" : "hidden"} for ${role}`);
  }
  const hid = renderToString(<Detail i={{ ...other, hidden: true }} st={st} act={act} close={() => undefined} />);
  if (hid.includes("Report spam or wrong report")) { bad++; console.log("FAIL hidden report still offers spam button"); } else console.log("ok hidden report does not offer the spam button");
}
for (const [n, f] of parts) { try { const h = f(); console.log("ok", n, h.length, "chars"); } catch (e) { bad++; console.log("FAIL", n, (e as Error).stack?.split("\n").slice(0, 4).join(" | ")); } }
// The demo chat runs in the browser with the same room rules as the server.
async function demoChat() {
  const ok = (m: string, c: boolean) => { if (!c) bad++; console.log(c ? "ok" : "FAIL", m); };
  const fails = async (m: string, f: () => Promise<unknown>) => { try { await f(); bad++; console.log("FAIL", m); } catch { console.log("ok", m); } };
  S.setRole("resident");
  await fails("demo: a resident cannot read the coordinator room", () => S.chatLoad("coordinators"));
  await fails("demo: a resident cannot post in the volunteer room", () => S.chatSend("volunteers", "hi"));
  const sent = await S.chatSend("all", "Testing the chat");
  ok("demo: a resident can post in the neighbourhood room", sent.mine && sent.text === "Testing the chat");
  await fails("demo: links are refused", () => S.chatSend("all", "see www.example.org"));
  const target = (await S.chatLoad("all")).msgs.find(m => !m.mine)!;
  for (const r of ["resident", "volunteer", "admin"] as const) { S.setRole(r); await S.chatReport("all", target.id); }
  S.setRole("resident");
  const after = (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!;
  ok("demo: three reports hide a message, and its text is withheld from members", after.state === "hidden" && after.text === "");
  S.setRole("moderator");
  const seen = (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!;
  ok("demo: a moderator still sees the hidden text and the report count", seen.text !== "" && seen.reports === 3);
  await S.chatHide("all", target.id, false);
  ok("demo: a moderator can restore it", (await S.chatLoad("all")).msgs.find(m => m.id === target.id)!.state === "ok");
  const ch = await S.chatLoad("all", { since: 0 });
  ok("demo: polling with since returns changes in rev order", ch.msgs.every((m, i) => i === 0 || m.rev > ch.msgs[i - 1].rev));
  S.setRole("resident");
  await fails("demo: you cannot delete someone else's message", () => S.chatDelete("all", target.id));
  await S.chatDelete("all", sent.id);
  ok("demo: you can delete your own message", (await S.chatLoad("all")).msgs.find(m => m.id === sent.id)!.state === "deleted");
  await S.reset();
}
demoChat().catch(e => { bad++; console.log("FAIL demo chat", (e as Error).message); }).finally(() => process.exit(bad ? 1 : 0));
