import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Radar, PlusCircle, Users, Package, BarChart3, RotateCcw, Play, ShieldAlert, UserCog, User, Globe, Siren, ShieldCheck, FileText, FlaskConical, Sun, Moon, Ellipsis, LogOut } from "lucide-react";
import * as S from "./store";
import IsoMap, { ViewSwitch, type MapView } from "./IsoMap";
import { toggleTheme, useTheme } from "./a11y";
import { go, usePath } from "./route";
import Landing from "./Landing";
import { Detail, AiPhoto, PhotoPicker } from "./Detail";
import { Pulse } from "./Pulse";
import { Simulator } from "./Simulator";
import ListView from "./ListView";
import { AreaShare } from "./Swarm";
import Onboarding from "./Onboarding";
import SosPanel from "./SosPanel";
import { AgentPanel, AnalysisCard } from "./AgentPanel";
import PublicImpact from "./PublicImpact";
import VoiceButton from "./Voice";
import { Exchange } from "./Exchange";
import { NoticeBoard } from "./Notices";
import { CheckinCard, Prepare } from "./Prepare";
import { HandoffBox, Reports } from "./Reports";
import { AccessSettings, MyImpact, NotifySettings } from "./Settings";
import { LANGS, setLang, useLang, useT } from "./i18n";
import { AlertBanner, WorldMap, WorldPanel } from "./WorldView";

type Act = (fn: () => unknown, ok?: string) => Promise<void>;
type Tab = "feed" | "report" | "missions" | "resources" | "people" | "account" | "world" | "sos" | "prepare" | "reports" | "pulse" | "sim";
type Pt = { lat: number; lng: number } | null;

const grp = (s: S.Status) => (s === "resolved" ? "green" : s === "assigned" || s === "progress" || s === "pending" ? "amber" : "red");
const LBL = S.STATUS_LABEL;
const VL: Record<S.Verif, string> = { unverified: "Unverified", review: "Under review", verified: "Verified by coordinator", disputed: "Disputed", resolved: "Resolved" };
const RL: Record<S.Role, string> = { resident: "Resident", volunteer: "Volunteer", moderator: "Moderator", admin: "Coordinator" };
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const TAB_INFO: Record<Tab, [string, string]> = {
  feed: ["Command", "Live overview of the neighborhood: alerts, notices, how much work is in each stage, and every issue. Pick an issue to see its details."],
  report: ["Report a problem", "Click the map to place a pin, describe what is wrong and submit. A coordinator reviews every report."],
  missions: ["Missions", "Volunteer work that fixes reported problems. Join a mission, or set your skills and availability."],
  pulse: ["Pulse", "How fast problems get fixed. Actual numbers are tagged green and estimates amber."],
  sos: ["SOS", "Ask neighbors for help. If anyone is in danger, call your local emergency number first."],
  resources: ["Resources", "Shelters, water points and supplies on the map, plus the neighbor exchange."],
  prepare: ["Prepare", "Safety check-ins, the emergency plan and the optional extra-help register."],
  world: ["World", "Official hazard feeds. An alert near this neighborhood can switch on Crisis Mode."],
  sim: ["What-if", "Try different numbers of volunteers and hours. Everything is an estimate and nothing real changes."],
  reports: ["Council reports", "Summaries for local offices: trends, hotspots and hand-offs, with CSV and PDF export."],
  people: ["People", "Members and their roles. Every coordinator action is recorded in the log."],
  account: ["Account", "Your profile, neighborhoods, notifications, display settings and privacy."],
};
const PIPE: [S.Status, string, string, string][] = [
  ["reported", "Reported", "red", "A neighbor reported it. Others can confirm with “I see this too”."],
  ["review", "Review", "red", "A coordinator is checking the report."],
  ["assigned", "Assigned", "amber", "A mission or volunteer has been assigned."],
  ["progress", "Fixing", "amber", "Volunteers are working on it and posting evidence."],
  ["pending", "Approval", "amber", "A different moderator must approve the fix."],
  ["resolved", "Fixed", "green", "Approved. The pin turns green on the map."],
];

