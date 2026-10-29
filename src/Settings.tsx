import { useEffect, useState } from "react";
import * as S from "./store";
import { LANGS, setLang, useLang, useT } from "./i18n";
import { setA11y, useA11y, type ThemePref } from "./a11y";
import type { Act } from "./ui";

export function AccessSettings() {
  const t = useT(), lang = useLang(), a = useA11y();
  return (
    <div className="card">
      <b>{t("Settings")}</b>
      <label className="role">{t("Language")} <select value={lang} onChange={e => setLang(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
      <label className="role">Theme <select value={a.theme} onChange={e => setA11y({ theme: e.target.value as ThemePref })}><option value="system">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label className="role">{t("Text size")} <select value={a.size} onChange={e => setA11y({ size: e.target.value as "normal" | "large" | "xl" })}><option value="normal">{t("Normal")}</option><option value="large">{t("Large")}</option><option value="xl">{t("Extra large")}</option></select></label>
      <label className="check"><input type="checkbox" checked={a.contrast} onChange={e => setA11y({ contrast: e.target.checked })} /> {t("High contrast")}</label>
      <label className="check"><input type="checkbox" checked={a.motion} onChange={e => setA11y({ motion: e.target.checked })} /> {t("Reduce motion")}</label>
      <small className="dim">Hindi and English are included. Translations should be reviewed by native speakers before real use. Voice input uses your browser's speech service, which may send audio to its provider.</small>
    </div>
  );
}

export function NotifySettings({ act }: { act: Act }) {
  const [caps, setCaps] = useState<S.Caps | null>(null), [ch, setCh] = useState<S.Chan[]>([]);
  const [phone, setPhone] = useState({ sms: "", whatsapp: "" }), [code, setCode] = useState({ sms: "", whatsapp: "" }), [sent, setSent] = useState<Record<string, boolean>>({});
  const load = () => { S.capabilities().then(setCaps).catch(() => setCaps(null)); S.channels().then(setCh).catch(() => setCh([])); };
  useEffect(load, []);
  const has = (k: string) => ch.find(c => c.kind === k);
  const phoneRow = (k: "sms" | "whatsapp", name: string, ok: boolean) => {
    const c = has(k);
    return (
      <div className="form" key={k}>
        <b>{name}</b>
        {!ok && <small className="dim">Not set up on this server.</small>}
        {ok && c?.verified && <div className="row between"><span>Linked: {c.target}</span><button onClick={() => act(async () => { await S.removeChannel(k); load(); }, "Removed")}>Remove</button></div>}
        {ok && !c?.verified && (
          <>
            <div className="row"><input placeholder="+919876543210" value={phone[k]} onChange={e => setPhone({ ...phone, [k]: e.target.value })} aria-label={`${name} number`} /><button onClick={() => act(async () => { await S.setChannel(k, { phone: phone[k] }); setSent({ ...sent, [k]: true }); load(); }, "Code sent")}>Send code</button></div>
            {(sent[k] || c) && <div className="row"><input placeholder="6-digit code" value={code[k]} onChange={e => setCode({ ...code, [k]: e.target.value })} aria-label="Code" /><button onClick={() => act(async () => { await S.setChannel(k, { code: code[k] }); load(); }, "Linked")}>Verify</button></div>}
          </>
        )}
      </div>
    );
  };
  return (
    <div className="card">
      <b>Notifications</b>
      <small className="dim">Choose how to hear about updates on reports, urgent notices and chat messages that were hidden in this neighbourhood.</small>
      {caps && (
        <>
          <div className="row between"><span>Push on this device</span>
            {has("push") ? <button onClick={() => act(async () => { await S.removeChannel("push"); load(); }, "Turned off")}>Turn off</button>
              : <button disabled={!caps.push} onClick={() => act(async () => { await S.enablePush(caps.push!); load(); }, "Turned on")}>{caps.push ? "Turn on" : "Not set up"}</button>}</div>
          <div className="row between"><span>Email</span>
            {has("email") ? <button onClick={() => act(async () => { await S.removeChannel("email"); load(); }, "Turned off")}>Turn off</button>
              : <button disabled={!caps.email} onClick={() => act(async () => { await S.setChannel("email"); load(); }, "Turned on")}>{caps.email ? "Turn on" : "Not set up"}</button>}</div>
          {phoneRow("sms", "Text message (SMS)", caps.sms)}
          {phoneRow("whatsapp", "WhatsApp", caps.whatsapp)}
          {(caps.sms || caps.whatsapp) && <small className="dim">Once linked you can text this service: STATUS to hear about your reports, or FIXED or NOT FIXED when you are asked whether a problem was fixed.</small>}
          {caps.cap > 0 ? <small className="dim">{caps.cap} official alert feed(s) are connected for this server.</small> : <small className="dim">No national alert feed is connected on this server yet.</small>}
        </>
      )}
      {!caps && <small className="dim">Loading…</small>}
    </div>
  );
}