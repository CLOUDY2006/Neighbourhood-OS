import { useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, type Act } from "./ui";

export function NoticeBoard({ st, act }: { st: S.State; act: Act }) {
  const t = useT();
  const [f, setF] = useState({ title: "", body: "", urgent: false, pinned: false });
  const list = [...(st.notices ?? [])].sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.pinned) - Number(a.pinned) || b.created - a.created).slice(0, 6);
  const admin = S.can(st.role, "noticeAdd");
  if (!list.length && !admin) return null;
  return (
    <div className="card">
      <b>{t("Notice board")}</b>
      {list.map(n => (
        <div key={n.id} className={`notice ${n.urgent ? "urgent" : ""}`}>
          <div className="row between"><b>{n.pinned ? "📌 " : ""}{n.title}</b>{admin && <button className="x" onClick={() => act(() => S.noticeRemove(n.id), "Notice removed")}>Remove</button>}</div>
          {n.body && <p className="pre">{n.body}</p>}
          <small className="dim">{n.author} · {ago(n.created)}</small>
        </div>
      ))}
      {admin && (
        <details>
          <summary>Post a notice</summary>
          <div className="form">
            <input placeholder="Title" maxLength={100} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
            <textarea rows={3} maxLength={1000} placeholder="Details" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
            <label className="check"><input type="checkbox" checked={f.urgent} onChange={e => setF({ ...f, urgent: e.target.checked })} /> Urgent (notifies members who turned on alerts)</label>
            <label className="check"><input type="checkbox" checked={f.pinned} onChange={e => setF({ ...f, pinned: e.target.checked })} /> Pin to the top</label>
            <button className="go" onClick={() => act(async () => { await S.noticeAdd(f); setF({ title: "", body: "", urgent: false, pinned: false }); }, "Notice posted")}>Post</button>
          </div>
        </details>
      )}
    </div>
  );
}