function Pipeline({ st }: { st: S.State }) {
  const vis = st.issues.filter(i => !i.hidden), n = (s: S.Status) => vis.filter(i => i.status === s).length, total = Math.max(1, vis.length);
  return (
    <div className="card pipe">
      <div className="row between"><b>How problems get fixed</b><small className="dim">{vis.length} issue{vis.length === 1 ? "" : "s"}</small></div>
      <div className="pipebar" aria-hidden="true">{PIPE.map(([s, , c]) => <i key={s} className={c} style={{ flexGrow: n(s) / total }} />)}</div>
      <ol className="pipesteps">
        {PIPE.map(([s, label, c, why]) => (
          <li key={s} className={`${c} ${n(s) ? "has" : ""}`} title={why}>
            <span className="pnum">{n(s)}</span>
            <span className="plbl">{label}</span>
          </li>
        ))}
      </ol>
      <small className="dim">Report → neighbors confirm → coordinator verifies and assigns → volunteers fix → a moderator approves the proof.</small>
    </div>
  );
}

function Feed({ st, app, sel, setSel, act, demo, goReport, alerts, onWorld }: { st: S.State; app: S.AppState; sel: string | null; setSel: (id: string | null) => void; act: Act; demo: boolean; goReport: () => void; alerts: S.Alert[]; onWorld: () => void }) {
  const t = useT();
  const open = st.issues.filter(i => i.status === "reported" || i.status === "review").length;
  const prog = st.issues.filter(i => i.status === "assigned" || i.status === "progress").length;
  const done = st.issues.filter(i => i.status === "resolved").length;
  const issue = st.issues.find(i => i.id === sel);
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  useEffect(() => {
    if (sel) requestAnimationFrame(() => document.querySelector(".card.detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [sel]);
  const sorted = [...st.issues].sort((a, b) => S.priorityScore(st, b).score - S.priorityScore(st, a).score || b.created - a.created);
  const card = (i: S.Issue) => (
    <button key={i.id} className={`issue ${grp(i.status)}`} onClick={() => setSel(i.id)}>
      <span className="dot" /><span className="grow">{i.title}<small>{LBL[i.status]} · {S.priorityScore(st, i).level} urgency{i.verif === "verified" ? " · verified" : i.verif === "disputed" ? " · disputed" : ""}{i.hidden ? " · hidden" : ""}</small></span><small className="mono">{ago(i.created)}</small>
    </button>
  );
  if (issue) return (
    <>
      <AlertBanner alerts={alerts} onWorld={onWorld} />
      <Detail i={issue} st={st} act={act} close={() => setSel(null)} />
    </>
  );
  return (
    <>
      <AlertBanner alerts={alerts} onWorld={onWorld} />
      <CheckinCard st={st} app={app} act={act} compact />
      <div className="stats"><div className="red"><b>{open}</b>{t("Open")}</div><div className="amber"><b>{prog}</b>{t("In progress")}</div><div className="green"><b>{done}</b>{t("Fixed")}</div></div>
      {st.issues.some(i => i.status === "pending" && !i.hidden) && (
        <div className="card alertcard">
          <b>Fixes waiting for review</b>
          {st.issues.filter(i => i.status === "pending" && !i.hidden).map(i => <button key={i.id} className="issue amber" onClick={() => setSel(i.id)}><span className="dot" /><span className="grow">{i.title}<small>{S.STATUS_LABEL.pending}</small></span></button>)}
          <small className="dim">Neighbors can say whether it looks fixed. A moderator approves the resolution.</small>
        </div>
      )}
      {st.issues.length > 0 && <Pipeline st={st} />}
      {demo && (
        <div className="card demo">
          <b>Guided AI agent demo</b>
          <p className="dim">{st.demo < S.DEMO.length ? `Step ${st.demo + 1} of ${S.DEMO.length}: ${S.DEMO[st.demo]}` : "Demo finished. Reset to run it again."}</p>
          {st.demo === 0 && <p className="hindi">“{S.DEMO_HINDI}”</p>}
          <div className="row wrap"><button className="go" onClick={() => act(() => S.runDemo())}><Play size={14} /> Run next step</button><button className="warn" onClick={() => S.toggleDemoAlert()}>{alerts.length ? "Clear simulated alert" : "Simulate an earthquake alert"}</button></div>
        </div>
      )}
      {!demo && st.issues.length === 0 && (
        <div className="card">
          <b>This neighborhood is just getting started</b>
          <p className="dim">Nothing has been reported yet. Report the first problem, invite your neighbors from the Account tab, and ask a trusted neighbor to become a coordinator so reports can be reviewed.</p>
          <button className="go" onClick={goReport}>Report a problem</button>
        </div>
      )}
      {st.issues.length > 0 && <h3>{t("Live issues")}</h3>}
      {st.issues.length > 0 && <p className="dim hint">{t("Tap a pin on the map or a report below to see what is happening and what you can do.")}</p>}
      {sorted.filter(i => i.status !== "resolved").map(card)}
      {sorted.some(i => i.status === "resolved") && <h3>{t("Fixed")}</h3>}
      {sorted.filter(i => i.status === "resolved").map(card)}
      <NoticeBoard st={st} act={act} />
      {st.events.length > 0 && (
        <details className="fold">
          <summary>{t("Event log")} ({Math.min(st.events.length, 10)})</summary>
          <div className="foldbody">{st.events.slice(0, 10).map((e, n) => <div key={n} className={`ev ${e.tone}`}><span className="mono">{ago(e.t)}</span> {e.text}</div>)}</div>
        </details>
      )}
    </>
  );
}

function Report({ pick, act, done }: { pick: Pt; act: Act; done: (id: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ title: "", desc: "", cat: "garbage" as S.Cat, priority: "medium" as S.Priority });
  const [photo, setPhoto] = useState<string>(), [prev, setPrev] = useState<string>(), [ai, setAi] = useState<{ summary: string; needs: string[]; source: string } | null>(null);
  const live = S.useApp().mode === "live";
  const [analysis, setAnalysis] = useState<S.Analysis | null>(null);
  const sug = pick && (f.title || f.desc) ? S.quickSuggest({ ...f, lat: pick.lat, lng: pick.lng }) : null;
  const submit = () => act(async () => {
    if (!pick) throw new Error("Click the map to set the location");
    if (!f.title.trim()) throw new Error("Add a short title");
    let agent: { lang: string; original: string; summaryEn: string; source: string } | undefined;
    try { const text = `${f.title}. ${f.desc}`, an = analysis ?? await S.agentAnalyze(text); agent = { lang: an.lang, original: text, summaryEn: an.summaryEn, source: an.source }; } catch { /* continue without the agent */ }
    const id = await S.report({ ...f, lat: pick.lat, lng: pick.lng, photo, agent });
    setF({ ...f, title: "", desc: "" }); setPhoto(undefined); setPrev(undefined); setAi(null); setAnalysis(null);
    if (id) done(id);
  }, "Report submitted. A coordinator will review it");
  return (
    <div className="form">
      <p className="dim">{pick ? `${t("Chosen location")} (${pick.lat.toFixed(4)}, ${pick.lng.toFixed(4)})` : t("Click the map to choose the location.")}</p>
      <div className="row"><input className="grow" placeholder={t("Short title")} maxLength={120} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /><VoiceButton onText={x => setF({ ...f, title: `${f.title} ${x}`.trim() })} /></div>
      <select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value as S.Cat })} aria-label="Category">{S.CATS.map(c => <option key={c}>{c}</option>)}</select>
      <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as S.Priority })} aria-label="Priority">{S.PRIORITIES.map(c => <option key={c}>{c}</option>)}</select>
      <textarea placeholder={t("What is happening? Please do not include names, phone numbers or faces.")} rows={3} maxLength={1000} value={f.desc} onChange={e => setF({ ...f, desc: e.target.value })} />
      <VoiceButton onText={x => setF({ ...f, desc: `${f.desc} ${x}`.trim() })} />
      <PhotoPicker onReady={(v, p) => { setPhoto(v); setPrev(p); }} />
      {prev && <img className="thumb" src={prev} alt="Selected" />}
      <AiPhoto photo={prev} mode="report" cat={f.cat} />
      <button type="button" disabled={(f.title + f.desc).trim().length < 3} onClick={() => act(async () => setAnalysis(await S.agentAnalyze(`${f.title}. ${f.desc}`)))}>{t("Understand and prepare complaint")}</button>
      {analysis && <AnalysisCard a={analysis} onApply={() => setF({ ...f, cat: analysis.cat, priority: analysis.priority })} />}
      {sug && (
        <div className="card ai">
          <b>{t("Possible duplicates")}</b>
          <p>Likely category: {sug.cat}.</p>
          {sug.candidates.map(c => (
            <div key={c.issue.id} className="row between"><span>{c.issue.title}<small className="dim"> {Math.round(c.score * 100)}% match · {LBL[c.issue.status]}</small></span>
              <button onClick={() => act(() => S.merge(c.issue.id), "Added to the existing report")}>{t("Add to this report")}</button></div>
          ))}
          {!sug.candidates.length && <p>No similar nearby report found.</p>}
          {live && pick && <button onClick={() => act(async () => setAi(await S.aiSuggest({ ...f, lat: pick.lat, lng: pick.lng })))}>Get AI summary</button>}
          {ai && <p>{ai.summary}{ai.needs.length > 0 && ` Likely needs: ${ai.needs.join(", ")}.`} <small className="dim">({ai.source === "ai" ? "AI suggestion" : "rule-based"})</small></p>}
          <small className="dim">Suggestions are not decisions. A coordinator reviews every report.</small>
        </div>
      )}
      <button className="go" onClick={submit}>{t("Submit report")}</button>
      <small className="dim">New reports stay "Unverified" until a coordinator reviews them. For life-threatening emergencies, call your local emergency number.</small>
    </div>
  );
}

