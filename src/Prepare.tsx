import { useEffect, useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, label, type Act } from "./ui";

export function CheckinCard({ st, app, act, compact }: { st: S.State; app: S.AppState; act: Act; compact?: boolean }) {
  const t = useT(), me = S.myName(), c = st.checkin, admin = st.role === "admin";
  const [title, setTitle] = useState("Are you safe after the earthquake?"), [people, setPeople] = useState<S.Member[]>([]);
  useEffect(() => { if (admin && app.mode === "live" && c && !c.closed) S.members().then(setPeople).catch(() => setPeople([])); }, [admin, app.mode, c?.id, c?.closed, Object.keys(c?.replies ?? {}).length]);
  const mine = c?.replies[me], open = c && !c.closed;
  const replies = Object.entries(c?.replies ?? {});
  const safe = replies.filter(([, r]) => r.ok).length, help = replies.filter(([, r]) => !r.ok);
  const care = new Set((st.care ?? []).map(x => x.name));
  const quiet = people.filter(p => !c?.replies[p.name]).sort((a, b) => Number(care.has(b.name)) - Number(care.has(a.name)));
  if (!open && (compact || !admin)) return null;
  return (
    <div className={`card ${open ? "alertcard" : ""}`}>
      <b>{t("Safety check-in")}</b>
      {open && c && (
        <>
          <p>{c.title}</p>
          <small className="dim">Started {ago(c.started)} by {c.by}</small>
          {!admin && <p><b>{t("Are you safe?")}</b></p>}
          <div className="row wrap">
            <button className={mine?.ok === true ? "go" : ""} onClick={() => act(() => S.checkinReply(true), "Thanks. You are marked safe")}>{t("I am safe")}</button>
            <button className={mine?.ok === false ? "sosbtn" : "warn"} onClick={() => act(() => S.checkinReply(false), "Coordinators can see that you need help. Call emergency services if you are in danger")}>{t("I need help")}</button>
          </div>
          {admin && (
            <>
              <p>{safe} safe · {help.length} need help{app.mode === "live" ? ` · ${quiet.length} not replied of ${st.memberCount ?? people.length}` : ""}</p>
              {help.map(([n, r]) => <p key={n} className="errtext">{n}: needs help {r.note && `(${r.note})`}</p>)}
              {quiet.length > 0 && <small className="dim">Not replied: {quiet.slice(0, 12).map(p => `${p.name}${care.has(p.name) ? " (registered for extra help)" : ""}`).join(", ")}{quiet.length > 12 ? "…" : ""}</small>}
              <button className="warn" onClick={() => act(() => S.checkinClose(), "Check-in closed")}>Close check-in</button>
            </>
          )}
        </>
      )}
      {!open && admin && (
        <div className="form">
          <small className="dim">Ask everyone whether they are safe, for example after an official alert. Members who turned on alerts are notified.</small>
          <input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} aria-label="Check-in message" />
          <button className="go" onClick={() => act(() => S.checkinStart(title), "Check-in started")}>Start check-in</button>
        </div>
      )}
    </div>
  );
}

