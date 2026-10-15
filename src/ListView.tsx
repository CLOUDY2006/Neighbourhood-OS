import * as S from "./store";
import { ago, grp } from "./ui";

export default function ListView({ st, filter, sel, onSel }: { st: S.State; filter: S.Status[]; sel: string | null; onSel: (id: string) => void }) {
  const rows = st.issues.filter(i => filter.includes(i.status)).map(i => ({ i, p: S.priorityScore(st, i) })).sort((a, b) => b.p.score - a.p.score || b.i.created - a.i.created);
  return (
    <div className="listview">
      <h3>All issues</h3>
      <table className="rt big">
        <thead><tr><th>Priority</th><th>Issue</th><th>Type</th><th>Status</th><th>Reports</th><th>Age</th></tr></thead>
        <tbody>
          {rows.map(({ i, p }) => (
            <tr key={i.id} className={`${sel === i.id ? "sel" : ""} row-${grp(i.status)}`} tabIndex={0} onClick={() => onSel(i.id)} onKeyDown={e => { if (e.key === "Enter") onSel(i.id); }}>
              <td><b>{p.score}</b> <small className="dim">{p.level}</small></td><td>{i.title}</td><td>{i.cat}</td><td>{S.STATUS_LABEL[i.status]}</td><td>{i.reports}</td><td>{ago(i.created)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="dim">No issues match the current filters.</p>}
      <small className="dim">Sorted by the priority score. Click a row to open it in the side panel.</small>
    </div>
  );
}
