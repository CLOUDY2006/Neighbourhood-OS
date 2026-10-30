import { useEffect, useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, type Act } from "./ui";
import { ExternalLink, FileText, Mail, Send } from "lucide-react";
import { buildComplaintEmail, gmailUrl, mailtoUrl } from "./complaintMail";

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

export const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Polls a TinyFish web agent run every 3 seconds until it finishes, or gives up after `limit` polls. */
export function useTfRun<T extends { state: "running" | "done" | "failed"; error?: string }>(runId: string, poll: (id: string) => Promise<T>, limit = 60) {
  const [st, setSt] = useState<T | null>(null);
  useEffect(() => {
    if (!runId) return;
    let on = true, n = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await poll(runId);
        if (!on) return;
        if (r.state === "running" && ++n >= limit) { setSt({ state: "failed", error: "The check took too long. Try again later." } as T); return; }
        setSt(r);
        if (r.state === "running") timer = setTimeout(tick, 3000);
      } catch (e) { if (on) setSt({ state: "failed", error: (e as Error).message } as T); }
    };
    void tick();
    return () => { on = false; if (timer) clearTimeout(timer); };
  }, [runId]);
  return [st, setSt] as const;
}

function TinyFishCard({ i, admin, owns, sent, act }: { i: S.Issue; admin: boolean; owns: boolean; sent: boolean; act: Act }) {
  const t = useT(), app = S.useApp();
  const [ok, setOk] = useState(false), [city, setCity] = useState(""), [busy, setBusy] = useState(false), [res, setRes] = useState<S.TfRouteCheck | null>(null), [err, setErr] = useState("");
  const [url, setUrl] = useState(""), [runId, setRunId] = useState(""), [st, setSt] = useTfRun(runId, S.tfPollStatus), [serr, setSerr] = useState("");
  const ref = i.handoff?.ref ?? "", resolved = i.status === "resolved";

  useEffect(() => { let on = true; S.tfAvailable().then(v => { if (on) setOk(v); }); return () => { on = false; }; }, [app.mode]);

  const showRoute = owns && !resolved, showStatus = admin && sent && !!ref && !resolved;
  if (!ok || (!showRoute && !showStatus)) return null;

  const verify = async () => {
    setBusy(true); setErr("");
    try { setRes(await S.tfVerifyRoute(i.cat, city.trim())); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const start = async () => {
    setSerr(""); setSt({ state: "running" }); setRunId("");
    try { setRunId(await S.tfStartStatus(i.id, url.trim())); } catch (e) { setSt(null); setSerr((e as Error).message); }
  };
  const track = res?.links.filter(l => l.kind === "track") ?? [];

  return (
    <div className="card">
      <b>{t("TinyFish web agent")}</b>
      {showRoute && (
        <>
          <small className="dim">{t("Search the live web for your city's official complaint page, helpline and tracker. Free to run. This is a suggestion; check it before you send anything.")}</small>
          <div className="row wrap">
            <input value={city} onChange={e => setCity(e.target.value)} placeholder={app.mode === "demo" ? t("Type a real city to run it live, e.g. Dwarka, Delhi") : t("City (optional)")} maxLength={80} aria-label={t("City")} />
            <button disabled={busy} onClick={verify}>{busy ? t("Reading official pages…") : t("Verify this route with TinyFish")}</button>
          </div>
          {err && <small className="errtext">{err}</small>}
          {res && (
            <div className="foldbody">
              {res.simulated && <small className="errtext">{t("Simulated example. No real website was read.")}</small>}
              <small className="dim">{t("City searched")}: {res.city}{res.region ? ` (${res.region})` : ""}</small>
              {res.sources.map(r => (
                <small key={r.url} className="dim">
                  <a href={r.url} {...ext}>{r.title || r.url}</a> · {r.official ? t("Government website") : t("Not confirmed as official")}
                </small>
              ))}
              {res.helplines.length > 0 && <small className="dim">{t("Helpline numbers found on the pages")}: {res.helplines.map(h => h.value).join(", ")}</small>}
              {res.emails.length > 0 && <small className="dim">{t("Email addresses found")}: {res.emails.map(h => h.value).join(", ")}</small>}
              {res.links.map(l => <small key={l.url} className="dim"><a href={l.url} {...ext}>{l.label}</a> · {l.kind === "track" ? t("Track a complaint") : t("Complaint page")}</small>)}
              <small className="dim">{res.note}</small>
              {track.length > 0 && showStatus && <div className="row wrap">{track.map(l => <button key={l.url} className="chip btn" onClick={() => setUrl(l.url)}>{t("Use this tracker")}: {l.label.slice(0, 30)}</button>)}</div>}
            </div>
          )}
        </>
      )}
      {showStatus && (
        <>
          <b>{t("Check complaint status")}</b>
          <small className="dim">{t("A TinyFish web agent opens the public tracker page and looks up your reference number. It only reads. It never logs in or files anything. It uses TinyFish credits.")}</small>
          <small className="dim">{t("Reference number")}: {ref}</small>
          <div className="row wrap">
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" maxLength={300} aria-label={t("Tracker page address")} />
            <button disabled={!url.trim() || st?.state === "running"} onClick={start}>{st?.state === "running" ? t("Checking…") : t("Check status")}</button>
          </div>
          {serr && <small className="errtext">{serr}</small>}
          {st?.state === "running" && <small className="dim">{t("The agent is working on the website. This can take up to two minutes.")}{st.streamingUrl ? <> <a href={st.streamingUrl} {...ext}>{t("Watch it live")}</a></> : null}</small>}
          {st?.state === "failed" && <small className="errtext">{st.error || t("The check did not finish.")}</small>}
          {st?.state === "done" && (
            <div className="foldbody">
              {st.simulated && <small className="errtext">{t("Simulated example. No real portal was visited.")}</small>}
              {st.found
                ? <p><b>{st.status || t("No status text")}</b>{st.lastUpdated ? <small className="dim"> · {st.lastUpdated}</small> : null}</p>
                : <p>{t("The agent could not find a status for this number.")}</p>}
              {st.remarks && <small className="dim">{st.remarks}</small>}
              <small className="dim">{t("This is what the website showed, read by an AI agent. Check the page yourself before relying on it.")}</small>
              {st.suggest && i.handoff?.status !== st.suggest && (
                <button onClick={() => act(() => S.handoffStatus(i.id, st.suggest!), "Status recorded")}>{t("Record as")}: {st.suggest === "resolved" ? t("Resolved by the authority") : t("Acknowledged by the authority")}</button>
              )}
            </div>
          )}
        </>
      )}
      <small className="dim">{t("Powered by TinyFish")}</small>
    </div>
  );
}

export function AgentPanel({ i, st, act }: { i: S.Issue; st: S.State; act: Act }) {
  const t = useT(), app = S.useApp(), demo = app.mode === "demo", me = S.myName(), admin = st.role === "admin", owns = admin || i.author === me;
  const a = i.agent;
  const [ed, setEd] = useState<{ subject: string; body: string } | null>(null), [ref, setRef] = useState("");
  const [fb, setFb] = useState(false), [opened, setOpened] = useState(false), [mailOk, setMailOk] = useState<boolean | null>(null), [to, setTo] = useState(""), [edited, setEdited] = useState(false), [sug, setSug] = useState<S.AuthoritySuggestions | null>(null), [reply, setReply] = useState(""), [rref, setRref] = useState(""), [rstat, setRstat] = useState<"" | "acknowledged" | "resolved">("");
  const resolved = i.status === "resolved";
  useEffect(() => {
    let on = true;
    if (admin && !demo && !sent && !resolved) S.authoritySuggestions(i.cat).then(v => { if (on) setSug(v); });
    return () => { on = false; };
  }, [i.cat, admin, demo, app.mode]);
  useEffect(() => { let on = true; S.emailAvailable().then(v => { if (on) setMailOk(v); }); return () => { on = false; }; }, [app.mode]);

  if (!a) {
    if (!owns || resolved) return null;
    return (
      <div className="card">
        <b>{t("AI agent")}</b>
        <small className="dim">The agent understands the report, picks the complaint route, and drafts the complaint. You approve every step.</small>
        <button className="go" onClick={() => act(async () => {
          const text = `${i.title}. ${i.desc}`, an = await S.agentAnalyze(text);
          await S.agentStart(i.id, an.lang, text, an.summaryEn, an.source);
        }, "The agent prepared a complaint draft")}>{t("Start the AI agent")}</button>
      </div>
    );
  }

  const w = S.workflow(st, i), route = S.routeFor(i.cat), d = a.draft, sent = !!d.sentAt, approved = !!d.approvedAt;
  const last = a.history[a.history.length - 1], pending = !!last && d.level > last.level && !resolved;
  const next = route.ladder[d.level];
  const text = `${ed?.subject ?? d.subject}\n\n${ed?.body ?? d.body}`;
  const needsAction = !resolved && ((owns && !sent) || pending);
  const mailable = (st.authorities ?? []).filter(x => !!x.email), pick = mailable.find(x => x.name === d.to) ?? (mailable.length === 1 ? mailable[0] : undefined);
  // The address starts as the neighbourhood's own directory entry, else the best official address for the area. Anything typed wins.
  const offered = sug?.entries ?? [], shown = edited ? to : (pick?.email || offered[0]?.email || "");
  const toAddr = shown.trim(), toOk = S.isEmail(toAddr), chosen = offered.find(x => x.email.toLowerCase() === toAddr.toLowerCase());
  const setAddr = (v: string) => { setTo(v); setEdited(true); };
  const canOwn = admin && !demo && !sent && !resolved, canServer = canOwn && mailOk === true;
  const mailWhy = !demo && !sent && !resolved && approved && !admin ? "Only a coordinator can email a complaint to an authority." : "";
  const mail = canOwn && toOk && !ed ? buildComplaintEmail(i, app.nbhd?.name ?? "", ref) : null;
  /** Opens the coordinator's own email, filled in. Approval is saved at the same time, and nothing is sent until they press Send there. */
  const openOwn = (kind: "gmail" | "app") => {
    if (!mail) return;
    if (!approved) void act(() => S.agentApprove(i.id));
    setOpened(true);
    if (kind === "gmail") {
      const w = window.open(gmailUrl(toAddr, mail.subject, mail.text), "_blank");
      if (w) { try { w.opener = null; } catch { /* ignore */ } } else setFb(true); // pop-up blocked: show the written complaint instead
    }
    else window.location.href = mailtoUrl(toAddr, mail.subject, mail.text);
  };
  const blockedHint = <small className="dim">{t("If Gmail did not open (a pop-up may have been blocked), copy the complaint below and send it from your own email, or file it on the portal.")}</small>;
  const sendMail = () => act(async () => {
    if (!approved) await S.agentApprove(i.id);
    await S.agentEmail(i.id, toAddr, ref);
  }, `Emailed to ${toAddr}`);

  return (
    <details className="card agent fold" open={needsAction}>
      <summary>{t("AI agent")} · {w.done}/{w.total}{w.steps[w.current] ? ` · ${t("Next")}: ${t(w.steps[w.current].label)}` : ""}</summary>
      <div className="foldbody">
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

      {!canOwn && <TinyFishCard i={i} admin={admin} owns={owns} sent={sent} act={act} />}

      <b>{canOwn ? t("Send the complaint") : t("Complaint draft")}{d.level > 0 ? ` (${t("Escalation")} ${d.level})` : ""}</b>
      <small className="dim">To: {d.to}</small>
      {pending && <p className="errtext">{t("Escalation ready")}: review and approve it to send to {d.to}.</p>}
      {!resolved && owns && !sent && (
        <div className="row wrap">
          {(["en", "hi"] as const).map(l => <button key={l} className={`chip btn ${d.lang === l ? "sel" : ""}`} onClick={() => act(async () => { setEd(null); await S.agentDraft(i.id, { lang: l }); })}>{l === "en" ? "English" : "हिन्दी"}</button>)}
        </div>
      )}
      {!sent && owns && !resolved ? (
        <div className="form">
          {canOwn && (
            <div className="card mailbox">
              <div className="mhead">
                <span className="mico" aria-hidden="true"><Mail size={18} /></span>
                <div><b>{t("Send this complaint by email")}</b><small className="dim">{t("Gmail or your email app opens with the complaint, subject and map link already filled in. You press Send there, so it goes from your own address and replies come to your inbox.")}</small></div>
              </div>
              {mailable.length > 0 && (
                <select value={shown} onChange={e => setAddr(e.target.value)} aria-label={t("Authority")}>
                  <option value="">{t("Choose an authority from the directory…")}</option>
                  {mailable.map(x => <option key={x.id} value={x.email}>{x.name} · {x.email}</option>)}
                </select>
              )}
              {offered.length > 0 && (
                <div className="card">
                  <b>{t("Official addresses for")} {[sug?.place.city, sug?.region ?? sug?.place.state].filter(Boolean).join(", ")}</b>
                  <div className="row wrap">
                    {offered.map(x => <button key={x.id} className={chosen?.id === x.id ? "go" : ""} onClick={() => setAddr(x.email)} aria-pressed={chosen?.id === x.id}>{x.name}</button>)}
                  </div>
                  {chosen && (
                    <small className="dim">
                      {chosen.note} {chosen.phone ? `${t("Helpline")}: ${chosen.phone}. ` : ""}
                      {chosen.via === "official" ? t("Published on the office's own website") : t("Listed in official filed records, so check it on the office's website")}, {t("checked")} {chosen.checked}.{" "}
                      <a href={chosen.source} target="_blank" rel="noopener noreferrer">{t("Open the source")}</a>
                    </small>
                  )}
                  <small className="dim">{t("This is a suggestion. You can change the address below before you send.")}</small>
                </div>
              )}
              {offered.length === 0 && sug && (sug.place.city || sug.place.state) && !mailable.length && (
                <small className="dim">{t("No official address is on file yet for")} {[sug.place.city, sug.place.state].filter(Boolean).join(", ")}. {t("Type the address of the right office below.")}</small>
              )}
              <input type="email" value={shown} onChange={e => setAddr(e.target.value)} placeholder={mailable.length ? t("or type an email address") : t("Authority email address")} maxLength={120} aria-label={t("Authority email address")} />
              <div className="mailbtns">
                <button className="go" disabled={!mail} onClick={() => openOwn("gmail")}><ExternalLink size={16} />{t("Open in Gmail")}</button>
                <button disabled={!mail} onClick={() => openOwn("app")}><Mail size={16} />{t("Open in my email app")}</button>
              </div>
              {ed && <small className="errtext">{t("Save your edits in the written complaint below first, then the email buttons work again.")}</small>}
              {opened && (
                <div className="mailsent">
                  <button className="go" onClick={() => act(async () => { await S.agentSend(i.id, "mailto", ref, toAddr); setOpened(false); }, `Recorded as emailed to ${toAddr}`)}><Send size={15} />{t("I sent it from my email")}</button>
                  <small className="dim">{t("Press this after you have pressed Send in your email. The app cannot see your inbox.")}</small>
                </div>
              )}
              {!toOk && toAddr && <small className="errtext">{t("That does not look like an email address.")}</small>}
              <small className="dim">{t("Attach the report photo yourself, because a link cannot attach files. Only send to an official office email. Check the address on the city's website first.")}</small>
              {canServer && (
                <div className="row wrap">
                  <button disabled={!!ed || !toOk} onClick={sendMail}>{t("Send from the server instead")}</button>
                  <small className="dim">{t("The server emails it with the photo attached. It comes from the app's address.")}</small>
                </div>
              )}
              {!fb && <button type="button" className="linkbtn" onClick={() => setFb(true)}>{t("Gmail not opening? Show the written complaint")}</button>}
            </div>
          )}
          {canOwn && <TinyFishCard i={i} admin={admin} owns={owns} sent={sent} act={act} />}
          {canOwn ? (
            <details className="fallback" open={fb} onToggle={e => setFb((e.currentTarget as HTMLDetailsElement).open)}>
              <summary><FileText size={14} /> {t("Written complaint: edit, copy, or file on a portal")}</summary>
              {fb && blockedHint}
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
              </div>
            </details>
          ) : (
            <>
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
            </>
          )}
          {mailWhy && <small className="errtext">{t(mailWhy)}</small>}
          <small className="dim">{canOwn ? t("Prefer to file on a government portal? Approve, copy the text, submit it there, then mark it as sent.") : "This app does not file on government portals for you. After approving, copy the text and submit it through the route above, then mark it as sent."}</small>
        </div>
      ) : (
        <pre className="draft">{text}</pre>
      )}

      {sent && last && (
        <>
          <small className="dim">{d.via === "emailed" && d.emailedTo ? `Emailed to ${d.emailedTo}` : `Sent to ${last.to}`} on {when(last.sentAt)}{d.via === "simulated" ? " (simulated)" : ""}{last.ref ? ` · reference ${last.ref}` : ""}</small>
          {(a.replies ?? []).map(r => <div key={r.t} className="card"><small className="dim">{t("Reply recorded")} {ago(r.t)} · {r.by}</small><p>{r.text}</p></div>)}
          {admin && !resolved && (
            <details>
              <summary>{t("Record the authority's reply")}</summary>
              <div className="form">
                <textarea rows={4} maxLength={1000} value={reply} onChange={e => setReply(e.target.value)} placeholder={t("Paste the reply or a short note of what they said")} aria-label={t("Authority reply")} />
                <input placeholder={t("Reference number in the reply (optional)")} maxLength={60} value={rref} onChange={e => setRref(e.target.value)} />
                <select value={rstat} onChange={e => setRstat(e.target.value as "" | "acknowledged" | "resolved")} aria-label={t("Status")}>
                  <option value="">{t("Keep the status as it is")}</option><option value="acknowledged">{t("They acknowledged it")}</option><option value="resolved">{t("They say it is resolved")}</option>
                </select>
                <button disabled={!reply.trim()} onClick={() => act(async () => { await S.agentReply(i.id, reply, rref || undefined, rstat || undefined); setReply(""); setRref(""); setRstat(""); }, "Reply saved")}>{t("Save reply")}</button>
              </div>
            </details>
          )}
          {owns && !resolved && !i.handoff?.ref && (
            <div className="row"><input placeholder="Reference number received" maxLength={60} value={ref} onChange={e => setRef(e.target.value)} /><button onClick={() => act(async () => { await S.agentRef(i.id, ref); setRef(""); }, "Reference saved")}>{t("Save")}</button></div>
          )}
        </>
      )}
      {a.escalateAt && !resolved && <small className="dim">{t("If unresolved by")} {when(a.escalateAt)}, {t("the agent prepares an escalation to")} {next?.to ?? "the next level"}. {t("You approve before anything is sent.")}</small>}
      {sent && admin && !resolved && !pending && next && <button onClick={() => act(() => S.agentEscalate(i.id), "Escalation draft prepared")}>{t("Prepare escalation now")}</button>}
      {resolved && pending && <small className="dim">The issue was resolved, so the escalation is not needed.</small>}

      <small className="dim">Prepared {ago(a.created)} · {a.source === "ai" ? "AI-assisted" : a.source === "scripted" ? "simulated demo" : "rule-based"}. Drafts are suggestions and can be edited.</small>
      </div>
    </details>
  );
}