export function Prepare({ st, app, act }: { st: S.State; app: S.AppState; act: Act }) {
  const t = useT(), me = S.myName(), admin = st.role === "admin";
  const [edit, setEdit] = useState(false), [p, setP] = useState({ routes: "", notes: "", contacts: "" });
  const [care, setCare] = useState({ need: "mobility", note: "", consent: false });
  const myCare = (st.care ?? []).find(c => c.name === me);
  const points = st.resources.filter(r => r.kind === "assembly" || r.kind === "equipment");
  const counts = S.ABILITIES.map(a => [a, st.volunteers.filter(v => v.available && v.abilities?.includes(a)).length] as const).filter(x => x[1] > 0);
  return (
    <>
      <CheckinCard st={st} app={app} act={act} />

      <div className="card">
        <div className="row between"><b>{t("Emergency plan")}</b>{admin && !edit && <button className="x" onClick={() => { setP({ routes: st.plan?.routes ?? "", notes: st.plan?.notes ?? "", contacts: st.plan?.contacts ?? "" }); setEdit(true); }}>Edit</button>}</div>
        {!edit && !st.plan && <p className="dim">No plan has been written yet. Coordinators can add evacuation routes, what to keep ready and who to contact.</p>}
        {!edit && st.plan && (
          <>
            <b>{t("Evacuation routes")}</b><p className="pre">{st.plan.routes || "Not set"}</p>
            <b>Be ready</b><p className="pre">{st.plan.notes || "Not set"}</p>
            <b>Contacts</b><p className="pre">{st.plan.contacts || "Not set"}</p>
            <small className="dim">Updated {ago(st.plan.updated)} by {st.plan.by}. Always follow instructions from official authorities first.</small>
          </>
        )}
        {edit && (
          <div className="form">
            <textarea rows={4} maxLength={1500} placeholder="Evacuation routes and assembly points" value={p.routes} onChange={e => setP({ ...p, routes: e.target.value })} />
            <textarea rows={3} maxLength={1500} placeholder="What households should keep ready" value={p.notes} onChange={e => setP({ ...p, notes: e.target.value })} />
            <textarea rows={2} maxLength={800} placeholder="Important contacts (no private numbers without permission)" value={p.contacts} onChange={e => setP({ ...p, contacts: e.target.value })} />
            <div className="row"><button className="go" onClick={() => act(async () => { await S.planSet(p.routes, p.notes, p.contacts); setEdit(false); }, "Plan saved")}>Save</button><button onClick={() => setEdit(false)}>Cancel</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <b>{t("Assembly points and equipment")}</b>
        {points.map(r => <p key={r.id}>{r.name}<small className="dim"> · {r.kind} · {r.note}</small></p>)}
        {!points.length && <p className="dim">None listed yet.</p>}
        {admin && <small className="dim">Add assembly points and shared equipment (boats, generators, pumps) in the Resources tab.</small>}
      </div>

      <div className="card">
        <b>{t("Who can help")}</b>
        <small className="dim">Skills of volunteers who are currently available.</small>
        {counts.map(([a, n]) => <p key={a}>{label(a)}: {n}</p>)}
        {!counts.length && <p className="dim">No volunteer has listed abilities yet.</p>}
      </div>

      <div className="card">
        <b>{t("Extra help register")}</b>
        <small className="dim">Optional. Only coordinators can see this. It helps them check on people first who may need extra help. You can remove yourself any time.</small>
        {myCare ? (
          <><p>You are registered ({label(myCare.need)}).</p><button onClick={() => act(() => S.careRemove(), "Removed from the register")}>Remove me</button></>
        ) : (
          <div className="form">
            <select value={care.need} onChange={e => setCare({ ...care, need: e.target.value })} aria-label="Type of help">{S.CARE_NEEDS.map(n => <option key={n} value={n}>{label(n)}</option>)}</select>
            <input placeholder="Short note (optional, no address)" maxLength={200} value={care.note} onChange={e => setCare({ ...care, note: e.target.value })} />
            <label className="check"><input type="checkbox" checked={care.consent} onChange={e => setCare({ ...care, consent: e.target.checked })} /> I agree that this neighbourhood's coordinators can see that I may need extra help.</label>
            <button onClick={() => act(() => S.careSet(care.need, care.note, care.consent), "You are on the register")}>Add me</button>
          </div>
        )}
        {admin && (st.care ?? []).length > 0 && (
          <>
            <b>Registered neighbors ({(st.care ?? []).length})</b>
            {(st.care ?? []).map(c => <p key={c.name}>{c.name}<small className="dim"> · {label(c.need)}{c.note ? ` · ${c.note}` : ""}</small></p>)}
          </>
        )}
      </div>
    </>
  );
}
