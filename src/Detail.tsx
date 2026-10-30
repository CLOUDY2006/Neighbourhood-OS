import { useEffect, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Flag, MapPin, ShieldAlert, ShieldCheck, ThumbsUp, Undo2 } from "lucide-react";
import * as S from "./store";
import { useT } from "./i18n";
import { AgentPanel } from "./AgentPanel";
import { HandoffBox } from "./Reports";
import { ago, grp, VL, type Act } from "./ui";
import { osmLink } from "./geo";

export function readPhoto(f: File): Promise<string> {
  return new Promise((res, rej) => {
    if (f.type !== "image/jpeg") return rej(new Error("This looks like an image from the internet or a screenshot. Please upload a real photo you took yourself."));
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
    const input = e.currentTarget, f = input.files?.[0]; if (!f) return;
    try { const d = await readPhoto(f); onReady(live ? await S.uploadPhoto(d) : d, d); } catch (err) { input.value = ""; alert((err as Error).message); }
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

type Tab = "overview" | "complaint" | "activity";

export function Detail({ i, st, act, close }: { i: S.Issue; st: S.State; act: Act; close: () => void }) {
  const t = useT(), me = S.myName(), r = st.role;
  const [note, setNote] = useState(""), [photo, setPhoto] = useState<string>(), [prev, setPrev] = useState<string>();
  const [up, setUp] = useState({ text: "", photo: undefined as string | undefined });
  const [reason, setReason] = useState(""), [fb, setFb] = useState(""), [rnote, setRnote] = useState(""), [askSpam, setAskSpam] = useState(false), [tab, setTab] = useState<Tab>("overview");
  const [done, setDone] = useState<string[]>([]);
  // A new report was opened: forget the ticks and tab of the previous one.
  useEffect(() => { setDone([]); setTab("overview"); setAskSpam(false); }, [i.id]);
  /** Runs a button's action. When it worked, the message is kept in the "You just did" list, so a button that disappears still leaves a tick. */
  const run: Act = (fn, ok) => act(async () => { await fn(); if (ok) setDone(d => [ok, ...d.filter(x => x !== ok)].slice(0, 3)); }, ok);
  const mine = i.author === me;
  const next = S.STATUSES[S.STATUSES.indexOf(i.status) + 1], idx = S.STATUSES.indexOf(i.status);
  const ps = S.priorityScore(st, i), after = S.afterPhoto(i);
  const fbs = Object.values(i.feedback ?? {}), good = fbs.filter(f => f.ok).length, bad = fbs.length - good;
  const evidenceCount = i.proof.length + (i.updates ?? []).length;
  const historyCount = (i.assignments ?? []).length + i.log.length;
  const demo = S.useApp().mode === "demo", asker = i.pendingBy === me, admin = S.can(r, "advance");
  const canAnswer = S.canConfirmFix(i, me);
  const canReopen = i.status === "resolved" && i.closure === "unconfirmed" && !i.hidden && i.pendingBy !== me && S.reportersOf(i).includes(me);
  const waitDays = i.status === "pending" ? Math.max(0, Math.ceil((S.pendingSince(i) + S.UNCONFIRMED_AFTER_MS - Date.now()) / 864e5)) : 0;
  const checkLine = i.closure === "reporter" ? "The reporter confirmed the fix." : i.closure === "unconfirmed" ? "No reporter confirmed the fix." : i.verif === "review" && i.status !== "reported" && i.status !== "review" ? "A coordinator has not marked this as verified yet." : CHECK[i.verif];
  const canProof = S.can(r, "proof") && i.status !== "resolved" && i.status !== "pending";
  const proofInline = canProof && (i.status === "assigned" || i.status === "progress");
  const checks = (i.verifiedBy ?? []).length, iChecked = (i.verifiedBy ?? []).includes(me) && checks < S.COORDS_TO_VERIFY, manyChecks = S.COORDS_TO_VERIFY > 1;
  const canVerify = S.can(r, "verify") && i.status !== "resolved" && i.verif !== "verified";
  const showComplaint = admin || mine || !!i.agent;
  const flaggedByMe = i.log.some(l => l.by === me && l.text.startsWith("Flagged for coordinator attention"));
  const Tick = ({ children, title }: { children: React.ReactNode; title?: string }) => <button className="ticked" disabled title={title} aria-pressed="true"><Check size={15} aria-hidden="true" /> {children}</button>;
  const proofForm = (
    <div className="form">
      <b>{t("Proof of fix")}</b>
      <input placeholder={t("Progress note or after-fix evidence")} value={note} onChange={e => setNote(e.target.value)} />
      <PhotoPicker onReady={(v, p) => { setPhoto(v); setPrev(p); }} />
      <AiPhoto photo={prev} mode="proof" cat={i.cat} />
      <AiCompare issueId={i.id} hasPhoto={!!i.photo} photo={prev} />
      <button onClick={() => run(async () => { await S.addProof(i.id, note, photo); setNote(""); setPhoto(undefined); setPrev(undefined); }, "Evidence uploaded")}>{t("Upload evidence")}</button>
    </div>
  );
  /** The one button a coordinator presses to move the report to its next step. */
  const stepBtn = i.hidden ? null : i.status === "reported" ? { label: "Start review", msg: "Moved to Under review", ok: true }
    : i.status === "review" ? { label: "Mark as assigned", msg: "Moved to Assigned", ok: true }
    : i.status === "assigned" ? { label: "Mark work as started", msg: "Moved to In progress", ok: true }
    : i.status === "progress" ? { label: "Submit fix for review", msg: "Fix submitted for review", ok: i.proof.length > 0 } : null;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: t("Overview") },
    ...(showComplaint ? [{ id: "complaint" as Tab, label: admin ? t("Authority") : t("Complaint") }] : []),
    { id: "activity", label: t("Activity"), count: evidenceCount + historyCount },
  ];
  const tabNow: Tab = tabs.some(x => x.id === tab) ? tab : "overview";
  return (
    <div className="card detail">
      <button className="x back" onClick={close}>← {t("All reports")}</button>

      <div className="dhead">
        <strong className="dtitle">{i.title}</strong>
        <div className="chips">
          <span className="chip">{i.cat}</span>{ps.level !== "resolved" && <span className="chip">{ps.level} {t("urgency")}</span>}
          <span className={`chip ${grp(i.status)}`}>{S.STATUS_LABEL[i.status]}</span>
          {i.verif === "verified" && <span className="chip green"><ShieldCheck size={12} aria-hidden="true" /> {t("Verified")}</span>}
          {i.status === "resolved" && i.closure === "unconfirmed" && <span className="chip amber">{t("Closed without confirmation")}</span>}
          {i.hidden && <span className="chip red">{t("Hidden")}</span>}
        </div>
      </div>

      {admin && (
        <section className="cbar" aria-label={t("Coordinator actions")}>
          <div className="cbar-title"><ShieldCheck size={15} aria-hidden="true" /> {t("Coordinator actions")}</div>
          {i.hidden && <small className="errtext">{t("This report is hidden from residents. Press Restore to show it again.")}</small>}
          {stepBtn && (
            <>
              <button className="go cbar-main" disabled={!stepBtn.ok} onClick={() => run(() => S.advance(i.id), stepBtn.msg)}>{t(stepBtn.label)} <ArrowRight size={16} aria-hidden="true" /></button>
              {i.status === "progress" && !i.proof.length && <small className="dim">{t("Add proof first, then you can submit it.")}</small>}
            </>
          )}
          <div className="cbar-tools">
            {S.can(r, "verify") && i.status !== "resolved" && (i.verif === "verified"
              ? <Tick title={t("A coordinator verified this report.")}>{t("Verified")}</Tick>
              : iChecked
                ? <Tick title={t("You checked this report. Another coordinator must verify it too.")}>{t("You verified")} <span className="cnt">{checks}/{S.COORDS_TO_VERIFY}</span></Tick>
                : <button onClick={() => run(() => S.setVerif(i.id, "verified"), checks + 1 >= S.COORDS_TO_VERIFY ? "Report verified" : "Checked. Another coordinator must verify it too")} title={t("Confirm that this report is real. One coordinator is enough.")}>
                    <ShieldCheck size={15} aria-hidden="true" /> {t("Verify")}{manyChecks && <> <span className="cnt">{checks}/{S.COORDS_TO_VERIFY}</span></>}
                  </button>)}
            {S.can(r, "hide") && (i.hidden
              ? <><Tick title={t("This report is hidden from residents.")}>{t("Hidden")}</Tick><button onClick={() => run(() => S.restore(i.id), "Report restored")}><Eye size={15} aria-hidden="true" /> {t("Restore")}</button></>
              : <button className="warn" onClick={() => run(() => S.hide(i.id), "Report hidden")}><EyeOff size={15} aria-hidden="true" /> {t("Hide report")}</button>)}
            {S.can(r, "spam") && !mine && !i.hidden && (i.flags.includes(me)
              ? <Tick title={t("You flagged this report. One more coordinator must flag it to delete it.")}>{t("You flagged spam")} <span className="cnt">{i.flags.length}/{S.SPAM_FLAGS_TO_HIDE}</span></Tick>
              : <button className="warn" aria-label={t("Report spam or wrong report")} title={t("Report spam or wrong report")} onClick={() => setAskSpam(v => !v)}>
                  <Flag size={15} aria-hidden="true" /> {t("Spam")} <span className="cnt">{i.flags.length}/{S.SPAM_FLAGS_TO_HIDE}</span>
                </button>)}
            {S.can(r, "verify") && i.status !== "resolved" && (i.verif === "disputed"
              ? <Tick title={t("A coordinator marked this report as disputed.")}>{t("Marked disputed")}</Tick>
              : <button className="warn" onClick={() => run(() => S.setVerif(i.id, "disputed"), "Marked disputed")}><ShieldAlert size={15} aria-hidden="true" /> {t("Disputed")}</button>)}
            <button onClick={() => window.open(osmLink(i.lat, i.lng), "_blank", "noopener,noreferrer")} title={t("Opens the exact spot on OpenStreetMap in a new tab. It is the same link as in the complaint draft.")} aria-label={t("Open location in OpenStreetMap")}>
              <MapPin size={15} aria-hidden="true" /> {t("Map")}
            </button>
          </div>
          {canVerify && iChecked && <small className="dim">{t("You checked this report. Waiting for another coordinator to verify it.")}</small>}
          {S.can(r, "spam") && !mine && !i.hidden && i.flags.includes(me) && <small className="dim">{t("You flagged this one. One more coordinator must flag it to delete it.")}</small>}
          {askSpam && S.can(r, "spam") && !mine && !i.hidden && !i.flags.includes(me) && (
            <div className="card alertcard">
              <b>{t("Report this as spam or a wrong report?")}</b>
              <small className="dim">{t("Use this for fake, joke, duplicate or abusive reports. The report is deleted for good once two different coordinators have flagged it.")}</small>
              <div className="row wrap">
                <button className="warn" onClick={() => run(async () => { await S.spam(i.id); setAskSpam(false); }, "Flagged. One more coordinator must flag it to delete it")}>{t("Yes, report it")}</button>
                <button className="x" onClick={() => setAskSpam(false)}>{t("Cancel")}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {(S.can(r, "merge") && !i.hidden && i.status !== "resolved") || (S.can(r, "flag") && i.status !== "resolved") || (mine && i.status === "reported" && !i.hidden) || (S.can(r, "flag") && i.status === "resolved") ? (
        <div className="actions" aria-label={t("What you can do")}>
          {S.can(r, "merge") && !i.hidden && i.status !== "resolved" && (mine
            ? <Tick title={t("Your report counts as the first confirmation. A coordinator still has to verify it.")}>{t("You reported this")}</Tick>
            : i.confirmedBy.includes(me)
              ? <Tick title={t("Your confirmation was added (+1 report).")}>{t("You confirmed this")}</Tick>
              : <button className="go" onClick={() => run(() => S.merge(i.id), "Added your confirmation")}><ThumbsUp size={15} aria-hidden="true" /> {t("I see this too")}</button>)}
          {S.can(r, "flag") && i.status !== "resolved" && (flaggedByMe
            ? <Tick title={t("The coordinators were asked to look at this report again.")}>{t("Flagged for attention")}</Tick>
            : <button onClick={() => run(() => S.flag(i.id), "Flag sent to coordinators")} title={t("Ask the coordinators to look at this report again")}><Flag size={15} aria-hidden="true" /> {t("Flag for attention")}</button>)}
          {mine && i.status === "reported" && !i.hidden && <button onClick={() => run(() => S.withdraw(i.id), "Report withdrawn")}><Undo2 size={15} aria-hidden="true" /> {t("Withdraw my report")}</button>}
          {S.can(r, "flag") && i.status === "resolved" && <button className="warn" onClick={() => run(() => S.flag(i.id), "Flag sent to coordinators")}>{t("Not fully fixed (reopen)")}</button>}
        </div>
      ) : null}

      <div className="hero">
        <b className="hnow">{t(i.status === "resolved" && i.closure ? RESOLVED[i.closure] : NOW[i.status])}</b>
        <ol className="stepper" aria-label={t("Progress")}>{S.STATUSES.map((s, n) => <li key={s} className={n < idx ? "done" : n === idx ? "now" : ""} title={S.STATUS_LABEL[s]} />)}</ol>
        <small className="dim">{t("Step")} {idx + 1}/{S.STATUSES.length}: <b>{S.STATUS_LABEL[i.status]}</b>{next ? ` · ${t("Next")}: ${S.STATUS_LABEL[next]}` : ""}</small>
        <small className="dim">{t(checkLine)} {i.reports} {t(i.reports === 1 ? "person has reported this." : "people have reported this.")}</small>
      </div>

      {i.status === "resolved" && i.closure === "reviewer" && i.reviewedBy === me && <div className="donebar"><span><Check size={14} aria-hidden="true" /> {t("You approved this fix")}</span></div>}
      {canAnswer && (
        <div className="card alertcard">
          <b>{t("Is the problem fixed?")}</b>
          <p>{t("The team says this is done. You reported this problem (or confirmed it), so your answer counts: if you say it is fixed, the report is resolved.")}</p>
          <input placeholder={t("Optional comment")} maxLength={200} value={rnote} onChange={e => setRnote(e.target.value)} aria-label="Your comment" />
          <div className="row wrap">
            <button className="go" onClick={() => run(async () => { await S.reporterConfirm(i.id, true, rnote); setRnote(""); }, "Thanks. The report is resolved")}>{t("Yes, it is fixed")}</button>
            <button className="warn" onClick={() => run(async () => { await S.reporterConfirm(i.id, false, rnote); setRnote(""); }, "Thanks. The report goes back in progress")}>{t("No, not fully fixed")}</button>
          </div>
        </div>
      )}
      {canReopen && (
        <div className="card alertcard">
          <b>{t("This report was closed without confirmation.")}</b>
          <p>{t("Nobody answered, so a coordinator closed it. If the problem is still there, you can reopen it.")}</p>
          <div className="row wrap"><button className="warn" onClick={() => run(() => S.reporterConfirm(i.id, false), "Reopened. It is back in progress")}>{t("It is still broken. Reopen it")}</button></div>
        </div>
      )}
      {i.status === "pending" && (
        <div className="card alertcard">
          <b>{S.STATUS_LABEL.pending}</b>
          <small className="dim">Submitted for review by {i.pendingBy}. The reporter, or a different coordinator, must confirm it.</small>
          {asker && <small className="oktext"><Check size={13} aria-hidden="true" /> {t("You submitted this fix for review.")}</small>}
          {fbs.length > 0 && <p>Neighbor feedback: {good} say it looks fixed, {bad} say it is not fully fixed.</p>}
          {S.can(r, "approveResolution") && (
            <>
              <input placeholder="Reason, needed if you request more work" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} aria-label="Review note" />
              <div className="row wrap">
                <button className="go" disabled={i.pendingBy === me} title={i.pendingBy === me ? t("You submitted this fix, so a different coordinator must approve it.") : undefined} onClick={() => run(() => S.approveResolution(i.id, reason), "Resolution approved")}>Approve resolution</button>
                <button className="warn" disabled={!reason.trim()} onClick={() => run(async () => { await S.rejectResolution(i.id, reason); setReason(""); }, "Sent back for more work")}>Request more work</button>
              </div>
              {asker && <small className="dim">{t("You submitted this fix, so you cannot approve it yourself. The reporters were asked. A different coordinator can approve it too.")}</small>}
              {asker && (
                <div className="row wrap">
                  <button disabled={waitDays > 0} onClick={() => run(() => S.closeUnconfirmed(i.id), "Closed without confirmation")}>{t("Close without confirmation")}</button>
                  {waitDays > 0 && <small className="dim">{t("Possible after 7 days without an answer.")} ({waitDays} {t("days left")})</small>}
                </div>
              )}
              {asker && demo && (
                <div className="row wrap">
                  <button onClick={() => run(() => S.demoAnswerAsReporter(i.id, true, "Looks good now"), "Simulated: the reporter confirmed the fix")}>{t("Demo: answer as the reporter")}</button>
                  <button onClick={() => run(() => S.demoAnswerAsReporter(i.id, false, "Still not fixed on the left side"), "Simulated: the reporter says it is not fully fixed")}>{t("Demo: reporter says not fixed")}</button>
                  <button onClick={() => S.demoSkipWait(i.id)}>{t("Demo: skip the 7-day wait")}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="donebar" role="status" aria-live="polite">
          <b>{t("You just did")}</b>
          {done.map(d => <span key={d}><Check size={14} aria-hidden="true" /> {d}</span>)}
        </div>
      )}

      <div className="tabs" role="tablist">
        {tabs.map(x => <button key={x.id} role="tab" aria-selected={tabNow === x.id} className={`tab ${tabNow === x.id ? "on" : ""}`} onClick={() => setTab(x.id)}>{x.label}{x.count ? <span className="cnt">{x.count}</span> : null}</button>)}
      </div>

      {tabNow === "overview" && (
        <div className="tabbody">
          <p className="desc">{i.desc}</p>
          {i.photo && !after && <Photo src={i.photo} alt="Reported issue" />}
          {i.photo && after && <BeforeAfter before={i.photo} after={after} />}
          {!admin && i.handoff && <p className="dim">{t("Passed to")} {i.handoff.to} ({i.handoff.status.replace("_", " ")}).</p>}
          {i.status !== "pending" && i.status !== "resolved" && !i.hidden && (
            <div className="card nextstep">
              <b>{t("What happens next")}</b>
              {i.status === "reported" && <p>{admin ? t("Check that this report is real, then start the review.") : t("A coordinator needs to start the review. If you see this problem too, confirm it with the button above.")}</p>}
              {i.status === "review" && <p>{admin ? t("Decide who will fix it, then mark it as assigned.") : t("A coordinator is deciding who will fix this.")}</p>}
              {i.status === "assigned" && <p>{proofInline ? t("When the fix is done, add a photo or note as proof. This moves it to In progress.") : t("Someone is assigned. Waiting for the work to start.")}</p>}
              {i.status === "progress" && <p>{proofInline ? (i.proof.length ? t("Proof was added. You can add more.") : t("Add a photo or note as proof of the fix.")) : t("Work is under way. A coordinator will submit the fix for review when it is done.")}</p>}
              {proofInline && proofForm}
              {!admin && i.status === "progress" && i.proof.length > 0 && <small className="dim">{t("Proof was added. A coordinator will submit the fix for review.")}</small>}
            </div>
          )}
          {(i.status === "pending" || i.status === "resolved") && !i.hidden && !canAnswer && (
            <div className="card">
              <b>{t("Does it look fixed?")}</b>
              <input placeholder={t("Optional comment")} maxLength={200} value={fb} onChange={e => setFb(e.target.value)} aria-label="Feedback comment" />
              <div className="row wrap">
                <button className={`choice ${i.feedback?.[me]?.ok === true ? "on" : ""}`} aria-pressed={i.feedback?.[me]?.ok === true} onClick={() => run(async () => { await S.feedback(i.id, true, fb); setFb(""); }, "Thanks for the feedback")}>{t("It looks fixed")}</button>
                <button className={`choice ${i.feedback?.[me]?.ok === false ? "on" : ""}`} aria-pressed={i.feedback?.[me]?.ok === false} onClick={() => run(async () => { await S.feedback(i.id, false, fb); setFb(""); }, "Thanks. Reviewers will see this")}>{t("Not fully fixed")}</button>
              </div>
              {fbs.length > 0 && <small className="dim">{good} {t("say fixed")} · {bad} {t("say not fully fixed")}</small>}
            </div>
          )}
        </div>
      )}

      {tabNow === "complaint" && showComplaint && (
        <div className="tabbody">
          <AgentPanel i={i} st={st} act={run} />
          {r === "admin" && <HandoffBox i={i} st={st} act={run} />}
        </div>
      )}

      {tabNow === "activity" && (
        <div className="tabbody">
          {i.proof.length > 0 && <div><b>{t("Proof of fix")}</b>{i.proof.map((p, n) => <div key={n} className="proof">{p.photo && !i.photo && <Photo src={p.photo} alt="Evidence" />}<span>{p.text || t("Photo evidence")} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}
          {(i.updates ?? []).length > 0 && <div><b>{t("Updates and evidence from neighbors")}</b>{(i.updates ?? []).map((p, n) => <div key={n} className="proof">{p.photo && <Photo src={p.photo} alt="Update" />}<span>{p.text || t("Photo")} <em className="dim">· {p.by} · {ago(p.t)}</em></span></div>)}</div>}
          {canProof && !proofInline && proofForm}
          {!i.hidden && i.status !== "resolved" && (
            <div className="form">
              <b>{t("Add an update or evidence")}</b>
              <input placeholder={t("What changed? (no names or phone numbers)")} maxLength={500} value={up.text} onChange={e => setUp({ ...up, text: e.target.value })} />
              <PhotoPicker onReady={v => setUp(u => ({ ...u, photo: v }))} />
              <button onClick={() => run(async () => { await S.addUpdate(i.id, up.text, up.photo); setUp({ text: "", photo: undefined }); }, "Update added")}>{t("Add update")}</button>
            </div>
          )}
          <details className="fold">
            <summary>{ps.level === "resolved" ? t("Priority details") : `${t("How urgent")}: ${ps.level} (${ps.score}/100)`}</summary>
            <ul className="why">{ps.reasons.map((x, n) => <li key={n}>{x.label}: +{x.pts}</li>)}</ul>
            <small className="dim">{t("A fixed set of rules adds these points. It only sorts the list. A coordinator decides what happens.")}</small>
          </details>
          {historyCount > 0 && (
            <details className="fold" open={evidenceCount === 0}>
              <summary>{t("History")} ({historyCount})</summary>
              <div className="foldbody">
                {(i.assignments ?? []).length > 0 && <div><b>{t("Assignment history")}</b>{(i.assignments ?? []).map((a, n) => <div key={n} className="ev"><span className="mono">{ago(a.t)}</span> {a.text}</div>)}</div>}
                <div className="log">{[...i.log].reverse().map((l, n) => <div key={n}><span className="mono">{ago(l.t)}</span> {l.by}: {l.text}</div>)}</div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}