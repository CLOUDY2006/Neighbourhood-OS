import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import * as S from "./store";
import { useT } from "./i18n";
import { ago, RL, type Act } from "./ui";

const LAST_ROOM = "nos-chat-room";
const merge = (a: S.ChatMsg[], b: S.ChatMsg[]) => { const m = new Map(a.map(x => [x.id, x])); b.forEach(x => m.set(x.id, x)); return [...m.values()].sort((x, y) => x.id - y.id); };

export function ChatPanel({ st, app, act }: { st: S.State; app: S.AppState; act: Act }) {
  const t = useT(), n = app.nbhd!, demo = app.mode === "demo";
  const rooms = S.roomsFor(st.role);
  const [pick, setPick] = useState<S.Room>(() => { try { return (localStorage.getItem(LAST_ROOM) as S.Room) || "all"; } catch { return "all"; } });
  const room = rooms.some(r => r.id === pick) ? pick : "all", info = rooms.find(r => r.id === room) ?? rooms[0] ?? S.ROOMS[0];
  const mod = S.canModerateChat(st.role, room);
  const [msgs, setMsgs] = useState<S.ChatMsg[]>([]), [more, setMore] = useState(false), [loading, setLoading] = useState(true), [err, setErr] = useState("");
  const [text, setText] = useState(""), [sending, setSending] = useState(false);
  const rev = useRef(-1), list = useRef<HTMLDivElement>(null), stick = useRef(true), keep = useRef<number | null>(null);

  // The first load is retried on every tick until it works, and its error stays on screen until then.
  // Later ticks only fetch what changed since the last message.
  const first = async (isLive: () => boolean) => {
    const p = await S.chatLoad(room);
    if (!isLive()) return;
    setMsgs(p.msgs); setMore(!!p.more); rev.current = p.rev; setErr(""); setLoading(false);
  };
  const pull = async () => {
    const p = await S.chatLoad(room, { since: rev.current });
    if (p.msgs.length) setMsgs(m => merge(m, p.msgs));
    rev.current = Math.max(rev.current, p.rev);
  };
  useEffect(() => {
    let live = true; const isLive = () => live;
    setMsgs([]); setMore(false); setLoading(true); setErr(""); rev.current = -1; stick.current = true;
    first(isLive).catch(e => { if (live) { setErr((e as Error).message); setLoading(false); } });
    const iv = setInterval(() => {
      if (!live || document.visibilityState === "hidden") return;
      if (rev.current < 0) { first(isLive).catch(e => { if (live) setErr((e as Error).message); }); return; }
      pull().then(() => { if (live) setErr(""); }).catch(() => undefined);
    }, demo ? 2000 : 4000);
    return () => { live = false; clearInterval(iv); };
  }, [room, n.id, st.role, demo]);

  // Everything up to the newest visible message counts as seen while this room is open.
  useEffect(() => { const last = [...msgs].reverse().find(m => m.state === "ok"); if (last) S.markChatSeen(room, last.id); }, [msgs, room]);
  useEffect(() => {
    const el = list.current; if (!el) return;
    if (keep.current != null) { el.scrollTop = el.scrollHeight - keep.current; keep.current = null; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const choose = (r: S.Room) => { setPick(r); try { localStorage.setItem(LAST_ROOM, r); } catch { /* ignore */ } };
  const earlier = () => act(async () => {
    const p = await S.chatLoad(room, { before: msgs[0]?.id });
    keep.current = list.current ? list.current.scrollHeight - list.current.scrollTop : null;
    setMsgs(m => merge(m, p.msgs)); setMore(!!p.more);
  });
  const send = () => {
    if (!text.trim() || sending) return;
    setSending(true);
    void act(async () => { const m = await S.chatSend(room, text); setText(""); stick.current = true; setMsgs(x => merge(x, [m])); }).finally(() => setSending(false));
  };
  const after = (fn: () => Promise<void>, ok: string) => act(async () => { await fn(); await pull(); }, ok);

  return (
    <div className="chat">
      <div className="chips" role="tablist" aria-label={t("Chat rooms")}>
        {rooms.map(r => (
          <button key={r.id} role="tab" aria-selected={r.id === room} className={`chip btn ${r.id === room ? "sel" : ""}`} onClick={() => choose(r.id)}>
            {t(r.name)}{r.id !== room && S.chatUnread(app, st.role, r.id) && <i className="dot" aria-label={t("new messages")} />}
          </button>
        ))}
      </div>
      <small className="dim">{t(info.who)}: {n.name}. {t("Nobody outside this neighbourhood can read it.")}</small>
      <div className="chat-sos" role="note">
        <span>{t("Chat is not for emergencies. If anyone is in danger, call 112 first.")}</span>
      </div>

      <div className="chat-list" ref={list} aria-live="polite" aria-busy={loading} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {more && <button className="ghost earlier" onClick={earlier}>{t("Load earlier messages")}</button>}
        {loading && <p className="dim">{t("Loading…")}</p>}
        {err && <p className="dim">{err}</p>}
        {!loading && !err && !msgs.length && <p className="dim">{t("No messages yet. Say hello to your neighbours.")}</p>}
        {msgs.map(m => (
          <div key={m.id} className={`msg ${m.mine ? "mine" : ""} ${m.state !== "ok" ? "gone" : ""}`}>
            <div className="msg-head">
              <b>{m.mine ? t("You") : m.by}</b>
              {m.role && m.role !== "resident" && <span className="chip">{t(RL[m.role])}</span>}
              <small className="dim">{ago(m.t)}</small>
            </div>
            {m.state === "deleted" ? <i className="dim">{t("Message deleted")}</i>
              : m.state === "hidden" && !m.text ? <i className="dim">{t("This message was hidden")}</i>
              : <p className="pre">{m.text}</p>}
            {mod && m.state === "hidden" && <span className="chip amber">{t("Hidden")}{m.reports ? ` · ${m.reports} ${m.reports === 1 ? "report" : "reports"}` : ""}</span>}
            {mod && m.state === "ok" && !!m.reports && <span className="chip amber">{m.reports} {m.reports === 1 ? "report" : "reports"}</span>}
            {m.state !== "deleted" && (
              <div className="msg-acts">
                {!m.mine && m.state === "ok" && (m.reported ? <small className="dim">{t("Reported")}</small>
                  : <button className="x" onClick={() => after(() => S.chatReport(room, m.id), "Reported. A coordinator will look at it")}>{t("Report")}</button>)}
                {mod && m.state === "ok" && <button className="x" onClick={() => after(() => S.chatHide(room, m.id, true), "Message hidden")}>{t("Hide")}</button>}
                {mod && m.state === "hidden" && <button className="x" onClick={() => after(() => S.chatHide(room, m.id, false), "Message restored")}>{t("Restore")}</button>}
                {m.mine && <button className="x" onClick={() => { if (confirm(t("Delete this message for everyone?"))) void after(() => S.chatDelete(room, m.id), "Message deleted"); }}>{t("Delete")}</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea rows={2} maxLength={S.CHAT_MAX} value={text} placeholder={`${t("Message")} ${t(info.name)}`} aria-label={`${t("Message")} ${t(info.name)}`}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="go" onClick={send} disabled={!text.trim() || sending} aria-label={t("Send")}><Send size={15} /> {t("Send")}</button>
      </div>
      {S.soundsUrgent(text) && <small className="chat-hint red">{t("If someone is in danger, call 112 first. Neighbours may not read this in time.")}</small>}
      {S.looksLikePhone(text) && <small className="chat-hint">{t("This looks like a phone number. Everyone in this room will see it.")}</small>}
      <small className="dim">{text.length}/{S.CHAT_MAX} · {demo ? t("Demo: simulated messages, kept only on this device.") : t(`Messages are deleted after ${S.CHAT_DAYS} days. Links are not allowed.`)}</small>
    </div>
  );
}