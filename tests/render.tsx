import { renderToString } from "react-dom/server";
import * as S from "../src/store";
import { Detail } from "../src/Detail";
import { Pulse } from "../src/Pulse";
import { Simulator } from "../src/Simulator";
import ListView from "../src/ListView";
import { Prepare } from "../src/Prepare";
import { Reports } from "../src/Reports";
import { AgentPanel } from "../src/AgentPanel";

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
  const hid = renderToString(<Detail i={{ ...other, hidden: true }} st={st} act={act} close={() => undefined} />);
  if (hid.includes("Report spam or wrong report")) { bad++; console.log("FAIL hidden report still offers spam button"); } else console.log("ok hidden report does not offer the spam button");
}
for (const [n, f] of parts) { try { const h = f(); console.log("ok", n, h.length, "chars"); } catch (e) { bad++; console.log("FAIL", n, (e as Error).stack?.split("\n").slice(0, 4).join(" | ")); } }
process.exit(bad ? 1 : 0);