import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Radar, PlusCircle, BarChart3, RotateCcw, Play, UserCog, User, Sun, Moon, LogOut, MessagesSquare } from "lucide-react";
import * as S from "./store";
import IsoMap, { ViewSwitch, type MapView } from "./IsoMap";
import { toggleTheme, useTheme } from "./a11y";
import { go, usePath } from "./route";
import Landing from "./Landing";
import { Detail, AiPhoto, PhotoPicker } from "./Detail";
import { Status } from "./Status";
import ListView from "./ListView";
import Onboarding from "./Onboarding";
import { AgentPanel, AnalysisCard } from "./AgentPanel";
import VoiceButton from "./Voice";
import { NoticeBoard } from "./Notices";
import { ChatPanel } from "./ChatPanel";
import { AccessSettings, NotifySettings } from "./Settings";
import { LANGS, setLang, useLang, useT } from "./i18n";

type Act = (fn: () => unknown, ok?: string) => Promise<void>;
type Tab = "feed" | "report" | "status" | "chat" | "people" | "account";
type Pt = { lat: number; lng: number } | null;

const grp = (s: S.Status) => (s === "resolved" ? "green" : s === "assigned" || s === "progress" || s === "pending" ? "amber" : "red");
const LBL = S.STATUS_LABEL;
const VL: Record<S.Verif, string> = { unverified: "Unverified", review: "Under review", verified: "Verified by coordinator", disputed: "Disputed", resolved: "Resolved" };
const RL: Record<S.Role, string> = { resident: "Resident", admin: "Coordinator" };
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const TAB_INFO: Record<Tab, [string, string]> = {
  feed: ["Command", "Live overview of the neighbourhood: notices, how much work is in each stage, and every issue. Pick an issue to see its details."],
  report: ["Report a problem", "Click the map to place a pin, describe what is wrong and submit. A coordinator reviews every report."],
  status: ["Locality status", "How fast problems get fixed, where they repeat, a summary for local offices and the ward councillor lookup. Actual numbers are tagged green and estimates amber."],
  chat: ["Chat", "Talk with people in this neighbourhood. Rooms are private to its members. Coordinators also have their own room."],
  people: ["People", "This month's ranking of coordinators, scored by verified work. Coordinators can also manage members and see the activity log."],
  account: ["Account", "Your profile, neighbourhoods, notifications, display settings and privacy."],
};
const PIPE: [S.Status, string, string, string][] = [
  ["reported", "Reported", "red", "A neighbor reported it. Others can confirm with “I see this too”."],
  ["review", "Review", "red", "A coordinator is checking the report."],
  ["assigned", "Assigned", "amber", "A coordinator has lined up someone to fix it."],
  ["progress", "Fixing", "amber", "The fix is under way and evidence is being added."],
  ["pending", "Approval", "amber", "The reporter or a different coordinator must confirm the fix."],
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
      <small className="dim">Report → neighbors confirm → coordinator verifies and assigns → the fix is done with proof → the reporter or another coordinator confirms.</small>
    </div>
  );
}

