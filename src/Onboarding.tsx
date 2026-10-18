import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BadgeCheck, Check, CircleCheck, Info, LocateFixed, LogOut, MapPin, Moon, Play, Plus, Search, Sun, Users, Wrench } from "lucide-react";
import * as S from "./store";
import { cellOf, type LL } from "./geo";
import { LANGS, setLang, useLang, useT } from "./i18n";
import { toggleTheme, useTheme } from "./a11y";
import { go } from "./route";

type Spot = (LL & { label: string }) | null;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const LOOP = [
  { Icon: MapPin, k: "Report", d: "Drop a pin, type or speak" },
  { Icon: Users, k: "Confirm", d: "Neighbors say “I see this too”" },
  { Icon: BadgeCheck, k: "Verify", d: "A coordinator checks and assigns" },
  { Icon: Wrench, k: "Fix", d: "Volunteers fix it and post proof" },
  { Icon: CircleCheck, k: "Prove", d: "Approved, and the pin turns green" },
];
const STATES = [{ l: "Reported", c: "red" }, { l: "Verified by coordinator", c: "red" }, { l: "Volunteers fixing", c: "amber" }, { l: "Fixed and approved", c: "green" }];

/** Left half of the sign-in page: brand, the five-step loop and a small issue card that moves through it. */
function AuthArt() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("rm")) return;
    const t = setInterval(() => setI(x => (x + 1) % 4), 2200);
    return () => clearInterval(t);
  }, []);
  const s = STATES[i], step = [0, 2, 3, 4][i];
  return (
    <aside className="auth-art" aria-hidden="true">
      <div className="auth-artglow" />
      <a className="auth-logo" href="/" onClick={e => { e.preventDefault(); go("/"); }} tabIndex={-1}><span className="logo">N</span>NEIGHBOURHOOD OS</a>
      <div className="auth-artbody">
        <motion.h2 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }}>Fix your street, <em>together</em>.</motion.h2>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.8, ease: EASE }}>Report problems on a live 3D map of your neighbourhood, fix them with your neighbors, and prove they are fixed.</motion.p>
        <ol className="auth-loop">
          {LOOP.map((x, k) => (
            <motion.li key={x.k} className={k <= step ? "on" : ""} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + k * 0.07, duration: 0.6, ease: EASE }}>
              <span><x.Icon size={15} /></span><div><b>{x.k}</b><small>{x.d}</small></div>
            </motion.li>
          ))}
        </ol>
      </div>
      <div className="auth-issue">
        <div className="row between"><b>Garbage piled on Lakeview Road</b><span className="auth-sim">Simulated</span></div>
        <AnimatePresence mode="wait">
          <motion.span key={s.l} className={`chip ${s.c}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>{i === 3 && <Check size={12} />}{s.l}</motion.span>
        </AnimatePresence>
        <div className="auth-steps">{[0, 1, 2, 3].map(k => <i key={k} className={k <= i ? STATES[i].c : ""} />)}</div>
      </div>
    </aside>
  );
}

export default function Onboarding() {
  const app = S.useApp(), t = useT(), lang = useLang(), theme = useTheme();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [f, setF] = useState({ email: "", password: "", name: "" });
  const [msg, setMsg] = useState(""), [bad, setBad] = useState(false), [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState<Spot>(null);
  const [near, setNear] = useState<S.NearNamed[]>([]);
  const [q, setQ] = useState(""), [places, setPlaces] = useState<S.Place[]>([]);
  const [nm, setNm] = useState({ name: "", r: 500 });
  useEffect(() => { document.title = "Sign in · NEIGHBOURHOOD OS"; return () => { document.title = "NEIGHBOURHOOD OS"; }; }, []);

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
  const submit = () => run(async () => {
    if (mode === "in") await S.signIn(f.email, f.password);
    else if (mode === "up") {
      if (!f.name.trim()) throw new Error("Choose a display name");
      if (f.password.length < 8) throw new Error("Use at least 8 characters for the password");
      const r = await S.signUp(f.email, f.password, f.name.trim());
      if (r === "confirm") { setBad(false); setMsg("Check your email and open the confirmation link, then sign in."); setMode("in"); }
    } else { await S.resetPassword(f.email); setMsg("If that email has an account, a reset link is on its way."); }
  });
  const title = app.me ? "Choose your neighbourhood" : mode === "up" ? "Create your account" : mode === "reset" ? "Reset your password" : "Welcome back";
  const sub = app.me ? "Open one of yours, join the area you live in, or start a named neighbourhood." : mode === "up" ? "Join your neighbourhood in under a minute." : mode === "reset" ? "We will email you a link to choose a new password." : "Sign in to your neighbourhood, or explore the demo first.";
  const demo = <button className="auth-demo" onClick={S.enterDemo}><span className="auth-demoic"><Play size={16} /></span><span><b>{t("Explore the live demo")}</b><small>No account needed · simulated neighbourhood</small></span></button>;

  return (
    <div className="auth">
      <AuthArt />
      <main className="auth-main">
        <div className="auth-top">
          <button className="ghost" onClick={() => go("/")}><ArrowLeft size={15} /> Home</button>
          <div className="row">
            <select className="langsel" aria-label={t("Language")} value={lang} onChange={e => setLang(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
            <button className="iconbtn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          </div>
        </div>

        <motion.div className="auth-box" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          <span className="auth-mlogo logo" aria-hidden="true">N</span>
          <h1>{title}</h1>
          <p className="auth-sub">{sub}</p>

          {!S.LIVE_AVAILABLE && (
            <>
              <div className="auth-info"><Info size={16} /><span>Accounts are not set up on this server yet. Add the Supabase keys from the README to turn on real neighbourhoods. The demo works without them.</span></div>
              {demo}
            </>
          )}

          {S.LIVE_AVAILABLE && !app.ready && <p className="dim auth-loading"><span className="spinner" /> Loading…</p>}

          {S.LIVE_AVAILABLE && app.ready && !app.me && (
            <>
              {mode !== "reset" && (
                <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
                  {(["in", "up"] as const).map(m => (
                    <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setMsg(""); }}>
                      {mode === m && <motion.span layoutId="authtab" className="auth-tabbg" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                      {m === "in" ? "Sign in" : "Create account"}
                    </button>
                  ))}
                </div>
              )}
              <form className="auth-form" onSubmit={e => { e.preventDefault(); submit(); }}>
                {mode === "up" && (
                  <label className="fld"><span>Display name</span><input placeholder="A nickname is fine" maxLength={30} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="nickname" /><small>Visible to people in your neighbourhood. You do not have to use your full name.</small></label>
                )}
                <label className="fld"><span>Email</span><input type="email" placeholder="you@example.com" autoComplete="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
                {mode !== "reset" && (
                  <label className="fld">
                    <span className="row between">Password{mode === "in" && <button type="button" className="auth-link" onClick={() => { setMode("reset"); setMsg(""); }}>Forgot password?</button>}</span>
                    <input type="password" placeholder={mode === "up" ? "At least 8 characters" : "Your password"} autoComplete={mode === "up" ? "new-password" : "current-password"} required value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
                  </label>
                )}
                <button type="submit" className="go auth-submit" disabled={busy}>{busy ? <span className="spinner light" /> : null}{mode === "up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
                {mode === "reset" && <button type="button" className="auth-link center" onClick={() => { setMode("in"); setMsg(""); }}><ArrowLeft size={13} /> Back to sign in</button>}
              </form>
              <div className="auth-or"><span>or</span></div>
              {demo}
            </>
          )}

          {app.me && (
            <div className="auth-picker">
              <div className="auth-me"><span className="auth-av">{app.me.handle.slice(0, 1).toUpperCase()}</span><div><small>Signed in as</small><b>{app.me.handle}</b></div><button className="x" onClick={S.signOut}><LogOut size={13} /> Sign out</button></div>
              {app.mine.length > 0 && (
                <div className="form">
                  <h3>{t("Your neighbourhoods")}</h3>
                  {app.mine.map(n => <button key={n.id} className="issue" onClick={() => run(() => S.enter(n))}><span className="auth-nic"><MapPin size={15} /></span><span className="grow">{n.name}<small>{n.kind === "named" ? "Named" : "Area"} · you are a {n.role === "admin" ? "coordinator" : n.role}</small></span></button>)}
                </div>
              )}
              <div className="form">
                <h3>{t("Find a neighbourhood")}</h3>
                <button disabled={busy} onClick={locate}><LocateFixed size={15} /> {t("Use my location")}</button>
                <small className="dim">Optional. Your browser shares your position once, and only the roughly 1 km area it falls in is used. Your exact location is never sent or stored.</small>
                <div className="row">
                  <input placeholder="Or search for a place" aria-label="Search for a place" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && q.trim().length > 2) run(async () => setPlaces(await S.geocode(q.trim()))); }} />
                  <button disabled={busy || q.trim().length < 3} onClick={() => run(async () => setPlaces(await S.geocode(q.trim())))}><Search size={15} /> Search</button>
                </div>
                {places.map((p, i) => <button key={i} className="issue" onClick={() => { const c = cellOf(p.lat, p.lng); show({ lat: c.lat, lng: c.lng, label: p.name.split(",").slice(0, 2).join(",") }); setPlaces([]); }}><span className="grow">{p.name.slice(0, 80)}</span></button>)}
              </div>
              {spot && (
                <div className="card">
                  <b>{spot.label}</b>
                  <button className="go" disabled={busy} onClick={() => run(() => S.joinCell(cellOf(spot.lat, spot.lng).id))}>{t("Join this area's neighbourhood")}</button>
                  {near.length > 0 && <><small className="dim">Named neighbourhoods nearby</small>{near.map(n => <button key={n.id} className="issue" onClick={() => run(() => S.joinById(n.id))}><span className="grow">{n.name}<small>{n.members} member{n.members === 1 ? "" : "s"} · {n.r} m radius</small></span></button>)}</>}
                  <div className="form">
                    <small className="dim">Or start a named neighbourhood centered here</small>
                    <input placeholder="Name, e.g. Lakeview Colony" aria-label="Neighbourhood name" maxLength={60} value={nm.name} onChange={e => setNm({ ...nm, name: e.target.value })} />
                    <select value={nm.r} aria-label="Radius" onChange={e => setNm({ ...nm, r: Number(e.target.value) })}>{[300, 500, 800, 1200, 2000].map(r => <option key={r} value={r}>{r} m radius</option>)}</select>
                    <button disabled={busy || nm.name.trim().length < 3} onClick={() => run(() => S.createNamed({ name: nm.name.trim(), lat: spot.lat, lng: spot.lng, r: nm.r }))}><Plus size={15} /> Create and become its coordinator</button>
                  </div>
                </div>
              )}
              <div className="auth-or"><span>or</span></div>
              {demo}
            </div>
          )}

          <AnimatePresence>{(msg || app.error) && <motion.p key={msg || app.error} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`auth-msg ${bad || app.error ? "bad" : "ok"}`} role="status">{msg || app.error}</motion.p>}</AnimatePresence>
          <p className="auth-foot">NEIGHBOURHOOD OS is not an emergency service. In an emergency, call your local emergency number.</p>
        </motion.div>
      </main>
    </div>
  );
}