function Missions({ st, act, pick }: { st: S.State; act: Act; pick: Pt }) {
  const [f, setF] = useState({ title: "", need: 5 });
  const me = st.volunteers.find(v => v.name === S.myName());
  return (
    <>
      {S.can(st.role, "mission") && (
        <div className="card form">
          <b>New community mission</b>
          <input placeholder="e.g. Park cleanup this Sunday" maxLength={100} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
          <input type="number" min={1} max={200} value={f.need} onChange={e => setF({ ...f, need: Number(e.target.value) })} />
          <button className="go" onClick={() => act(async () => { await S.mission(f.title, f.need); setF({ title: "", need: 5 }); }, "Mission created")}>Create mission</button>
        </div>
      )}
      {S.can(st.role, "availability") && (
        <div className="card">
          <div className="row between"><b>My volunteer profile</b>
            <button className={me?.available !== false ? "go" : ""} onClick={() => act(() => S.setAvailability(!(me?.available ?? true)))}>{me?.available !== false ? "Available" : "Unavailable"}</button></div>
          <small className="dim">Skills help coordinators match you to requests.</small>
          <div className="skills">{S.CATS.map(c => { const on = !!me?.skills.includes(c); return <button key={c} className={`chip btn ${on ? "sel" : ""}`} onClick={() => act(() => S.setSkills(on ? (me?.skills ?? []).filter(x => x !== c) : [...(me?.skills ?? []), c]))}>{c}</button>; })}</div>
          <small className="dim">Abilities that help in emergencies:</small>
          <div className="skills">{S.ABILITIES.map(c => { const on = !!me?.abilities?.includes(c); return <button key={c} className={`chip btn ${on ? "sel" : ""}`} onClick={() => act(() => S.setAbilities(on ? (me?.abilities ?? []).filter(x => x !== c) : [...(me?.abilities ?? []), c]))}>{c.replace("_", " ")}</button>; })}</div>
        </div>
      )}
      {S.can(st.role, "volunteerArea") && <AreaShare st={st} act={act} pick={pick} />}
      {st.missions.map(m => (
        <div key={m.id} className="card">
          <div className="row between"><b>{m.title}</b>{m.done && <span className="chip green">Done</span>}</div>
          <div className="bar"><i style={{ width: `${Math.min(100, (m.joined.length / m.need) * 100)}%` }} /></div>
          <small className="dim">{m.joined.length} of {m.need} volunteers · {m.hours} volunteer hours</small>
          {S.can(st.role, "join") && !m.done && <button onClick={() => act(() => S.join(m.id), "You joined the mission")}>Join mission</button>}
        </div>
      ))}
      {!st.missions.length && <p className="dim">No missions yet. A coordinator can create one.</p>}
      {st.role === "resident" && <small className="dim">To join missions, switch to volunteer in the Account tab.</small>}
    </>
  );
}

