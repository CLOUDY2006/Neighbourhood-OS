import { useState } from "react";
import * as S from "./store";
import type { Act, Pt } from "./ui";

export function AreaShare({ st, act, pick }: { st: S.State; act: Act; pick: Pt }) {
  const me = st.volunteers.find(v => v.name === S.myName()), [ok, setOk] = useState(false);
  const share = (lat: number, lng: number) => act(() => S.volunteerArea(lat, lng, ok), "Approximate area shared with coordinators");
  return (
    <div className="card">
      <b>My approximate area</b>
      <small className="dim">Optional. It lets coordinators match you to nearby work and see mission connections on the map. It is rounded to about 100 m and only coordinators and you can see it.</small>
      {me?.lat != null && me.lng != null ? (
        <div className="row between"><span>Shared: {me.lat}, {me.lng}</span><button onClick={() => act(() => S.volunteerAreaClear(), "Removed")}>Remove</button></div>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I agree to share this rounded area with coordinators.</label>
          <div className="row wrap">
            <button disabled={!ok || !pick} onClick={() => pick && share(pick.lat, pick.lng)}>Use the pin I chose on the map</button>
            <button disabled={!ok} onClick={() => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => share(p.coords.latitude, p.coords.longitude), () => act(() => { throw new Error("Location permission was not given"); })) : act(() => { throw new Error("Your browser cannot share location"); })}>Use my current location</button>
          </div>
        </>
      )}
    </div>
  );
}
