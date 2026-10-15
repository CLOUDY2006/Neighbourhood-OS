import { useEffect, useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { AgentPanel } from "./AgentPanel";
import { HandoffBox } from "./Reports";
import { ago, grp, VL, type Act } from "./ui";

export function readPhoto(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("Could not read that image"));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("That file is not a supported image"));
      img.onload = () => {
        const c = document.createElement("canvas"), k = Math.min(1, 640 / Math.max(img.width, img.height));
        c.width = img.width * k; c.height = img.height * k;
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.7));
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(f);
  });
}

function useUrl(src?: string) {
  const [u, setU] = useState("");
  useEffect(() => {
    let on = true;
    if (!src) { setU(""); return; }
    S.photoUrl(src).then(x => { if (on) setU(x); }).catch(() => { if (on) setU(""); });
    return () => { on = false; };
  }, [src]);
  return u;
}

export function Photo({ src, alt }: { src: string; alt: string }) {
  const url = useUrl(src);
  return url ? <img className="thumb" src={url} alt={alt} /> : null;
}

export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50), b = useUrl(before), a = useUrl(after);
  if (!a || !b) return null;
  return (
    <div className="ba">
      <img src={a} alt="After the fix" className="ba-img" />
      <img src={b} alt="Before the fix" className="ba-img top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span className="ba-tag l">Before</span><span className="ba-tag r">After</span>
      <input type="range" min={0} max={100} value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Compare before and after" />
    </div>
  );
}

export function AiPhoto({ photo, mode, cat }: { photo?: string; mode: "report" | "proof"; cat?: string }) {
  const live = S.useApp().mode === "live";
  const [r, setR] = useState<{ label: string; note: string; source: string } | null>(null), [busy, setBusy] = useState(false);
  if (!photo || !live) return null;
  return (
    <div className="card ai">
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        try { setR(await S.aiPhoto(photo, mode, cat)); } catch (e) { setR({ label: "Error", note: (e as Error).message, source: "none" }); }
        setBusy(false);
      }}>{busy ? "Checking…" : "Check photo with AI"}</button>
      {r && <p><b>{r.label}</b>: {r.note} <small className="dim">({r.source === "ai" ? "AI suggestion, not a verdict" : "AI unavailable. A person will review the photo"})</small></p>}
    </div>
  );
}

function AiCompare({ issueId, hasPhoto, photo }: { issueId: string; hasPhoto: boolean; photo?: string }) {
  const live = S.useApp().mode === "live";
  const [r, setR] = useState<{ samePlace: string; fixed: string; note: string; source: string } | null>(null), [busy, setBusy] = useState(false);
  if (!live || !hasPhoto || !photo) return null;
  return (
    <div className="card ai">
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        try { setR(await S.aiCompare(issueId, photo)); } catch (e) { setR({ samePlace: "unsure", fixed: "unsure", note: (e as Error).message, source: "none" }); }
        setBusy(false);
      }}>{busy ? "Comparing…" : "Compare with the original photo (AI)"}</button>
      {r && <p>Same place: {r.samePlace}. Fixed: {r.fixed}. {r.note} <small className="dim">({r.source === "ai" ? "AI suggestion, not a verdict" : "AI unavailable. A coordinator should compare the photos"})</small></p>}
    </div>
  );
}

export function PhotoPicker({ onReady }: { onReady: (value: string, preview: string) => void }) {
  const live = S.useApp().mode === "live";
  return <input type="file" accept="image/*" aria-label="Attach a photo" onChange={async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const d = await readPhoto(f); onReady(live ? await S.uploadPhoto(d) : d, d); } catch (err) { alert((err as Error).message); }
  }} />;
}