function Resources({ st, pick, act }: { st: S.State; pick: Pt; act: Act }) {
  const [f, setF] = useState({ name: "", kind: "aid" as S.Kind, note: "" });
  const [dn, setDn] = useState("");
  return (
    <>
      <h3>Resource radar</h3>
      {st.resources.map(r => (
        <div key={r.id} className={`card res-card ${r.low ? "amber" : ""}`}>
          <div className="row between"><b>{r.name}</b>{r.low && <span className="chip amber">Shortage</span>}</div>
          <small className="dim">{r.kind} · {r.note}</small>
          {S.can(st.role, "delivery") && (
            <div className="row wrap">
              <input placeholder="Delivery note, e.g. 4 tankers received" value={dn} onChange={e => setDn(e.target.value)} />
              <button onClick={() => act(async () => { await S.delivery(r.id, dn); setDn(""); }, "Delivery recorded")}>Record delivery</button>
              {!r.low && <button className="warn" onClick={() => act(() => S.shortage(r.id), "Shortage flagged")}>Flag shortage</button>}
            </div>
          )}
        </div>
      ))}
      {!st.resources.length && <p className="dim">No resources listed yet. Coordinators can add shelters, water points, aid posts and donation drops.</p>}
      {S.can(st.role, "addResource") && (
        <div className="card form">
          <b>Add a resource</b>
          <small className="dim">{pick ? "Using the location you chose on the map." : "Click the map first to choose a location."}</small>
          <input placeholder="Name" maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as S.Kind })}>{S.KINDS.map(k => <option key={k}>{k}</option>)}</select>
          <input placeholder="Note (stock, hours)" maxLength={120} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <button className="go" onClick={() => act(async () => { if (!pick) throw new Error("Click the map to choose a location first"); await S.addResource({ ...f, lat: pick.lat, lng: pick.lng }); setF({ name: "", kind: "aid", note: "" }); }, "Resource added")}>Add resource</button>
        </div>
      )}
      <Exchange st={st} act={act} />
    </>
  );
}

