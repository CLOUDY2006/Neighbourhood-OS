import { useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, type Act } from "./ui";

const when = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function AnalysisCard({ a, onApply }: { a: S.Analysis; onApply: () => void }) {
  const t = useT(), route = S.routeFor(a.cat);
  return (
    <div className="card ai">
      <b>{t("AI agent")}</b>
      <p>{t("Detected")}: {a.lang === "hi" ? "Hindi" : a.lang === "en" ? "English" : "another language"} · {a.cat} · {a.priority} priority</p>
      <p>{a.summaryEn}</p>
      <p>{t("Complaint goes to")}: <b>{route.authority}</b></p>
      <small className="dim">{a.source === "ai" ? "Understood by AI. " : "Understood with simple rules (no AI key). "}A complaint draft is prepared after you submit. Nothing is sent without a person approving it.</small>
      <button onClick={onApply}>{t("Use these suggestions")}</button>
    </div>
  );
}

export function AgentPanel({ i, st, act }: { i: S.Issue; st: S.State; act: Act }) {
  const t = useT(), app = S.useApp(), demo = app.mode === "demo", me = S.myName(), admin = st.role === "admin", owns = admin || i.author === me;
  const a = i.agent;
  const [ed, setEd] = useState<{ subject: string; body: string } | null>(null), [ref, setRef] = useState("");
  const resolved = i.status === "resolved";

  if (!a) {
    if (!owns || resolved) return null;
    return (
      <div className="card">
        <b>{t("AI agent")}</b>
        <small className="dim">The agent understands the report, picks the complaint route, drafts the complaint, and suggests a community mission. You approve every step.</small>
        <button className="go" onClick={() => act(async () => {
          const text = `${i.title}. ${i.desc}`, an = await S.agentAnalyze(text);
          await S.agentStart(i.id, an.lang, text, an.summaryEn, an.source);
        }, "The agent prepared a complaint draft")}>{t("Start the AI agent")}</button>
      </div>
    );
  }

  const w = S.workflow(st, i), route = S.routeFor(i.cat), d = a.draft, sent = !!d.sentAt, approved = !!d.approvedAt;
  const last = a.history[a.history.length - 1], pending = !!last && d.level > last.level && !resolved;
  const next = route.ladder[d.level], mp = S.proposeMission(i), m = st.missions.find(x => x.id === i.missionId);
  const text = `${ed?.subject ?? d.subject}\n\n${ed?.body ?? d.body}`;

  return (
    <div className="card agent">
      <div className="row between"><b>{t("AI agent")}</b><span className="chip sel">{w.done}/{w.total}</span></div>
      <ol className="steps2">
        {w.steps.map((s, n) => (
          <li key={s.id} className={s.done ? "done" : n === w.current ? "now" : ""}>
            <span className="tick">{s.done ? "✓" : n === w.current ? "●" : "○"}</span>
            <span>{t(s.label)}{s.note ? <small className="dim"> · {s.note}</small> : null}</span>
          </li>
        ))}
      </ol>

      <details>
        <summary>{t("Complaint route")}</summary>
        <p><b>{route.authority}</b></p>
        <small className="dim">{route.channel}</small>
        <small className="dim">Include: {route.include.join("; ")}</small>
        <small className="dim">Escalation: {route.ladder.map(l => `after ${l.waitDays} day(s) to ${l.to}`).join(", then ")}</small>
        <small className="dim">Check this route against your city's official website before sending. Names and portals differ between cities.</small>
      </details>

      <b>{t("Complaint draft")}{d.level > 0 ? ` (${t("Escalation")} ${d.level})` : ""}</b>
      <small className="dim">To: {d.to}</small>
      {pending && <p className="errtext">{t("Escalation ready")}: review and approve it to send to {d.to}.</p>}
      {!resolved && owns && !sent && (
        <div className="row wrap">
          {(["en", "hi"] as const).map(l => <button key={l} className={`chip btn ${d.lang === l ? "sel" : ""}`} onClick={() => act(async () => { setEd(null); await S.agentDraft(i.id, { lang: l }); })}>{l === "en" ? "English" : "हिन्दी"}</button>)}
        </div>
      )}
      {!sent && owns && !resolved ? (
        <div className="form">
          <input value={ed?.subject ?? d.subject} onChange={e => setEd({ subject: e.target.value, body: ed?.body ?? d.body })} aria-label="Subject" />
          <textarea rows={9} value={ed?.body ?? d.body} onChange={e => setEd({ subject: ed?.subject ?? d.subject, body: e.target.value })} aria-label="Complaint text" />
          <div className="row wrap">
            {ed && <button onClick={() => act(async () => { await S.agentDraft(i.id, ed); setEd(null); }, "Draft saved")}>{t("Save edits")}</button>}
            {!approved && <button className="go" disabled={!!ed} onClick={() => act(() => S.agentApprove(i.id), "Approved")}>{t("Approve")}</button>}
            {approved && !demo && <button onClick={() => act(async () => { await navigator.clipboard.writeText(text); }, "Copied. Paste it into the portal or email")}>{t("Copy complaint")}</button>}
            {approved && !demo && <button className="go" onClick={() => act(() => S.agentSend(i.id, "copied", ref), "Marked as sent")}>{t("I sent it")}</button>}
            {approved && demo && <button className="go" onClick={() => act(() => S.agentSend(i.id, "simulated", ref || "DEMO-2043"), "Sent (simulated)")}>{t("Send (simulated)")}</button>}
          </div>
          {approved && <input placeholder="Reference number, if you already have one (optional)" maxLength={60} value={ref} onChange={e => setRef(e.target.value)} />}
          <small className="dim">This app does not file on government portals for you. After approving, copy the text and submit it through the route above, then mark it as sent.</small>
        </div>
      ) : (
        <pre className="draft">{text}</pre>
      )}

      {sent && last && (
        <>
          <small className="dim">Sent to {last.to} on {when(last.sentAt)}{d.via === "simulated" ? " (simulated)" : ""}{last.ref ? ` · reference ${last.ref}` : ""}</small>
          {owns && !resolved && !i.handoff?.ref && (
            <div className="row"><input placeholder="Reference number received" maxLength={60} value={ref} onChange={e => setRef(e.target.value)} /><button onClick={() => act(async () => { await S.agentRef(i.id, ref); setRef(""); }, "Reference saved")}>{t("Save")}</button></div>
          )}
        </>
      )}
      {a.escalateAt && !resolved && <small className="dim">{t("If unresolved by")} {when(a.escalateAt)}, {t("the agent prepares an escalation to")} {next?.to ?? "the next level"}. {t("You approve before anything is sent.")}</small>}
      {sent && admin && !resolved && !pending && next && <button onClick={() => act(() => S.agentEscalate(i.id), "Escalation draft prepared")}>{t("Prepare escalation now")}</button>}
      {resolved && pending && <small className="dim">The issue was resolved, so the escalation is not needed.</small>}

      {admin && !m && !resolved && (
        <div className="card">
          <b>{t("Suggested mission")}</b>
          <p>{mp.title} · {mp.need} volunteers</p>
          <small className="dim">{mp.safety}</small>
          <button onClick={() => act(() => S.mission(mp.title, mp.need, i.id), "Mission created")}>{t("Create this mission")}</button>
        </div>
      )}
      <small className="dim">Prepared {ago(a.created)} · {a.source === "ai" ? "AI-assisted" : a.source === "scripted" ? "simulated demo" : "rule-based"}. Drafts are suggestions and can be edited.</small>
    </div>
  );
}
