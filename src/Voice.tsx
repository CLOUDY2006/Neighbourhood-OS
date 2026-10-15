import { useRef, useState } from "react";
import { speechLang, useT } from "./i18n";

export default function VoiceButton({ onText }: { onText: (t: string) => void }) {
  const t = useT();
  const SR = (typeof window !== "undefined" ? (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition : null) as (new () => any) | null;
  const [on, setOn] = useState(false);
  const rec = useRef<any>(null);
  if (!SR) return null;
  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = speechLang(); r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => onText(String(e.results[0][0].transcript));
    r.onend = () => setOn(false); r.onerror = () => setOn(false);
    rec.current = r; setOn(true); r.start();
  };
  return <button type="button" className={`x ${on ? "rec" : ""}`} onClick={toggle} aria-pressed={on} aria-label={t("Speak instead of typing")}>{on ? t("Listening…") : t("Speak")}</button>;
}