function Feed({ st, app, sel, setSel, act, demo, goReport }: { st: S.State; app: S.AppState; sel: string | null; setSel: (id: string | null) => void; act: Act; demo: boolean; goReport: () => void }) {
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
      <span className="dot" /><span className="grow">{i.title}<small>{LBL[i.status]}{i.status !== "resolved" ? ` · ${S.priorityScore(st, i).level} urgency` : ""}{i.verif === "verified" ? " · verified" : i.verif === "disputed" ? " · disputed" : ""}{i.closure === "unconfirmed" ? " · closed without confirmation" : ""}{i.hidden ? " · hidden" : ""}</small></span><small className="mono">{ago(i.created)}</small>
    </button>
  );
  if (issue) return (
    <>
      <Detail i={issue} st={st} act={act} close={() => setSel(null)} />
    </>
  );
  return (
    <>
      <div className="stats"><div className="red"><b>{open}</b>{t("Open")}</div><div className="amber"><b>{prog}</b>{t("In progress")}</div><div className="green"><b>{done}</b>{t("Fixed")}</div></div>
      {st.issues.some(i => i.status === "pending" && !i.hidden) && (
        <div className="card alertcard">
          <b>Fixes waiting for review</b>
          {st.issues.filter(i => i.status === "pending" && !i.hidden).map(i => <button key={i.id} className="issue amber" onClick={() => setSel(i.id)}><span className="dot" /><span className="grow">{i.title}<small>{S.STATUS_LABEL.pending}</small></span></button>)}
          <small className="dim">Neighbors can say whether it looks fixed. The reporter or a different coordinator confirms the fix.</small>
        </div>
      )}
      {st.issues.length > 0 && <Pipeline st={st} />}
      {demo && (
        <div className="card demo">
          <b>Guided AI agent demo</b>
          <p className="dim">{st.demo < S.DEMO.length ? `Step ${st.demo + 1} of ${S.DEMO.length}: ${S.DEMO[st.demo]}` : "Demo finished. Reset to run it again."}</p>
          {st.demo === 0 && <p className="hindi">“{S.DEMO_HINDI}”</p>}
          <div className="row wrap"><button className="go" onClick={() => act(() => S.runDemo())}><Play size={14} /> Run next step</button></div>
        </div>
      )}
      {!demo && st.issues.length === 0 && (
        <div className="card">
          <b>This neighbourhood is just getting started</b>
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

function CoordBoard({ st, demo }: { st: S.State; demo: boolean }) {
  const [list, setList] = useState<{ name: string; role: string }[] | null>(demo ? [] : null), [bad, setBad] = useState(false);
  useEffect(() => { if (!demo) S.coordinators().then(setList).catch(() => { setList([]); setBad(true); }); }, [demo]);
  const coords = demo ? [...new Set((st.coordLog ?? []).map(e => e.by))].map(name => ({ name, role: "admin" })) : list ?? [];
  const b = S.coordinatorBoard(st, coords), me = S.myName();
  const month = new Date(b.from).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <div className="card">
        <b>{month}</b>
        <small className="dim">Counts work done in this neighbourhood only. The table starts again on {new Date(b.resetsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" })} (UTC), so old work never competes with new work.{demo ? " Demo: simulated names and numbers." : ""}</small>
      </div>
      {list === null && <small className="dim">Loading…</small>}
      {bad && <small className="dim">Could not load the coordinator list. Try again later.</small>}
      {b.rows.map(r => (
        <div key={r.name} className="card">
          <div className="row between"><b>#{r.rank} {r.name}{r.name === me ? " (you)" : ""}</b><span className="chip green">{r.score} points</span></div>
          <div className="chips">
            <span className="chip">{r.fixes} fixes approved</span><span className="chip">{r.reviews} reviews</span><span className="chip">{r.escalations} escalations</span>
            {r.reopened > 0 && <span className="chip amber">{r.reopened} sent back</span>}
          </div>
          <small className="dim">Coordinator · Neighbour feedback: {r.rating ? `${Math.round((r.rating.ok / r.rating.total) * 100)}% say fixed (${r.rating.total} ratings)` : `shown after ${S.COORD_MIN_RATINGS} ratings`}</small>
        </div>
      ))}
      {list !== null && !b.rows.length && <small className="dim">No coordinators yet.</small>}
      <small className="dim">How points work: verifying a report 2, moving it forward 1, asking for review 2, a fix approved by someone else 5 (plus 2 if a reporter confirms it), reviewing someone else's fix 3, sending a weak fix back 1, sending a complaint to an authority 2, posting a notice 1 (max 3). A fix that is sent back or reopened costs the person who submitted it 2. Each kind of action counts once per report. Only activity inside this app is counted; work done by phone or in person is not.</small>
    </>
  );
}

function Members({ act }: { act: Act }) {
  const [ms, setMs] = useState<S.Member[]>([]), [au, setAu] = useState<{ at: string; who: string; action: string; detail: string }[]>([]);
  const load = () => { S.members().then(setMs).catch(() => setMs([])); S.auditLog().then(setAu).catch(() => setAu([])); };
  useEffect(load, []);
  return (
    <>
      {ms.map(m => (
        <div key={m.userId} className="card">
          <div className="row between"><b>{m.name}</b>{m.requested && m.role !== "admin" && <span className="chip amber">Wants to coordinate</span>}</div>
          <select aria-label={`Role for ${m.name}`} value={m.role} onChange={e => act(async () => { await S.setMemberRole(m.userId, e.target.value as S.Role); load(); }, "Role updated")}>
            {(["resident", "admin"] as S.Role[]).map(r => <option key={r} value={r}>{RL[r]}</option>)}
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

function People({ st, act, demo }: { st: S.State; act: Act; demo: boolean }) {
  return (
    <>
      <CoordBoard st={st} demo={demo} />
      {!demo && st.role === "admin" && (
        <>
          <h3>Members</h3>
          <Members act={act} />
        </>
      )}
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
          {st.role !== "admin" && <button onClick={() => act(() => S.requestCoordinator(), "Request sent to this neighbourhood's coordinators")}>Ask to become a coordinator</button>}
          <button onClick={() => act(async () => { await navigator.clipboard.writeText(invite); }, "Invite link copied")}>Copy invite link</button>
        </div>
      ) : (
        <div className="card"><b>Simulated demo</b><small className="dim">Nothing here is real. Create an account to join your own neighbourhood.</small><button className="go" onClick={() => { S.leave(); go("/signin"); }}>Create an account or sign in</button></div>
      )}
      {live && (
        <div className="card">
          <b>My neighbourhoods</b>
          {app.mine.map(m => <button key={m.id} className={m.id === n.id ? "go" : ""} onClick={() => act(() => S.enter(m))}>{m.name}</button>)}
          <button onClick={() => { S.leave(); go("/signin"); }}>Find another neighbourhood</button>
          <button className="warn" onClick={() => { if (confirm("Leave this neighbourhood?")) act(() => S.leaveNeighbourhood()); }}>Leave this neighbourhood</button>
        </div>
      )}
      {live && <NotifySettings act={act} />}
      <AccessSettings />
      <div className="card">
        <b>Safety and privacy</b>
        <small className="dim">This is not an emergency service. In an emergency, call your local emergency number first.</small>
        <small className="dim">Your exact location is never stored. A neighbourhood is a roughly 1 km area, or a named area you join. The pin on a report is only the spot someone chose on the map.</small>
        <small className="dim">Photos are re-encoded in your browser, which removes location data from the file, and only members of the neighbourhood can see them.</small>
        <small className="dim">Reports start as unverified. Only a human coordinator can mark one verified, and every coordinator action is logged. Several flags from neighbors hide a report until a coordinator reviews it.</small>
        <small className="dim">Your display name is visible to your neighbors on reports and in chat.</small>
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

/** If one tab throws while drawing, show a message for that tab only instead of blanking the whole app. */
class TabGuard extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("Tab failed to draw:", e); }
  componentDidUpdate(prev: { name: string }) { if (prev.name !== this.props.name && this.state.failed) this.setState({ failed: false }); }
  render() {
    return this.state.failed
      ? <div className="card" role="alert"><b>Something went wrong in this tab</b><small className="dim">Reload the page. If it keeps happening, switch to another tab.</small></div>
      : this.props.children;
  }
}

function Main({ app }: { app: S.AppState }) {
  const st = S.useStore(), n = app.nbhd!, demo = app.mode === "demo", t = useT(), lang = useLang();
  const [tab, setTab] = useState<Tab>("feed");
  const [sel, setSel] = useState<string | null>(null);
  const [pick, setPick] = useState<Pt>(null);
  const [filter, setFilter] = useState<S.Status[]>([...S.STATUSES]);
  const [view, setView] = useState<MapView>("iso"), [heat, setHeat] = useState(false);
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
  const [seen, setSeen] = useState(() => Number(localStorage.getItem("nos-seen") || 0));
  const [toast, setToast] = useState<{ m: string; bad?: boolean } | null>(null);
  const flash = (m: string, bad?: boolean) => { setToast({ m, bad }); setTimeout(() => setToast(null), 3200); };
  const act: Act = async (fn, ok) => { try { await fn(); if (ok) flash(ok); } catch (e) { flash((e as Error).message, !(e instanceof S.QueuedError)); } };
  const myEvents = st.events.filter(e => !e.to || e.to === S.myName());
  const unread = myEvents.filter(e => e.t > seen).length;
  const asOf = tt.on && tt.days > 0 ? Date.now() - tt.days * 86400000 : null;
  const stView: S.State = asOf ? { ...S.docAsOf(st, asOf), role: st.role } : st;
  const stMap = useMemo<S.State>(() => ({ ...stView, missions: [], resources: [], volunteers: [] }), [stView]);
  const NAV: [Tab, string, typeof Radar][] = [["feed", "Command", Radar], ["report", "Report", PlusCircle], ["status", "Status", BarChart3], ["chat", "Chat", MessagesSquare], ["people", "People", UserCog], ["account", "Account", User]];
  const chatNew = S.chatUnread(app, st.role);
  const tabNow: Tab = tab;
  const [more, setMore] = useState(false);
  const theme = useTheme();
  const TabIcon = NAV.find(x => x[0] === tabNow)?.[2] ?? Radar;
  const navBtn = ([k, l, Ic]: [Tab, string, typeof Radar]) => <button key={k} className={tabNow === k ? "on" : ""} onClick={() => { setTab(k); setMore(false); }} aria-label={t(l)} aria-current={tabNow === k ? "page" : undefined} title={t(l)}><Ic size={20} /><span>{t(l)}</span>{k === "chat" && tabNow !== "chat" && chatNew && <i className="dot" aria-label={t("new messages")} />}</button>;
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  return (
    <div className="app">
      <a className="skip" href="#panel">{t("Skip to the list")}</a>
      <nav className={`side ${more ? "more-open" : ""}`} aria-label="Main">
        <div className="logo" aria-hidden="true">N</div>
        {NAV.map(navBtn)}
      </nav>
      {more && <div className="scrim" onClick={() => setMore(false)} />}
      <header className="top">
        <div className="brand">NEIGHBOURHOOD OS<small>{demo ? "Simulated demo" : `${n.kind === "named" ? "Named neighbourhood" : "Area neighbourhood"}`} · {n.name}</small></div>
        <span className={`mode ${demo ? "" : "live"}`}>{demo ? t("Demo mode") : `${t("Live")} · ${t(RL[st.role])}`}</span>
        {!demo && (!app.online || app.stale) && <span className="mode off">{t("Offline")}</span>}
        {app.queued > 0 && <span className="mode off">{app.queued} {t("waiting to send")}</span>}
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
                <option value="resident">Resident</option><option value="admin">Coordinator</option>
              </select>
            </label>
            <button onClick={() => act(async () => { await S.reset(); setSel(null); setPick(null); }, "Demo reset")}><RotateCcw size={14} /> {t("Reset demo")}</button>
            <button className="ghost" onClick={() => { S.leave(); go("/"); }}><LogOut size={14} /> {t("Exit demo")}</button>
          </>
        ) : <button onClick={() => { S.leave(); go("/signin"); }}>{t("Switch neighbourhood")}</button>}
      </header>
      <main className="center">
        <div className="layer" hidden={view === "list"}>
          <IsoMap st={stMap} name={n.name} center={{ lat: n.lat, lng: n.lng }} map={app.map} note={app.mapNote} sos={[]} official={false} sel={sel}
            onSel={id => { setSel(id); setTab("feed"); }}
            pick={pick} onPick={(lat, lng) => setPick({ lat, lng })} filter={filter} setFilter={setFilter} res={false} setRes={() => undefined} picking={tabNow === "report"} zones={[]}
            view={view} setView={setView} heat={heat} setHeat={setHeat} showVol={false} setShowVol={() => undefined} canSeeVol={false}
            sim={null} timeOn={tt.on} onTime={() => setTt(o => (o.on ? { on: false, days: 0 } : { on: true, days: 14 }))} />
        </div>
        {view === "list" && <div className="layer scroll"><ListView st={stView} filter={filter} sel={sel} onSel={id => { setSel(id); setTab("feed"); }} /><ViewSwitch view={view} setView={setView} /></div>}
        {tt.on && view !== "list" && (
          <div className="hud timebar glass">
            <b>Then vs now</b>
            <input type="range" min={0} max={60} value={tt.days} onChange={e => setTt({ on: true, days: Number(e.target.value) })} aria-label="Days ago" />
            <span>{tt.days === 0 ? "Now" : `${tt.days} days ago`}</span>
            <small className="dim">Open then: {stView.issues.filter(i => i.status !== "resolved" && !i.hidden).length} · now: {st.issues.filter(i => i.status !== "resolved" && !i.hidden).length}. Reconstructed from the activity log.</small>
          </div>
        )}
      </main>
      <aside id="panel" tabIndex={-1} className="panel" aria-labelledby="panel-title">
        <div className="phead">
          <span className="picon" aria-hidden="true"><TabIcon size={18} /></span>
          <div><h2 id="panel-title">{t(TAB_INFO[tabNow][0])}</h2><p>{TAB_INFO[tabNow][1]}</p></div>
        </div>
        <AnimatePresence mode="wait"><motion.div className="pbody" key={tabNow} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
        <TabGuard name={tabNow}>
          {tabNow === "feed" && <Feed st={st} app={app} sel={sel} setSel={setSel} act={act} demo={demo} goReport={() => setTab("report")} />}
          {tabNow === "report" && <Report pick={pick} act={act} done={id => { setSel(id); setPick(null); setTab("feed"); }} />}
          {tabNow === "chat" && <ChatPanel st={st} app={app} act={act} />}
          {tabNow === "status" && <Status st={st} app={app} act={act} demo={demo} />}
          {tabNow === "people" && <People st={st} act={act} demo={demo} />}
          {tabNow === "account" && <Account st={st} app={app} act={act} />}
        </TabGuard>
        </motion.div></AnimatePresence>
      </aside>
      <div className="toastwrap"><AnimatePresence>{toast && <motion.div key={toast.m} className={`toast ${toast.bad ? "bad" : ""}`} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast.m}</motion.div>}</AnimatePresence></div>
    </div>
  );
}

export default function App() {
  const app = S.useApp(), path = usePath();
  if (app.mode === "none" || !app.nbhd) {
    let invite = false;
    try { invite = !!localStorage.getItem("nos-pending-n"); } catch { /* ignore */ }
    return path === "/signin" || invite ? <Onboarding /> : <Landing />;
  }
  return <Main key={app.nbhd.id} app={app} />;
}