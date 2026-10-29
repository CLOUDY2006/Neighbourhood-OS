import { useEffect, useState } from "react";
import { Flag, MapPin } from "lucide-react";
import * as S from "./store";
import { useT } from "./i18n";
import { AgentPanel } from "./AgentPanel";
import { HandoffBox } from "./Reports";
import { ago, grp, VL, type Act } from "./ui";
import { osmLink } from "./geo";

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

const NOW: Record<S.Issue["status"], string> = {
  reported: "Waiting for a coordinator to look at this report.",
  review: "A coordinator is looking at this report.",
  assigned: "Someone has been assigned to fix this.",
  progress: "Work on this problem is under way.",
  pending: "A fix was submitted. The reporter, or a different coordinator, has to confirm it.",
  resolved: "This problem was fixed and confirmed.",
};
const RESOLVED: Record<S.Closure, string> = {
  reviewer: "This problem was fixed and a reviewer approved it.",
  reporter: "This problem was fixed. The person who reported it confirmed it.",
  unconfirmed: "This report was closed without confirmation. Nobody answered in 7 days.",
};
const CHECK: Record<S.Issue["verif"], string> = {
  unverified: "Not yet checked by a coordinator.",
  review: "A coordinator is checking that this is real.",
  verified: "A coordinator confirmed this is real.",
  disputed: "A coordinator marked this as disputed.",
  resolved: "A coordinator confirmed the fix.",
};

