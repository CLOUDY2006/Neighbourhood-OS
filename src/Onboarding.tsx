import { useState } from "react";
import * as S from "./store";
import { cellOf, type LL } from "./geo";
import { LANGS, setLang, useLang, useT } from "./i18n";
import { BadgeCheck, CircleCheck, MapPin, Moon, Sun, Users, Wrench } from "lucide-react";
import { toggleTheme, useTheme } from "./a11y";

type Spot = (LL & { label: string }) | null;

export default function Onboarding() {
  const app = S.useApp(), t = useT(), lang = useLang(), theme = useTheme();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [f, setF] = useState({ email: "", password: "", name: "" });
  const [msg, setMsg] = useState(""), [bad, setBad] = useState(false), [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState<Spot>(null);
  const [near, setNear] = useState<S.NearNamed[]>([]);
  const [q, setQ] = useState(""), [places, setPlaces] = useState<S.Place[]>([]);
  const [nm, setNm] = useState({ name: "", r: 500 });

  const run = async (fn: () => Promise<unknown>, ok = "") => {
    setBusy(true); setBad(false); setMsg("");
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setBad(true); setMsg((e as Error).message); }
    setBusy(false);
  };
  const show = (s: Spot) => { setSpot(s); setNear([]); if (s) S.nearbyNamed(s.lat, s.lng).then(setNear).catch(() => setNear([])); };
  const locate = () => run(() => new Promise<void>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Your browser does not support location. Search for a place instead"));
    navigator.geolocation.getCurrentPosition(p => {
      const c = cellOf(p.coords.latitude, p.coords.longitude);
      show({ lat: c.lat, lng: c.lng, label: "Your area (about 1 km)" }); resolve();
    }, () => reject(new Error("Location permission was not given. You can search for a place instead")), { timeout: 10000, maximumAge: 600000 });
  }));

  return (
    <div className="gate">
      <div className="gcard glass">
        <div className="row between">
          <div className="row"><span className="logo" aria-hidden="true">N</span><h1 className="brand">NEIGHBORHOOD OS</h1></div>
          <div className="row">
            <select className="langsel" aria-label={t("Language")} value={lang} onChange={e => setLang(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
            <button className="iconbtn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          </div>
        </div>
        <p className="lead">See your neighborhood's problems on a live map, fix them together, and prove they are fixed.</p>
        <ol className="loop" aria-label="How it works">
          <li><MapPin size={16} /><b>Report</b><small>Drop a pin and describe it</small></li>
          <li><Users size={16} /><b>Confirm</b><small>Neighbors say “I see this too”</small></li>
          <li><BadgeCheck size={16} /><b>Verify</b><small>A coordinator checks and assigns</small></li>
          <li><Wrench size={16} /><b>Fix</b><small>Volunteers fix it and post proof</small></li>
          <li><CircleCheck size={16} /><b>Prove</b><small>The pin turns green on the map</small></li>
        </ol>

        <button className="go" onClick={S.enterDemo}>{t("Try the simulated demo (no account)")}</button>

        {!S.LIVE_AVAILABLE && <p className="dim">Real neighborhoods need an account service. Add the Supabase keys from the README to turn them on.</p>}

        {S.LIVE_AVAILABLE && !app.ready && <p className="dim">Loading…</p>}

        {S.LIVE_AVAILABLE && app.ready && !app.me && (
          <div className="form">
            <h3>{mode === "up" ? "Create your account" : mode === "reset" ? "Reset password" : "Sign in"}</h3>
            {mode === "up" && <input placeholder="Display name (a nickname is fine)" maxLength={30} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}
            <input type="email" placeholder="Email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            {mode !== "reset" && <input type="password" placeholder="Password (8+ characters)" autoComplete={mode === "up" ? "new-password" : "current-password"} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />}
            <button className="go" disabled={busy} onClick={() => run(async () => {
              if (mode === "in") await S.signIn(f.email, f.password);
              else if (mode === "up") {
                if (!f.name.trim()) throw new Error("Choose a display name");
                if (f.password.length < 8) throw new Error("Use at least 8 characters for the password");
                const r = await S.signUp(f.email, f.password, f.name.trim());
                if (r === "confirm") { setBad(false); setMsg("Check your email and open the confirmation link, then sign in."); setMode("in"); }
              } else { await S.resetPassword(f.email); setMsg("If that email has an account, a reset link is on its way."); }
            })}>{mode === "up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
            <div className="row wrap">
              {mode !== "in" && <button className="x" onClick={() => setMode("in")}>Sign in</button>}
              {mode !== "up" && <button className="x" onClick={() => setMode("up")}>Create account</button>}
              {mode !== "reset" && <button className="x" onClick={() => setMode("reset")}>Forgot password</button>}
            </div>
            <small className="dim">Your display name is visible to people in your neighborhood. Please do not use your full name if you prefer privacy.</small>
          </div>
        )}

        {app.me && (
          <>
            <p>Signed in as <b>{app.me.handle}</b> <button className="x" onClick={S.signOut}>Sign out</button></p>
            {app.mine.length > 0 && (
              <div className="form">
                <h3>{t("Your neighborhoods")}</h3>
                {app.mine.map(n => <button key={n.id} className="issue" onClick={() => run(() => S.enter(n))}><span className="grow">{n.name}<small>{n.kind === "named" ? "Named" : "Area"} · you are a {n.role === "admin" ? "coordinator" : n.role}</small></span></button>)}
              </div>
            )}
            <div className="form">
              <h3>{t("Find a neighborhood")}</h3>
              <button disabled={busy} onClick={locate}>{t("Use my location")}</button>
              <small className="dim">Optional. Your browser shares your position once, and only the roughly 1 km area it falls in is used. Your exact location is never sent or stored.</small>
              <div className="row">
                <input placeholder="Or search for a place" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && q.trim().length > 2) run(async () => setPlaces(await S.geocode(q.trim()))); }} />
                <button disabled={busy || q.trim().length < 3} onClick={() => run(async () => setPlaces(await S.geocode(q.trim())))}>Search</button>
              </div>
              {places.map((p, i) => <button key={i} className="issue" onClick={() => { const c = cellOf(p.lat, p.lng); show({ lat: c.lat, lng: c.lng, label: p.name.split(",").slice(0, 2).join(",") }); setPlaces([]); }}><span className="grow">{p.name.slice(0, 80)}</span></button>)}
            </div>

            {spot && (
              <div className="card">
                <b>{spot.label}</b>
                <button className="go" disabled={busy} onClick={() => run(() => S.joinCell(cellOf(spot.lat, spot.lng).id))}>{t("Join this area's neighborhood")}</button>
                {near.length > 0 && <><small className="dim">Named neighborhoods nearby</small>{near.map(n => <button key={n.id} className="issue" onClick={() => run(() => S.joinById(n.id))}><span className="grow">{n.name}<small>{n.members} member{n.members === 1 ? "" : "s"} · {n.r} m radius</small></span></button>)}</>}
                <div className="form">
                  <small className="dim">Or start a named neighborhood centered here</small>
                  <input placeholder="Name, e.g. Lakeview Colony" maxLength={60} value={nm.name} onChange={e => setNm({ ...nm, name: e.target.value })} />
                  <select value={nm.r} onChange={e => setNm({ ...nm, r: Number(e.target.value) })}>{[300, 500, 800, 1200, 2000].map(r => <option key={r} value={r}>{r} m radius</option>)}</select>
                  <button disabled={busy || nm.name.trim().length < 3} onClick={() => run(() => S.createNamed({ name: nm.name.trim(), lat: spot.lat, lng: spot.lng, r: nm.r }))}>Create and become its coordinator</button>
                </div>
              </div>
            )}
          </>
        )}

        {(msg || app.error) && <p className={bad || app.error ? "errtext" : "oktext"} role="status">{msg || app.error}</p>}
        <small className="dim">NEIGHBORHOOD OS is not an emergency service. In an emergency, call your local emergency number.</small>
      </div>
    </div>
  );
}