export function Detail({ i, st, act, close }: { i: S.Issue; st: S.State; act: Act; close: () => void }) {
  const t = useT(), me = S.myName(), r = st.role;
  const [note, setNote] = useState(""), [photo, setPhoto] = useState<string>(), [prev, setPrev] = useState<string>();
  const [up, setUp] = useState({ text: "", photo: undefined as string | undefined });
  const [reason, setReason] = useState(""), [fb, setFb] = useState("");
  const m = st.missions.find(x => x.id === i.missionId), mine = i.author === me;
  const next = S.STATUSES[S.STATUSES.indexOf(i.status) + 1], idx = S.STATUSES.indexOf(i.status);
  const ps = S.priorityScore(st, i), plan = S.actionPlan(st, i), after = i.proof.find(p => p.photo)?.photo;
  const fbs = Object.values(i.feedback ?? {}), good = fbs.filter(f => f.ok).length, bad = fbs.length - good;
  return (
    <div className="card detail">
      <div className="row between"><strong>{i.title}</strong><button className="x" onClick={close}>Close</button></div>
      <div className="chips">
        <span className="chip">{i.cat}</span><span className="chip">{i.priority} priority</span>
        <span className={`chip ${grp(i.status)}`}>{S.STATUS_LABEL[i.status]}</span>
        <span className={`chip v-${i.verif}`}>{VL[i.verif]}</span>
        <span className="chip">{i.reports} report{i.reports > 1 ? "s" : ""}</span>
        {i.hidden && <span className="chip red">Hidden</span>}
        {S.can(r, "hide") && i.flags.length > 0 && <span className="chip amber">{i.flags.length} flag(s)</span>}
      </div>
      <div className="steps">{S.STATUSES.map((s, n) => <i key={s} className={n <= idx ? "on" : ""} title={S.STATUS_LABEL[s]} />)}</div>
      <details>
        <summary>Priority score {ps.score}/100 ({ps.level})</summary>
        <ul className="why">{ps.reasons.map((x, n) => <li key={n}>{x.label}: +{x.pts}</li>)}</ul>
        <small className="dim">A fixed set of rules adds these points. It only sorts the list. A coordinator decides what happens.</small>
      </details>
      <p className="dim">{i.desc}</p>
      {i.photo && !after && <Photo src={i.photo} alt="Reported issue" />}
      {i.photo && after && <BeforeAfter before={i.photo} after={after} />}
      {m && <p>Mission: <b>{m.title}</b> · {m.joined.length}/{m.need} volunteers</p>}
      {i.proof.length > 0 && <div><b>Proof of fix</b>{i.proof.map((p, n) => <div key={n} className="proof">{p.photo && !i.photo && <Photo src={p.photo} alt="Evidence" />}<span>{p.text || "Photo evidence"} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}
      {(i.updates ?? []).length > 0 && <div><b>Updates and evidence from neighbors</b>{(i.updates ?? []).map((p, n) => <div key={n} className="proof">{p.photo && <Photo src={p.photo} alt="Update" />}<span>{p.text || "Photo"} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}

      <AgentPanel i={i} st={st} act={act} />

      <details className="card">
        <summary>Action plan (a suggestion, a person approves it)</summary>
        <ol className="why">{plan.steps.map((x, n) => <li key={n}>{x}</li>)}</ol>
        <small className="dim">Department: {plan.department}. Volunteers: {plan.volunteers}. Effort: about {plan.personHours} person-hours (estimate). Time: {plan.timeline} (estimate). Materials: {plan.materials.join(", ")}.</small>
        <small className="dim">Safety: {plan.safety}</small>
        <div className="row wrap">
          {S.can(r, "actionPlanApprove") && !m && i.status !== "resolved" && <button className="go" onClick={() => act(() => S.actionPlanApprove(i.id), "Plan approved and mission created")}>Approve plan and create mission</button>}
          <button onClick={() => window.print()}>Print action plan</button>
        </div>
      </details>
      <div id="plan-print" className="print-only">
        <h2>Action plan: {i.title}</h2>
        <p>Priority score {ps.score}/100 ({ps.level}). Why: {ps.reasons.map(x => `${x.label} (+${x.pts})`).join("; ")}.</p>
        <p>Department: {plan.department}. Channel: {plan.channel}.</p>
        <ol>{plan.steps.map((x, n) => <li key={n}>{x}</li>)}</ol>
        <p>Volunteers: {plan.volunteers}. Effort: about {plan.personHours} person-hours (estimate). Time: {plan.timeline} (estimate). Materials: {plan.materials.join(", ")}.</p>
        <p>Safety: {plan.safety}</p>
        <p>Suggested by NEIGHBORHOOD OS. A coordinator must approve it before any action is taken. {i.actionPlan ? `Approved by ${i.actionPlan.approvedBy}.` : "Not approved yet."}</p>
      </div>

      {i.status === "pending" && (
        <div className="card alertcard">
          <b>{S.STATUS_LABEL.pending}</b>
          <small className="dim">Submitted for review by {i.pendingBy}. A different person must approve it.</small>
          {fbs.length > 0 && <p>Neighbor feedback: {good} say it looks fixed, {bad} say it is not fully fixed.</p>}
          {S.can(r, "approveResolution") && (
            <>
              <input placeholder="Reason, needed if you request more work" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} aria-label="Review note" />
              <div className="row wrap">
                <button className="go" disabled={i.pendingBy === me} onClick={() => act(() => S.approveResolution(i.id, reason), "Resolution approved")}>Approve resolution</button>
                <button className="warn" disabled={!reason.trim()} onClick={() => act(async () => { await S.rejectResolution(i.id, reason); setReason(""); }, "Sent back for more work")}>Request more work</button>
              </div>
              {i.pendingBy === me && <small className="dim">You asked for this review, so someone else must approve it.</small>}
            </>
          )}
        </div>
      )}
      {(i.status === "pending" || i.status === "resolved") && !i.hidden && (
        <div className="card">
          <b>Does it look fixed?</b>
          <input placeholder="Optional comment" maxLength={200} value={fb} onChange={e => setFb(e.target.value)} aria-label="Feedback comment" />
          <div className="row wrap">
            <button onClick={() => act(async () => { await S.feedback(i.id, true, fb); setFb(""); }, "Thanks for the feedback")}>It looks fixed</button>
            <button className="warn" onClick={() => act(async () => { await S.feedback(i.id, false, fb); setFb(""); }, "Thanks. Reviewers will see this")}>Not fully fixed</button>
          </div>
          {fbs.length > 0 && <small className="dim">{good} say fixed · {bad} say not fully fixed</small>}
        </div>
      )}

      <div className="row wrap">
        {S.can(r, "merge") && !mine && !i.hidden && i.status !== "resolved" && <button onClick={() => act(() => S.merge(i.id), "Added your confirmation")}>I see this too</button>}
        {S.can(r, "flag") && <button className="warn" onClick={() => act(() => S.flag(i.id), "Flag sent to coordinators")}>{i.status === "resolved" ? "Not fully fixed (reopen)" : "Flag for attention"}</button>}
        {mine && i.status === "reported" && !i.hidden && <button className="warn" onClick={() => act(() => S.withdraw(i.id), "Report withdrawn")}>Withdraw my report</button>}
        {!mine && !i.hidden && <button className="x" onClick={() => act(() => S.spam(i.id), "Thanks. Coordinators will look at it")}>Report spam or abuse</button>}
        {S.can(r, "verify") && i.status !== "resolved" && i.verif !== "verified" && <button onClick={() => act(() => S.setVerif(i.id, "verified"), "Marked verified")}>Mark verified</button>}
        {S.can(r, "verify") && i.status !== "resolved" && i.verif !== "disputed" && <button className="warn" onClick={() => act(() => S.setVerif(i.id, "disputed"), "Marked disputed")}>Mark disputed</button>}
        {S.can(r, "advance") && next && next !== "resolved" && <button className="go" onClick={() => act(() => S.advance(i.id), `Moved to ${S.STATUS_LABEL[next]}`)}>Move to {S.STATUS_LABEL[next]}</button>}
        {S.can(r, "mission") && !m && i.status !== "resolved" && <button onClick={() => act(() => S.mission(`Fix: ${i.title}`, 4, i.id), "Mission created")}>Create mission</button>}
        {S.can(r, "join") && m && !m.done && <button className="go" onClick={() => act(() => S.join(m.id), "You joined the mission")}>Join mission</button>}
        {S.can(r, "hide") && (i.hidden ? <button onClick={() => act(() => S.restore(i.id), "Report restored")}>Restore report</button> : <button className="warn" onClick={() => act(() => S.hide(i.id), "Report hidden")}>Hide report</button>)}
      </div>

      {S.can(r, "assign") && i.status !== "resolved" && st.volunteers.length > 0 && (
        <div className="card ai">
          <b>Suggested volunteers (rule-based suggestion)</b>
          {S.matchVolunteers(st, i).map(({ v, why }) => (
            <div key={v.id} className="row between"><span>{v.name}<small className="dim"> {why}</small></span>
              {m && <button onClick={() => act(() => S.assign(m.id, v.name), `${v.name} assigned`)}>Assign</button>}</div>
          ))}
          {!m && <small className="dim">Approve the action plan or create a mission first to assign volunteers.</small>}
        </div>
      )}
      {r === "admin" && <HandoffBox i={i} st={st} act={act} />}
      {r !== "admin" && i.handoff && <p className="dim">Passed to {i.handoff.to} ({i.handoff.status.replace("_", " ")}).</p>}

      {S.can(r, "proof") && i.status !== "resolved" && i.status !== "pending" && (
        <div className="form">
          <b>Proof of fix</b>
          <input placeholder="Progress note or after-fix evidence" value={note} onChange={e => setNote(e.target.value)} />
          <PhotoPicker onReady={(v, p) => { setPhoto(v); setPrev(p); }} />
          <AiPhoto photo={prev} mode="proof" cat={i.cat} />
          <AiCompare issueId={i.id} hasPhoto={!!i.photo} photo={prev} />
          <button onClick={() => act(async () => { await S.addProof(i.id, note, photo); setNote(""); setPhoto(undefined); setPrev(undefined); }, "Evidence uploaded")}>Upload evidence</button>
        </div>
      )}
      {!i.hidden && i.status !== "resolved" && (
        <div className="form">
          <b>Add an update or evidence</b>
          <input placeholder="What changed? (no names or phone numbers)" maxLength={500} value={up.text} onChange={e => setUp({ ...up, text: e.target.value })} />
          <PhotoPicker onReady={v => setUp(u => ({ ...u, photo: v }))} />
          <button onClick={() => act(async () => { await S.addUpdate(i.id, up.text, up.photo); setUp({ text: "", photo: undefined }); }, "Update added")}>Add update</button>
        </div>
      )}

      {(i.assignments ?? []).length > 0 && (
        <div><b>Assignment history</b>{(i.assignments ?? []).map((a, n) => <div key={n} className="ev"><span className="mono">{ago(a.t)}</span> {a.text}</div>)}</div>
      )}
      <div className="log">{[...i.log].reverse().map((l, n) => <div key={n}><span className="mono">{ago(l.t)}</span> {l.by}: {l.text}</div>)}</div>
      <small className="dim">{t("Status")}: {S.STATUS_LABEL[i.status]}</small>
    </div>
  );
}