function People({ act }: { act: Act }) {
  const [ms, setMs] = useState<S.Member[]>([]), [au, setAu] = useState<{ at: string; who: string; action: string; detail: string }[]>([]);
  const load = () => { S.members().then(setMs).catch(() => setMs([])); S.auditLog().then(setAu).catch(() => setAu([])); };
  useEffect(load, []);
  return (
    <>
      {ms.map(m => (
        <div key={m.userId} className="card">
          <div className="row between"><b>{m.name}</b>{m.requested && m.role !== "admin" && <span className="chip amber">Wants to coordinate</span>}</div>
          <select aria-label={`Role for ${m.name}`} value={m.role} onChange={e => act(async () => { await S.setMemberRole(m.userId, e.target.value as S.Role); load(); }, "Role updated")}>
            {(["resident", "volunteer", "moderator", "admin"] as S.Role[]).map(r => <option key={r} value={r}>{RL[r]}</option>)}
          </select>
        </div>
      ))}
      <small className="dim">Make coordinators of people you trust. Every coordinator action below is recorded.</small>
      <h3>Coordinator activity log</h3>
      {au.map((a, n) => <div key={n} className="ev"><span className="mono">{new Date(a.at).toLocaleString()}</span> {a.who}: {a.action} {a.detail}</div>)}
      {!au.length && <small className="dim">Nothing recorded yet.</small>}
    </>
  );
}

function Account({ st, app, act }: { st: S.State; app: S.AppState; act: Act }) {
  const live = app.mode === "live", n = app.nbhd!;
  const invite = `${location.origin}/?n=${encodeURIComponent(n.id)}`;
  return (
    <>
      {live ? (
        <div className="card">
          <b>{app.me?.handle}</b>
          <small className="dim">{app.me?.email} · {RL[st.role]} in {n.name}</small>
          {st.role !== "admin" && <button onClick={() => act(() => S.setMyRole(st.role === "volunteer" ? "resident" : "volunteer"), "Role updated")}>{st.role === "volunteer" ? "Stop volunteering" : "I want to volunteer"}</button>}
          {st.role !== "admin" && <button onClick={() => act(() => S.requestCoordinator(), "Request sent to this neighborhood's coordinators")}>Ask to become a coordinator</button>}
          <button onClick={() => act(async () => { await navigator.clipboard.writeText(invite); }, "Invite link copied")}>Copy invite link</button>
        </div>
      ) : (
        <div className="card"><b>Simulated demo</b><small className="dim">Nothing here is real. Create an account to join your own neighborhood.</small><button className="go" onClick={() => { S.leave(); go("/signin"); }}>Create an account or sign in</button></div>
      )}
      {live && (
        <div className="card">
          <b>My neighborhoods</b>
          {app.mine.map(m => <button key={m.id} className={m.id === n.id ? "go" : ""} onClick={() => act(() => S.enter(m))}>{m.name}</button>)}
          <button onClick={() => { S.leave(); go("/signin"); }}>Find another neighborhood</button>
          <button className="warn" onClick={() => { if (confirm("Leave this neighborhood?")) act(() => S.leaveNeighborhood()); }}>Leave this neighborhood</button>
        </div>
      )}
      <MyImpact st={st} />
      {live && <NotifySettings act={act} />}
      <AccessSettings />
      <div className="card">
        <b>Safety and privacy</b>
        <small className="dim">This is not an emergency service. In an emergency, call your local emergency number first.</small>
        <small className="dim">Your exact location is never stored. A neighborhood is a roughly 1 km area, or a named area you join. The pin on a report is only the spot someone chose on the map.</small>
        <small className="dim">Photos are re-encoded in your browser, which removes location data from the file, and only members of the neighborhood can see them.</small>
        <small className="dim">Reports start as unverified. Only a human coordinator can mark one verified, and every coordinator action is logged. Several flags from neighbors hide a report until a coordinator reviews it.</small>
        <small className="dim">Your display name is visible to your neighbors on reports and missions.</small>
      </div>
      {live && (
        <div className="card">
          <button onClick={() => S.signOut()}>Sign out</button>
          <button className="warn" onClick={() => { if (confirm("Delete your account? Your memberships and photos are removed and your name is replaced by 'Former member' in reports.")) act(() => S.deleteAccount()); }}>Delete my account</button>
        </div>
      )}
    </>
  );
}

