import { useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, type Act } from "./ui";

export function Exchange({ st, act }: { st: S.State; act: Act }) {
  const t = useT(), me = S.myName();
  const [f, setF] = useState({ kind: "offer" as "offer" | "request", cat: "supplies", title: "", note: "" });
  const [msg, setMsg] = useState<Record<string, string>>({});
  const list = [...(st.shares ?? [])].filter(x => x.status !== "done").sort((a, b) => b.created - a.created);
  return (
    <>
      <h3>{t("Neighbor exchange")}</h3>
      <small className="dim">Lend, give or ask for supplies, tools, food and rides. Please do not post phone numbers or addresses here. Be careful when meeting people.</small>
      <div className="card form">
        <div className="row"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as "offer" | "request" })} aria-label="Offer or request"><option value="offer">{t("Offer")}</option><option value="request">{t("Request")}</option></select>
          <select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })} aria-label="Category">{S.SHARE_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
        <input placeholder="What is it?" maxLength={80} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <input placeholder="Details (optional)" maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        <button className="go" onClick={() => act(async () => { await S.shareAdd(f); setF({ ...f, title: "", note: "" }); }, "Posted")}>Post</button>
      </div>
      {list.map(x => (
        <div key={x.id} className="card">
          <div className="row between"><b>{x.title}</b><span className={`chip ${x.kind === "offer" ? "green" : "amber"}`}>{x.kind}{x.status === "matched" ? " · matched" : ""}</span></div>
          {x.note && <p>{x.note}</p>}
          <small className="dim">{x.cat} · {x.author === me ? "You" : x.author} · {ago(x.created)}{x.with ? ` · with ${x.with === me ? "you" : x.with}` : ""}</small>
          {x.thread.map((m, n) => <small key={n} className="dim">{m.by}: {m.text}</small>)}
          <div className="row wrap">
            {x.status === "open" && x.author !== me && <button className="go" onClick={() => act(() => S.shareClaim(x.id), x.kind === "offer" ? "You asked for this" : "You offered to help")}>{x.kind === "offer" ? "I would like this" : "I can help"}</button>}
            {(x.author === me || x.with === me) && <button onClick={() => act(() => S.shareDone(x.id), "Marked done")}>Mark done</button>}
            {(x.author === me || st.role === "admin") && <button className="warn" onClick={() => act(() => S.shareRemove(x.id), "Removed")}>Remove</button>}
          </div>
          <div className="row"><input placeholder="Message" maxLength={300} value={msg[x.id] ?? ""} onChange={e => setMsg({ ...msg, [x.id]: e.target.value })} aria-label="Message" />
            <button onClick={() => act(async () => { await S.shareMsg(x.id, msg[x.id] ?? ""); setMsg({ ...msg, [x.id]: "" }); })}>Send</button></div>
        </div>
      ))}
      {!list.length && <p className="dim">Nothing posted yet.</p>}
    </>
  );
}