export function Detail({ i, st, act, close }: { i: S.Issue; st: S.State; act: Act; close: () => void }) {
  const t = useT(), me = S.myName(), r = st.role;
  const [note, setNote] = useState(""), [photo, setPhoto] = useState<string>(), [prev, setPrev] = useState<string>();
  const [up, setUp] = useState({ text: "", photo: undefined as string | undefined });
  const [reason, setReason] = useState(""), [fb, setFb] = useState(""), [rnote, setRnote] = useState(""), [askSpam, setAskSpam] = useState(false);
  const mine = i.author === me;
  const next = S.STATUSES[S.STATUSES.indexOf(i.status) + 1], idx = S.STATUSES.indexOf(i.status);
  const ps = S.priorityScore(st, i), after = S.afterPhoto(i);
  const fbs = Object.values(i.feedback ?? {}), good = fbs.filter(f => f.ok).length, bad = fbs.length - good;
  const hasMore = (S.can(r, "flag") && i.status !== "resolved") || (mine && i.status === "reported" && !i.hidden) || (S.can(r, "verify") && i.status !== "resolved" && i.verif !== "disputed") || S.can(r, "hide");
  const hasVol = r === "admin" || !!i.handoff;
  const evidenceCount = i.proof.length + (i.updates ?? []).length;
  const historyCount = (i.assignments ?? []).length + i.log.length;
  const demo = S.useApp().mode === "demo", asker = i.pendingBy === me, admin = S.can(r, "advance");
  const canAnswer = S.canConfirmFix(i, me);
  const canReopen = i.status === "resolved" && i.closure === "unconfirmed" && !i.hidden && i.pendingBy !== me && S.reportersOf(i).includes(me);
  const waitDays = i.status === "pending" ? Math.max(0, Math.ceil((S.pendingSince(i) + S.UNCONFIRMED_AFTER_MS - Date.now()) / 864e5)) : 0;
  const checkLine = i.closure === "reporter" ? "The reporter confirmed the fix." : i.closure === "unconfirmed" ? "No reporter confirmed the fix." : i.verif === "review" && i.status !== "reported" && i.status !== "review" ? "A coordinator has not marked this as verified yet." : CHECK[i.verif];
  const canProof = S.can(r, "proof") && i.status !== "resolved" && i.status !== "pending";
  const proofInline = canProof && (i.status === "assigned" || i.status === "progress");
  const proofForm = (
    <div className="form">
      <b>Proof of fix</b>
      <input placeholder="Progress note or after-fix evidence" value={note} onChange={e => setNote(e.target.value)} />
      <PhotoPicker onReady={(v, p) => { setPhoto(v); setPrev(p); }} />
      <AiPhoto photo={prev} mode="proof" cat={i.cat} />
      <AiCompare issueId={i.id} hasPhoto={!!i.photo} photo={prev} />
      <button onClick={() => act(async () => { await S.addProof(i.id, note, photo); setNote(""); setPhoto(undefined); setPrev(undefined); }, "Evidence uploaded")}>Upload evidence</button>
    </div>
  );
  return (
    <div className="card detail">
      <button className="x back" onClick={close}>← {t("All reports")}</button>
      <strong className="dtitle">{i.title}</strong>
      <div className="chips">
        <span className="chip">{i.cat}</span>{ps.level !== "resolved" && <span className="chip">{ps.level} urgency</span>}
        <span className={`chip ${grp(i.status)}`}>{S.STATUS_LABEL[i.status]}</span>
        {i.status === "resolved" && i.closure === "unconfirmed" && <span className="chip amber">{t("Closed without confirmation")}</span>}
        {i.hidden && <span className="chip red">Hidden</span>}
        {S.can(r, "hide") && i.flags.length > 0 && <span className="chip amber">{i.flags.length} flag(s)</span>}
      </div>
      {r === "admin" && (
        <div className="row wrap">
          <button className="x" onClick={() => window.open(osmLink(i.lat, i.lng), "_blank", "noopener,noreferrer")} title={t("Opens the exact spot on OpenStreetMap in a new tab. It is the same link as in the complaint draft.")}>
            <MapPin size={14} aria-hidden="true" /> {t("Open location in OpenStreetMap")}
          </button>
        </div>
      )}
      {!mine && !i.hidden && (
        i.flags.includes(me)
          ? <small className="dim">{t("Thanks. You reported this one.")}</small>
          : askSpam
            ? (
              <div className="card alertcard">
                <b>{t("Report this as spam or a wrong report?")}</b>
                <small className="dim">{t("Use this for fake, joke, duplicate or abusive reports. Coordinators will look at it. If several people report it, it is hidden until a coordinator checks.")}</small>
                <div className="row wrap">
                  <button className="warn" onClick={() => act(async () => { await S.spam(i.id); setAskSpam(false); }, "Thanks. Coordinators will look at it")}>{t("Yes, report it")}</button>
                  <button className="x" onClick={() => setAskSpam(false)}>{t("Cancel")}</button>
                </div>
              </div>
            )
            : <div className="row wrap"><button className="warn" onClick={() => setAskSpam(true)}><Flag size={14} aria-hidden="true" /> {t("Report spam or wrong report")}</button></div>
      )}
      <div className="statnow">
        <b>{t(i.status === "resolved" && i.closure ? RESOLVED[i.closure] : NOW[i.status])}</b>
        <small className="dim">{t(checkLine)} {i.reports} {t(i.reports === 1 ? "person has reported this." : "people have reported this.")}</small>
      </div>
      <div className="steps">{S.STATUSES.map((s, n) => <i key={s} className={n <= idx ? "on" : ""} title={S.STATUS_LABEL[s]} />)}</div>
      <small className="dim">{t("Step")} {idx + 1}/{S.STATUSES.length} · {S.STATUS_LABEL[i.status]}</small>
      <p>{i.desc}</p>
      {i.photo && !after && <Photo src={i.photo} alt="Reported issue" />}
      {i.photo && after && <BeforeAfter before={i.photo} after={after} />}

      {canAnswer && (
        <div className="card alertcard">
          <b>{t("Is the problem fixed?")}</b>
          <p>{t("The team says this is done. You reported this problem (or confirmed it), so your answer counts: if you say it is fixed, the report is resolved.")}</p>
          <input placeholder={t("Optional comment")} maxLength={200} value={rnote} onChange={e => setRnote(e.target.value)} aria-label="Your comment" />
          <div className="row wrap">
            <button className="go" onClick={() => act(async () => { await S.reporterConfirm(i.id, true, rnote); setRnote(""); }, "Thanks. The report is resolved")}>{t("Yes, it is fixed")}</button>
            <button className="warn" onClick={() => act(async () => { await S.reporterConfirm(i.id, false, rnote); setRnote(""); }, "Thanks. The report goes back in progress")}>{t("No, not fully fixed")}</button>
          </div>
        </div>
      )}
      {canReopen && (
        <div className="card alertcard">
          <b>{t("This report was closed without confirmation.")}</b>
          <p>{t("Nobody answered, so a coordinator closed it. If the problem is still there, you can reopen it.")}</p>
          <div className="row wrap"><button className="warn" onClick={() => act(() => S.reporterConfirm(i.id, false), "Reopened. It is back in progress")}>{t("It is still broken. Reopen it")}</button></div>
        </div>
      )}
      {i.status === "pending" && (
        <div className="card alertcard">
          <b>{S.STATUS_LABEL.pending}</b>
          <small className="dim">Submitted for review by {i.pendingBy}. The reporter, or a different coordinator, must confirm it.</small>
          {fbs.length > 0 && <p>Neighbor feedback: {good} say it looks fixed, {bad} say it is not fully fixed.</p>}
          {S.can(r, "approveResolution") && (
            <>
              <input placeholder="Reason, needed if you request more work" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} aria-label="Review note" />
              <div className="row wrap">
                <button className="go" disabled={i.pendingBy === me} onClick={() => act(() => S.approveResolution(i.id, reason), "Resolution approved")}>Approve resolution</button>
                <button className="warn" disabled={!reason.trim()} onClick={() => act(async () => { await S.rejectResolution(i.id, reason); setReason(""); }, "Sent back for more work")}>Request more work</button>
              </div>
              {asker && <small className="dim">{t("You submitted this fix, so you cannot approve it yourself. The reporters were asked. A different coordinator can approve it too.")}</small>}
              {asker && (
                <div className="row wrap">
                  <button disabled={waitDays > 0} onClick={() => act(() => S.closeUnconfirmed(i.id), "Closed without confirmation")}>{t("Close without confirmation")}</button>
                  {waitDays > 0 && <small className="dim">{t("Possible after 7 days without an answer.")} ({waitDays} {t("days left")})</small>}
                </div>
              )}
              {asker && demo && (
                <div className="row wrap">
                  <button onClick={() => act(() => S.demoAnswerAsReporter(i.id, true, "Looks good now"), "Simulated: the reporter confirmed the fix")}>{t("Demo: answer as the reporter")}</button>
                  <button onClick={() => act(() => S.demoAnswerAsReporter(i.id, false, "Still not fixed on the left side"), "Simulated: the reporter says it is not fully fixed")}>{t("Demo: reporter says not fixed")}</button>
                  <button onClick={() => S.demoSkipWait(i.id)}>{t("Demo: skip the 7-day wait")}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {i.status !== "pending" && i.status !== "resolved" && !i.hidden && (
        <div className="card nextstep">
          <b>{t("What happens next")}</b>
          {i.status === "reported" && <p>{admin ? t("Check that this report is real, then start the review.") : t("A coordinator needs to start the review. If you see this problem too, confirm it with the button below.")}</p>}
          {i.status === "review" && <p>{admin ? t("Decide who will fix it, then mark it as assigned.") : t("A coordinator is deciding who will fix this.")}</p>}
          {i.status === "assigned" && <p>{proofInline ? t("When the fix is done, add a photo or note as proof. This moves it to In progress.") : t("Someone is assigned. Waiting for the work to start.")}</p>}
          {i.status === "progress" && <p>{proofInline ? (i.proof.length ? t("Proof was added. You can add more.") : t("Add a photo or note as proof of the fix.")) : t("Work is under way. A coordinator will submit the fix for review when it is done.")}</p>}
          {proofInline && proofForm}
          {admin && <div className="row wrap">
            {admin && i.status === "reported" && <button className="go" onClick={() => act(() => S.advance(i.id), "Moved to Under review")}>{t("Start review")}</button>}
            {admin && i.status === "review" && <button className="go" onClick={() => act(() => S.advance(i.id), "Moved to Assigned")}>{t("Mark as assigned")}</button>}
            {admin && i.status === "assigned" && <button onClick={() => act(() => S.advance(i.id), "Moved to In progress")}>{t("Mark work as started")}</button>}
            {admin && i.status === "progress" && <button className="go" disabled={!i.proof.length} onClick={() => act(() => S.advance(i.id), "Fix submitted for review")}>{t("Submit fix for review")}</button>}
          </div>}
          {admin && i.status === "progress" && !i.proof.length && <small className="dim">{t("Add proof first, then you can submit it.")}</small>}
          {!admin && i.status === "progress" && i.proof.length > 0 && <small className="dim">{t("Proof was added. A coordinator will submit the fix for review.")}</small>}
        </div>
      )}
      {(i.status === "pending" || i.status === "resolved") && !i.hidden && !canAnswer && (
        <div className="card">
          <b>Does it look fixed?</b>
          <input placeholder="Optional comment" maxLength={200} value={fb} onChange={e => setFb(e.target.value)} aria-label="Feedback comment" />
          <div className="row wrap">
            <button className={`choice ${i.feedback?.[me]?.ok === true ? "on" : ""}`} aria-pressed={i.feedback?.[me]?.ok === true} onClick={() => act(async () => { await S.feedback(i.id, true, fb); setFb(""); }, "Thanks for the feedback")}>It looks fixed</button>
            <button className={`choice ${i.feedback?.[me]?.ok === false ? "on" : ""}`} aria-pressed={i.feedback?.[me]?.ok === false} onClick={() => act(async () => { await S.feedback(i.id, false, fb); setFb(""); }, "Thanks. Reviewers will see this")}>Not fully fixed</button>
          </div>
          {fbs.length > 0 && <small className="dim">{good} say fixed · {bad} say not fully fixed</small>}
        </div>
      )}


      <div className="row wrap">
        {S.can(r, "merge") && !mine && !i.hidden && i.status !== "resolved" && <button onClick={() => act(() => S.merge(i.id), "Added your confirmation")}>I see this too</button>}
        {S.can(r, "verify") && i.status !== "resolved" && i.verif !== "verified" && <button onClick={() => act(() => S.setVerif(i.id, "verified"), "Marked verified")}>Mark verified</button>}
        {S.can(r, "flag") && i.status === "resolved" && <button className="warn" onClick={() => act(() => S.flag(i.id), "Flag sent to coordinators")}>Not fully fixed (reopen)</button>}
      </div>
      {hasMore && (
        <details className="fold">
          <summary>{t("More options")}</summary>
          <div className="foldbody"><div className="row wrap">
        {S.can(r, "flag") && i.status !== "resolved" && <button className="warn" onClick={() => act(() => S.flag(i.id), "Flag sent to coordinators")}>Flag for attention</button>}
        {mine && i.status === "reported" && !i.hidden && <button className="warn" onClick={() => act(() => S.withdraw(i.id), "Report withdrawn")}>Withdraw my report</button>}
        {S.can(r, "verify") && i.status !== "resolved" && i.verif !== "disputed" && <button className="warn" onClick={() => act(() => S.setVerif(i.id, "disputed"), "Marked disputed")}>Mark disputed</button>}
        {S.can(r, "hide") && (i.hidden ? <button onClick={() => act(() => S.restore(i.id), "Report restored")}>Restore report</button> : <button className="warn" onClick={() => act(() => S.hide(i.id), "Report hidden")}>Hide report</button>)}
          </div></div>
        </details>
      )}

      <AgentPanel i={i} st={st} act={act} />

      <details className="fold">
        <summary>{ps.level === "resolved" ? t("Priority details") : `${t("How urgent")}: ${ps.level} (${ps.score}/100)`}</summary>
        <ul className="why">{ps.reasons.map((x, n) => <li key={n}>{x.label}: +{x.pts}</li>)}</ul>
        <small className="dim">A fixed set of rules adds these points. It only sorts the list. A coordinator decides what happens.</small>
      </details>

      {evidenceCount > 0 || (S.can(r, "proof") && i.status !== "resolved" && i.status !== "pending") || (!i.hidden && i.status !== "resolved") ? (
        <details className="fold" open={i.status === "pending"}>
          <summary>{t("Evidence and updates")}{evidenceCount > 0 ? ` (${evidenceCount})` : ""}</summary>
          <div className="foldbody">
      {i.proof.length > 0 && <div><b>Proof of fix</b>{i.proof.map((p, n) => <div key={n} className="proof">{p.photo && !i.photo && <Photo src={p.photo} alt="Evidence" />}<span>{p.text || "Photo evidence"} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}
      {(i.updates ?? []).length > 0 && <div><b>Updates and evidence from neighbors</b>{(i.updates ?? []).map((p, n) => <div key={n} className="proof">{p.photo && <Photo src={p.photo} alt="Update" />}<span>{p.text || "Photo"} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}
      {canProof && !proofInline && proofForm}
      {!i.hidden && i.status !== "resolved" && (
        <div className="form">
          <b>Add an update or evidence</b>
          <input placeholder="What changed? (no names or phone numbers)" maxLength={500} value={up.text} onChange={e => setUp({ ...up, text: e.target.value })} />
          <PhotoPicker onReady={v => setUp(u => ({ ...u, photo: v }))} />
          <button onClick={() => act(async () => { await S.addUpdate(i.id, up.text, up.photo); setUp({ text: "", photo: undefined }); }, "Update added")}>Add update</button>
        </div>
      )}

          </div>
        </details>
      ) : null}
      {hasVol && (
        <details className="fold">
          <summary>{t("Hand-off to authority")}</summary>
          <div className="foldbody">
      {r === "admin" && <HandoffBox i={i} st={st} act={act} />}
      {r !== "admin" && i.handoff && <p className="dim">Passed to {i.handoff.to} ({i.handoff.status.replace("_", " ")}).</p>}

          </div>
        </details>
      )}
      {historyCount > 0 && (
        <details className="fold">
          <summary>{t("History")} ({historyCount})</summary>
          <div className="foldbody">
      {(i.assignments ?? []).length > 0 && (
        <div><b>Assignment history</b>{(i.assignments ?? []).map((a, n) => <div key={n} className="ev"><span className="mono">{ago(a.t)}</span> {a.text}</div>)}</div>
      )}
      <div className="log">{[...i.log].reverse().map((l, n) => <div key={n}><span className="mono">{ago(l.t)}</span> {l.by}: {l.text}</div>)}</div>
          </div>
        </details>
      )}
    </div>
  );
}