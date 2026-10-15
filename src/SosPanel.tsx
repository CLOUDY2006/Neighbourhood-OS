import { useState } from "react";
import * as S from "./store";
import { useT } from "./i18n";
import VoiceButton from "./Voice";
import { ago, type Act, type Pt } from "./ui";

const ACTIVE = ["open", "acknowledged", "assigned"];

export default function SosPanel({ st, app, pick, setPick, act }: { st: S.State; app: S.AppState; pick: Pt; setPick: (p: Pt) => void; act: Act }) {
  const t = useT();
  const NEED: Record<S.SosNeed, string> = { medical: t("Medical help"), rescue: t("Rescue or trapped"), shelter: t("Shelter"), food_water: t("Food or water"), other: t("Something else") };
  const ST: Record<S.SosStatus, string> = { open: t("Waiting for a coordinator"), acknowledged: t("Seen by a coordinator"), assigned: t("Volunteer assigned"), helped: t("Helped"), closed: t("Closed") };
  const me = S.myName(), list = S.visibleSos(st, st.role, me), active = (x: S.Sos) => ACTIVE.includes(x.status);
  const [f, setF] = useState({ need: "medical" as S.SosNeed, people: 1, note: "", consent: false });
  const [pick2, setPick2] = useState("");
  const official = S.isOfficial(app.alerts), mineActive = list.some(x => x.author === me && active(x));
  const locate = () => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p => setPick({ lat: p.coords.latitude, lng: p.coords.longitude }), () => act(() => { throw new Error("Location permission was not given. Click the map to choose where you are instead"); }), { timeout: 10000, enableHighAccuracy: true })
    : act(() => { throw new Error("Your browser cannot share location. Click the map instead"); });
  const volunteers = st.volunteers.filter(v => v.available);

  return (
    <>
      <h3>{t("SOS")}</h3>
      <div className="card alertcard official">
        <b>{t("Call your local emergency number first")}</b>
        <p>{t("If anyone is in immediate danger, call emergency services (for example 112, 911 or 999) before anything else. Neighbors and volunteers may not see a request in time.")}</p>
        {official && <p>{t("An official hazard alert is active near this neighborhood, so Crisis Mode is on.")}</p>}
      </div>
      {st.role !== "admin" && (st.sosActive ?? 0) > 0 && <small className="dim">{st.sosActive} active SOS request{st.sosActive === 1 ? "" : "s"} in this neighborhood. Locations are only shown to coordinators and assigned volunteers.</small>}

      {!mineActive && (
        <div className="form">
          <h3>{t("Ask for help")}</h3>
          <select value={f.need} onChange={e => setF({ ...f, need: e.target.value as S.SosNeed })} aria-label="What do you need">{S.SOS_NEEDS.map(n => <option key={n} value={n}>{NEED[n]}</option>)}</select>
          <input type="number" min={1} max={50} value={f.people} onChange={e => setF({ ...f, people: Number(e.target.value) })} aria-label="Number of people" />
          <textarea rows={2} maxLength={300} placeholder={t("Short note, e.g. 2nd floor, water rising")} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <VoiceButton onText={x => setF({ ...f, note: `${f.note} ${x}`.trim() })} />
          <p className="dim">{pick ? `(${pick.lat.toFixed(5)}, ${pick.lng.toFixed(5)})` : t("Click the map to choose where you are, or use your current location.")}</p>
          <button onClick={locate} disabled={!f.consent}>{t("Use my current location")}</button>
          <label className="check"><input type="checkbox" checked={f.consent} onChange={e => setF({ ...f, consent: e.target.checked })} /> {t("I agree to share this exact location and note with this neighborhood's coordinators and any volunteer they assign. It is deleted when the request is closed, or after 24 hours.")}</label>
          <button className="sosbtn" onClick={() => act(async () => {
            if (!pick) throw new Error("Choose your location on the map first");
            await S.sos({ ...f, lat: pick.lat, lng: pick.lng });
            setPick(null); setF({ need: "medical", people: 1, note: "", consent: false });
          }, "Request sent. Stay safe and keep trying emergency services")}>{t("Send SOS request")}</button>
          <small className="dim">{t("A coordinator will review the request. It is unverified until someone confirms it.")}</small>
        </div>
      )}

      {list.length > 0 && <h3>{st.role === "admin" ? t("SOS board") : t("Your requests")}</h3>}
      {list.map(x => {
        const shelter = x.lat != null && x.lng != null ? S.nearestResource(st, { lat: x.lat, lng: x.lng }, ["shelter", "aid"]) : null;
        const assignedMe = x.assigned.includes(me);
        return (
          <div key={x.id} className={`card ${active(x) ? "sos-card" : ""}`}>
            <div className="row between"><b>{NEED[x.need]} · {x.people} {x.people === 1 ? "person" : "people"}</b><span className={`chip ${x.status === "open" ? "red" : x.status === "closed" || x.status === "helped" ? "green" : "amber"}`}>{ST[x.status]}</span></div>
            {x.note && <p>{x.note}</p>}
            <small className="dim">{x.author === me ? "You" : x.author} · {ago(x.created)}{x.lat != null && x.lng != null ? ` · ${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}` : " · location deleted"}</small>
            {x.contact && (st.role === "admin" || assignedMe) && <small className="dim">Contact (text message): {x.contact}</small>}
            {st.role === "admin" && shelter && active(x) && <small className="dim">Nearest {shelter.r.kind}: {shelter.r.name}, about {Math.round(shelter.m)} m away</small>}
            {x.assigned.length > 0 && <small className="dim">Assigned: {x.assigned.join(", ")}</small>}
            {active(x) && (
              <div className="row wrap">
                {S.can(st.role, "sosAck") && x.status === "open" && <button onClick={() => act(() => S.sosAck(x.id), "Acknowledged")}>{t("Acknowledge")}</button>}
                {S.can(st.role, "sosAssign") && (
                  <>
                    <select value={pick2} onChange={e => setPick2(e.target.value)} aria-label="Volunteer to assign"><option value="">Assign a volunteer…</option>{volunteers.map(v => <option key={v.id} value={v.name}>{v.name}{v.skills.length ? ` (${v.skills.join(", ")})` : ""}</option>)}</select>
                    <button disabled={!pick2} onClick={() => act(async () => { await S.sosAssign(x.id, pick2); setPick2(""); }, "Volunteer assigned")}>{t("Assign")}</button>
                  </>
                )}
                {(st.role === "admin" || assignedMe) && <button className="go" onClick={() => act(() => S.sosStatus(x.id, "helped"), "Marked helped. Location deleted")}>{t("Mark helped")}</button>}
                {st.role === "admin" && <button className="warn" onClick={() => act(() => S.sosStatus(x.id, "closed"), "Closed. Location deleted")}>{t("Close")}</button>}
                {x.author === me && <button className="warn" onClick={() => act(() => S.sosCancel(x.id), "Request cancelled")}>{t("Cancel my request")}</button>}
              </div>
            )}
          </div>
        );
      })}
      {!list.length && st.role === "admin" && <p className="dim">No SOS requests right now.</p>}
      <small className="dim">SOS locations are visible only to you, coordinators, and a volunteer a coordinator assigns. Closing a request deletes its location, note and contact.</small>
    </>
  );
}
