import { useMemo, useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { label, type Act } from "./ui";

const DAY = 86400000;
const safe = (v: string | number) => { const s = String(v); return /^[=+\-@]/.test(s) ? "'" + s : s; };
const csv = (rows: (string | number)[][]) => rows.map(r => r.map(v => `"${safe(v).replace(/"/g, '""')}"`).join(",")).join("\n");
function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const days = (t: number) => Math.floor((Date.now() - t) / DAY);

export function HandoffBox({ i, st, act }: { i: S.Issue; st: S.State; act: Act }) {
  const [au, setAu] = useState(""), [ref, setRef] = useState("");
  const h = i.handoff, overdue = h && (h.status === "sent" || h.status === "acknowledged") && days(h.sentAt) >= 7;
  return (
    <div className="card">
      <b>Hand-off to an authority</b>
      {h && (
        <>
          <p>Passed to <b>{h.to}</b> {days(h.sentAt)} day(s) ago{h.ref ? ` · ref ${h.ref}` : ""}{h.email ? " · emailed" : ""}. {overdue && <span className="errtext">No resolution after 7 days.</span>}</p>
          <select value={h.status} onChange={e => act(() => S.handoffStatus(i.id, e.target.value as S.Handoff["status"]), "Status updated")} aria-label="Authority response">
            {["sent", "acknowledged", "resolved", "no_response"].map(x => <option key={x} value={x}>{label(x)}</option>)}
          </select>
        </>
      )}
      {!h && (st.authorities ?? []).length === 0 && <small className="dim">Add authorities to the directory in the Reports tab first.</small>}
      {!h && (st.authorities ?? []).length > 0 && (
        <div className="form">
          <select value={au} onChange={e => setAu(e.target.value)} aria-label="Authority"><option value="">Choose authority…</option>{(st.authorities ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input placeholder="Their reference number (optional)" maxLength={60} value={ref} onChange={e => setRef(e.target.value)} />
          <button disabled={!au} onClick={() => act(() => S.handoff(i.id, au, ref), "Handed off")}>Hand off</button>
          <small className="dim">If the authority has an email address, the issue details are emailed without any resident names.</small>
        </div>
      )}
    </div>
  );
}

function Directory({ st, act }: { st: S.State; act: Act }) {
  const [f, setF] = useState({ name: "", email: "", phone: "" });
  return (
    <div className="card">
      <b>Authorities directory</b>
      {(st.authorities ?? []).map(a => <div key={a.id} className="row between"><span>{a.name}<small className="dim"> {a.email || "no email"}{a.phone ? ` · ${a.phone}` : ""}</small></span><button className="x" onClick={() => act(() => S.authorityRemove(a.id))}>Remove</button></div>)}
      <div className="form">
        <input placeholder="Name, e.g. Ward office" maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <input placeholder="Email (optional)" maxLength={120} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <input placeholder="Phone (optional)" maxLength={30} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
        <button onClick={() => act(async () => { await S.authoritySet(f.name, f.email, f.phone); setF({ name: "", email: "", phone: "" }); }, "Added")}>Add</button>
      </div>
    </div>
  );
}

export function Reports({ st, app, act }: { st: S.State; app: S.AppState; act: Act }) {
  const t = useT();
  const [range, setRange] = useState(30), [cat, setCat] = useState("all");
  const n = app.nbhd!;
  const rows = useMemo(() => st.issues.filter(i => !i.hidden && (range === 0 || Date.now() - i.created < range * DAY) && (cat === "all" || i.cat === cat)), [st.issues, range, cat]);
  const done = rows.filter(i => i.resolvedAt);
  const avg = done.length ? done.reduce((a, i) => a + (i.resolvedAt! - i.created), 0) / done.length / 3600000 : 0;
  const weeks = [3, 2, 1, 0].map(w => { const to = Date.now() - w * 7 * DAY, from = to - 7 * DAY; return { l: `${w}w ago`, n: st.issues.filter(i => i.created >= from && i.created < to).length, f: st.issues.filter(i => i.resolvedAt && i.resolvedAt >= from && i.resolvedAt < to).length }; });
  const mx = Math.max(1, ...weeks.map(w => Math.max(w.n, w.f)));
  const handed = st.issues.filter(i => i.handoff);
  const spots = S.hotspots(st);
  const link = `${location.origin}/?impact=${encodeURIComponent(n.id)}`;
  const exportCsv = () => download(`reports-${n.name.replace(/\W+/g, "-")}.csv`, csv([
    ["id", "title", "category", "priority", "status", "verification", "neighbor_reports", "created", "resolved", "hours_to_resolve", "handed_off_to", "handoff_status"],
    ...rows.map(i => [i.id, i.title, i.cat, i.priority, i.status, i.verif, i.reports, new Date(i.created).toISOString(), i.resolvedAt ? new Date(i.resolvedAt).toISOString() : "", i.resolvedAt ? ((i.resolvedAt - i.created) / 3600000).toFixed(1) : "", i.handoff?.to ?? "", i.handoff?.status ?? ""]),
  ]));
  return (
    <>
      <small className="dim">For coordinators, resident associations and local offices. Exports contain no resident names.</small>
      <div className="row wrap">
        <select value={range} onChange={e => setRange(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All time</option></select>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option value="all">All categories</option>{S.CATS.map(c => <option key={c}>{c}</option>)}</select>
      </div>
      <div className="row wrap">
        <button className="go" onClick={exportCsv}>{t("Download CSV")}</button>
        <button onClick={() => window.print()}>{t("Print or save as PDF")}</button>
        {app.mode === "live" && <button onClick={() => act(async () => { await navigator.clipboard.writeText(link); }, "Public summary link copied")}>Copy public summary link</button>}
      </div>

      <div id="report-print">
        <h3>{n.name}: report for {range ? `the last ${range} days` : "all time"}</h3>
        <div className="stats"><div className="red"><b>{rows.length}</b>Reports</div><div className="green"><b>{done.length}</b>Resolved</div><div className="amber"><b>{avg ? avg.toFixed(1) : "–"}</b>Avg hours to fix</div></div>
        <h3>Reports and fixes per week</h3>
        <div className="trend">{weeks.map(w => <div key={w.l}><em>{w.n}/{w.f}</em><i style={{ height: `${(w.n / mx) * 80}%` }} /><small>{w.l}</small></div>)}</div>
        <small className="dim">Each column: new reports / fixed that week.</small>
        <h3>By category</h3>
        {S.CATS.map(c => { const all = rows.filter(i => i.cat === c); return all.length ? <p key={c}>{c}: {all.length} reported, {all.filter(i => i.status === "resolved").length} resolved</p> : null; })}
        <h3>Recurring problem areas</h3>
        {spots.map((h, k) => <p key={k}>{h.n} reports of mostly {h.cat} near {h.lat.toFixed(4)}, {h.lng.toFixed(4)}</p>)}
        {!spots.length && <p className="dim">No area has repeated reports yet. This is a pattern in past reports, not a prediction.</p>}
        <h3>Passed to authorities ({handed.length})</h3>
        {handed.map(i => <p key={i.id}>{i.title}: {i.handoff!.to}, {label(i.handoff!.status)}, {days(i.handoff!.sentAt)} day(s){(i.handoff!.status === "sent" || i.handoff!.status === "acknowledged") && days(i.handoff!.sentAt) >= 7 ? " (overdue)" : ""}</p>)}
        {!handed.length && <p className="dim">Nothing handed off yet.</p>}
        <h3>Reports</h3>
        <table className="rt"><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Age</th></tr></thead>
          <tbody>{rows.slice(0, 80).map(i => <tr key={i.id}><td>{i.title}</td><td>{i.cat}</td><td>{i.status}{i.verif === "verified" || i.verif === "resolved" ? " ✓" : ""}</td><td>{days(i.created)}d</td></tr>)}</tbody></table>
        <small className="dim">Generated by NEIGHBORHOOD OS on {new Date().toLocaleDateString()}. Reports are community-submitted; a ✓ means a human coordinator verified it.</small>
      </div>

      <Directory st={st} act={act} />
    </>
  );
}