function Main({ app }: { app: S.AppState }) {
  const st = S.useStore(), n = app.nbhd!, demo = app.mode === "demo", t = useT(), lang = useLang();
  const [tab, setTab] = useState<Tab>("feed");
  const [sel, setSel] = useState<string | null>(null);
  const [pick, setPick] = useState<Pt>(null);
  const [filter, setFilter] = useState<S.Status[]>([...S.STATUSES]);
  const [res, setRes] = useState(true);
  const [view, setView] = useState<MapView>("iso"), [heat, setHeat] = useState(false), [showVol, setShowVol] = useState(true);
  const [simMap, setSimMap] = useState<Record<string, number | null> | null>(null);
  const [tt, setTt] = useState<{ on: boolean; days: number }>({ on: false, days: 0 });
  const [bell, setBell] = useState(false);
  useEffect(() => {
    if (!bell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBell(false); };
    const onDown = (e: MouseEvent) => { if (!(e.target as Element).closest(".bellwrap")) setBell(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [bell]);
  const [selEv, setSelEv] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem("nos-seen") || 0));
  const [toast, setToast] = useState<{ m: string; bad?: boolean } | null>(null);
  const flash = (m: string, bad?: boolean) => { setToast({ m, bad }); setTimeout(() => setToast(null), 3200); };
  const act: Act = async (fn, ok) => { try { await fn(); if (ok) flash(ok); } catch (e) { flash((e as Error).message, !(e instanceof S.QueuedError)); } };
  const zones = S.crisisZones(st);
  const official = S.isOfficial(app.alerts);
  const sosList = S.visibleSos(st, st.role, S.myName());
  useEffect(() => { if (tab === "world") S.loadWorld().catch(() => undefined); }, [tab]);
  const myEvents = st.events.filter(e => !e.to || e.to === S.myName());
  const unread = myEvents.filter(e => e.t > seen).length;
  const asOf = tt.on && tt.days > 0 ? Date.now() - tt.days * 86400000 : null;
  const stView: S.State = asOf ? { ...S.docAsOf(st, asOf), role: st.role } : st;
  const NAV: [Tab, string, typeof Radar][] = [["feed", "Command", Radar], ["report", "Report", PlusCircle], ["missions", "Missions", Users], ["pulse", "Pulse", BarChart3], ["sos", "SOS", Siren]];
  const MORE: [Tab, string, typeof Radar][] = [["resources", "Resources", Package], ["prepare", "Prepare", ShieldCheck], ["world", "World", Globe]];
  if (st.role === "admin") MORE.push(["sim", "What-if", FlaskConical], ["reports", "Reports", FileText]);
  if (!demo && st.role === "admin") MORE.push(["people", "People", UserCog]);
  const tabNow: Tab = (tab === "people" || tab === "reports" || tab === "sim") && st.role !== "admin" ? "feed" : tab;
  const [more, setMore] = useState(false);
  const theme = useTheme();
  const ALL: [Tab, string, typeof Radar][] = [...NAV, ...MORE, ["account", "Account", User]];
  const TabIcon = ALL.find(x => x[0] === tabNow)?.[2] ?? Radar;
  const navBtn = ([k, l, Ic]: [Tab, string, typeof Radar]) => <button key={k} className={`${tabNow === k ? "on" : ""} ${k === "sos" ? "sostab" : ""}`} onClick={() => { setTab(k); setMore(false); }} aria-label={t(l)} aria-current={tabNow === k ? "page" : undefined} title={t(l)}><Ic size={20} /><span>{t(l)}</span></button>;
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  return (
    <div className={`app ${zones.length > 0 || official ? "in-crisis" : ""}`}>
      <a className="skip" href="#panel">{t("Skip to the list")}</a>
      <nav className={`side ${more ? "more-open" : ""}`} aria-label="Main">
        <div className="logo" aria-hidden="true">N</div>
        {NAV.map(navBtn)}
        <button className={`morebtn ${!NAV.some(x => x[0] === tabNow) ? "on" : ""}`} aria-expanded={more} onClick={() => setMore(!more)}><Ellipsis size={20} /><span>More</span></button>
        <div className="moreset">
          <hr className="sep" />
          {MORE.map(navBtn)}
          <hr className="sep" />
          {navBtn(["account", "Account", User])}
        </div>
      </nav>
      {more && <div className="scrim" onClick={() => setMore(false)} />}
      <header className="top">
        <div className="brand">NEIGHBORHOOD OS<small>{demo ? "Simulated demo" : `${n.kind === "named" ? "Named neighborhood" : "Area neighborhood"}`} · {n.name}</small></div>
        <span className={`mode ${demo ? "" : "live"}`}>{demo ? t("Demo mode") : `${t("Live")} · ${t(RL[st.role])}`}</span>
        {!demo && (!app.online || app.stale) && <span className="mode off">{t("Offline")}</span>}
        {app.queued > 0 && <span className="mode off">{app.queued} {t("waiting to send")}</span>}
        {(zones.length > 0 || official) && <span className="crisis"><ShieldAlert size={14} /> {official ? "Crisis mode: official alert" : `Crisis mode: ${zones.length} cluster${zones.length > 1 ? "s" : ""}`}</span>}
        <div className="grow" />
        <select className="langsel" aria-label={t("Language")} value={lang} onChange={e => setLang(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
        <button className="iconbtn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} data-tip={theme === "dark" ? "Light theme" : "Dark theme"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        <div className="bellwrap">
          <button className="iconbtn" aria-label="Notifications" data-tip="Notifications" onClick={() => { setBell(!bell); const t = Date.now(); setSeen(t); localStorage.setItem("nos-seen", String(t)); }}><Bell size={17} />{unread > 0 && <b className="badge">{unread}</b>}</button>
          {bell && (
            <div className="bell-pop" role="dialog" aria-label={t("Notifications")}>
              <div className="bell-head"><b>{t("Notifications")}</b><button className="x" onClick={() => setBell(false)} aria-label={t("Close")}>✕</button></div>
              {myEvents.length === 0 ? <div className="dim">No notifications yet.</div> : myEvents.slice(0, 8).map((e, i) => <div key={i} className={`ev ${e.tone}`}><span className="mono">{ago(e.t)}</span>{e.text}</div>)}
            </div>
          )}
        </div>
        {demo ? (
          <>
            <label className="role">{t("Role")}
              <select value={st.role} onChange={e => S.setRole(e.target.value as S.Role)}>
                <option value="resident">Resident</option><option value="volunteer">Volunteer</option><option value="moderator">Moderator</option><option value="admin">Coordinator</option>
              </select>
            </label>
            <button onClick={() => act(async () => { await S.reset(); setSel(null); setPick(null); }, "Demo reset")}><RotateCcw size={14} /> {t("Reset demo")}</button>
            <button className="ghost" onClick={() => { S.leave(); go("/"); }}><LogOut size={14} /> {t("Exit demo")}</button>
          </>
        ) : <button onClick={() => { S.leave(); go("/signin"); }}>{t("Switch neighborhood")}</button>}
      </header>
      <main className="center">
        <div className="layer" hidden={tabNow === "world" || view === "list"}>
          <IsoMap st={stView} name={n.name} center={{ lat: n.lat, lng: n.lng }} map={app.map} note={app.mapNote} sos={sosList} official={official} sel={sel}
            onSel={id => { if (id.startsWith("s")) setTab("sos"); else { setSel(id); setTab("feed"); } }}
            pick={pick} onPick={(lat, lng) => setPick({ lat, lng })} filter={filter} setFilter={setFilter} res={res} setRes={setRes} picking={tabNow === "report" || tabNow === "resources" || tabNow === "sos"} zones={zones}
            view={view} setView={setView} heat={heat} setHeat={setHeat} showVol={showVol} setShowVol={setShowVol} canSeeVol={st.role === "admin" || st.role === "moderator"}
            sim={simMap} timeOn={tt.on} onTime={() => setTt(o => (o.on ? { on: false, days: 0 } : { on: true, days: 14 }))} />
        </div>
        {view === "list" && tabNow !== "world" && <div className="layer scroll"><ListView st={stView} filter={filter} sel={sel} onSel={id => { setSel(id); setTab("feed"); }} /><ViewSwitch view={view} setView={setView} /></div>}
        {tt.on && tabNow !== "world" && view !== "list" && (
          <div className="hud timebar glass">
            <b>Then vs now</b>
            <input type="range" min={0} max={60} value={tt.days} onChange={e => setTt({ on: true, days: Number(e.target.value) })} aria-label="Days ago" />
            <span>{tt.days === 0 ? "Now" : `${tt.days} days ago`}</span>
            <small className="dim">Open then: {stView.issues.filter(i => i.status !== "resolved" && !i.hidden).length} · now: {st.issues.filter(i => i.status !== "resolved" && !i.hidden).length}. Reconstructed from the activity log.</small>
          </div>
        )}
        {tabNow === "world" && <div className="layer"><WorldMap events={app.world ?? []} mine={{ lat: n.lat, lng: n.lng, name: n.name }} sel={selEv} onSel={setSelEv} alerts={app.alerts} /></div>}
      </main>
      <aside id="panel" tabIndex={-1} className="panel" aria-labelledby="panel-title">
        <div className={`phead ${tabNow === "sos" ? "red" : ""}`}>
          <span className="picon" aria-hidden="true"><TabIcon size={18} /></span>
          <div><h2 id="panel-title">{t(TAB_INFO[tabNow][0])}</h2><p>{TAB_INFO[tabNow][1]}</p></div>
        </div>
        <AnimatePresence mode="wait"><motion.div className="pbody" key={tabNow} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
        {tabNow === "feed" && <Feed st={st} app={app} sel={sel} setSel={setSel} act={act} demo={demo} goReport={() => setTab("report")} alerts={app.alerts} onWorld={() => setTab("world")} />}
        {tabNow === "sos" && <SosPanel st={st} app={app} pick={pick} setPick={setPick} act={act} />}
        {tabNow === "world" && <WorldPanel app={app} sel={selEv} onSel={setSelEv} />}
        {tabNow === "report" && <Report pick={pick} act={act} done={id => { setSel(id); setPick(null); setTab("feed"); }} />}
        {tabNow === "missions" && <Missions st={st} act={act} pick={pick} />}
        {tabNow === "resources" && <Resources st={st} pick={pick} act={act} />}
        {tabNow === "pulse" && <Pulse st={st} app={app} act={act} demo={demo} />}
        {tabNow === "sim" && <Simulator st={st} onOverlay={setSimMap} />}
        {tabNow === "prepare" && <Prepare st={st} app={app} act={act} />}
        {tabNow === "reports" && <Reports st={st} app={app} act={act} />}
        {tabNow === "people" && <People act={act} />}
        {tabNow === "account" && <Account st={st} app={app} act={act} />}
        </motion.div></AnimatePresence>
      </aside>
      <div className="toastwrap"><AnimatePresence>{toast && <motion.div key={toast.m} className={`toast ${toast.bad ? "bad" : ""}`} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast.m}</motion.div>}</AnimatePresence></div>
    </div>
  );
}

export default function App() {
  const app = S.useApp(), path = usePath();
  const impact = new URLSearchParams(location.search).get("impact");
  if (impact) return <PublicImpact id={impact} />;
  if (app.mode === "none" || !app.nbhd) {
    let invite = false;
    try { invite = !!localStorage.getItem("nos-pending-n"); } catch { /* ignore */ }
    return path === "/signin" || invite ? <Onboarding /> : <Landing />;
  }
  return <Main key={app.nbhd.id} app={app} />;
}