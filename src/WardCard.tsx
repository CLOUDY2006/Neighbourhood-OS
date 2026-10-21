import { useEffect, useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import type { Act } from "./ui";
import { ext, useTfRun } from "./AgentPanel";

/** Name for the authorities directory, which allows 60 characters. */
export const wardContactName = (w: S.TfWard) => (w.councillor ? `Councillor ${w.councillor}${w.ward ? `, ${w.ward}` : ""}` : `Ward office, ${w.ward}`).slice(0, 60);

export function WardCard({ st, act }: { st: S.State; act: Act }) {
  const t = useT(), app = S.useApp();
  const [ok, setOk] = useState(false), [city, setCity] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [pages, setPages] = useState<S.TfWardPages | null>(null), [area, setArea] = useState<S.TfWardArea>({ locality: "", city: "", postcode: "" }), [url, setUrl] = useState("");
  const [runId, setRunId] = useState(""), [w, setW] = useTfRun(runId, S.tfPollWard, 70), [serr, setSerr] = useState("");

  useEffect(() => { let on = true; S.tfAvailable().then(v => { if (on) setOk(v); }); return () => { on = false; }; }, [app.mode]);
  if (!ok) return null;

  const find = async () => {
    setBusy(true); setErr("");
    try {
      const p = await S.tfWardPages(city.trim());
      setPages(p); setArea(p.area);
      const gov = p.sources.find(s => s.official);
      if (gov && !url) setUrl(gov.url);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const start = async () => {
    setSerr(""); setW({ state: "running" }); setRunId("");
    try { setRunId(await S.tfStartWard(url.trim(), { locality: area.locality.trim(), city: area.city.trim(), postcode: area.postcode.trim() })); } catch (e) { setW(null); setSerr((e as Error).message); }
  };
  const name = w?.found ? wardContactName(w) : "", inDir = !!name && (st.authorities ?? []).some(a => a.name === name);

  return (
    <div className="card">
      <b>{t("Find your ward councillor")}</b>
      <small className="dim">{t("TinyFish finds your city's ward lookup page. Then a web agent looks up this area on it and reads who the ward councillor is. Only the area name, city and PIN code are typed in, never anyone's address. The agent only reads, and it uses TinyFish credits.")}</small>
      <div className="row wrap">
        <input value={city} onChange={e => setCity(e.target.value)} placeholder={t("City (optional)")} maxLength={80} aria-label={t("City")} />
        <button disabled={busy} onClick={find}>{busy ? t("Searching…") : t("Find ward lookup pages")}</button>
      </div>
      {err && <small className="errtext">{err}</small>}
      {pages && (
        <div className="foldbody">
          {pages.simulated && <small className="errtext">{t("Simulated example. No real website was read.")}</small>}
          {pages.sources.map(r => (
            <div key={r.url} className="row wrap">
              <small className="dim"><a href={r.url} {...ext}>{r.title || r.url}</a> · {r.official ? t("Government website") : t("Not confirmed as official")}</small>
              <button className={`chip btn ${url === r.url ? "sel" : ""}`} onClick={() => setUrl(r.url)}>{url === r.url ? t("Selected") : t("Use this page")}</button>
            </div>
          ))}
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" maxLength={300} aria-label={t("Ward page address")} />
          <div className="row wrap">
            <input value={area.locality} onChange={e => setArea({ ...area, locality: e.target.value })} placeholder={t("Area name")} maxLength={60} aria-label={t("Area name")} />
            <input value={area.city} onChange={e => setArea({ ...area, city: e.target.value })} placeholder={t("City")} maxLength={60} aria-label={t("City")} />
            <input value={area.postcode} onChange={e => setArea({ ...area, postcode: e.target.value })} placeholder={t("PIN code (optional)")} maxLength={10} inputMode="numeric" aria-label={t("PIN code")} />
          </div>
          <small className="dim">{t("Check the area name. It was read from the map and may be wrong.")}</small>
          <button className="go" disabled={!url.trim() || area.locality.trim().length < 2 || w?.state === "running"} onClick={start}>{w?.state === "running" ? t("Looking up…") : t("Look up the councillor")}</button>
          {serr && <small className="errtext">{serr}</small>}
          {w?.state === "running" && <small className="dim">{t("The agent is working on the website. This can take up to three minutes.")}{w.streamingUrl ? <> <a href={w.streamingUrl} {...ext}>{t("Watch it live")}</a></> : null}</small>}
          {w?.state === "failed" && <small className="errtext">{w.error || t("The check did not finish.")}</small>}
          {w?.state === "done" && (
            <>
              {w.simulated && <small className="errtext">{t("Simulated example. No real website was read.")}</small>}
              {w.found ? (
                <>
                  <p><b>{w.councillor || t("No councillor named")}</b>{w.ward ? <small className="dim"> · {w.ward}</small> : null}</p>
                  {w.phone && <small className="dim">{t("Phone")}: {w.phone}</small>}
                  {w.email && <small className="dim">{t("Email")}: {w.email}</small>}
                  {w.office && <small className="dim">{t("Office")}: {w.office}</small>}
                  {w.sourceUrl && <small className="dim"><a href={w.sourceUrl} {...ext}>{t("Page where this was read")}</a></small>}
                </>
              ) : <p>{t("The agent could not find the ward for this area.")}</p>}
              {w.remarks && <small className="dim">{w.remarks}</small>}
              <small className="dim">{t("This is what the website showed, read by an AI agent. Check the page yourself before relying on it.")}</small>
              {w.found && (inDir
                ? <small className="dim">{t("Already in the authorities directory.")}</small>
                : <button onClick={() => act(() => S.authoritySet(name, w.email ?? "", w.phone ?? ""), "Added to the directory")}>{t("Add to the authorities directory")}</button>)}
            </>
          )}
        </div>
      )}
      <small className="dim">{t("Powered by TinyFish")}</small>
    </div>
  );
}
