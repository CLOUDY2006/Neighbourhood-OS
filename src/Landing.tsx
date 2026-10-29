import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, animate, motion, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import {
  Accessibility, AlertTriangle, ArrowRight, BadgeCheck, BarChart3, Check, CircleCheck, Construction, Droplets, Eye, FileText, Flag, Globe, History, Keyboard, Languages,
  Lightbulb, Lock, MapPin, MessageSquare, Mic, Moon, Play, ScrollText, ShieldCheck, Siren, Sparkles, Sun, Trash2, UserCheck, Users, WifiOff, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as S from "./store";
import { go } from "./route";
import { toggleTheme, useA11y, useTheme } from "./a11y";
import { palette } from "./theme";
import { genCity } from "./mapdata";
import { buildModel, drawCars, drawGround, drawObjects, makeProj } from "./city3d";
import "./landing.css";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const prefersCalm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Reveal({ children, d = 0, className = "", y = 26 }: { children: ReactNode; d?: number; className?: string; y?: number }) {
  return <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-70px" }} transition={{ duration: 0.75, delay: d, ease: EASE }}>{children}</motion.div>;
}
function Head({ eyebrow, title, sub, center }: { eyebrow: string; title: ReactNode; sub?: ReactNode; center?: boolean }) {
  return (
    <Reveal className={`ln-head ${center ? "ctr" : ""}`}>
      <span className="ln-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </Reveal>
  );
}
/** Card with a soft light that follows the pointer. */
function Spot({ className = "", children, d = 0 }: { className?: string; children: ReactNode; d?: number }) {
  return (
    <motion.div className={`ln-card ${className}`} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.7, delay: d, ease: EASE }}
      onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`); }}>
      {children}
    </motion.div>
  );
}
function Count({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null), seen = useInView(ref, { once: true }), calm = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (calm) { setN(to); return; }
    const c = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: v => setN(Math.round(v)) });
    return () => c.stop();
  }, [seen, calm, to]);
  return <span ref={ref}>{n}{suffix}</span>;
}
function useCycle(n: number, ms: number, run = true) {
  const [i, setI] = useState(0), calm = useReducedMotion();
  useEffect(() => {
    if (!run || calm) return;
    const t = setInterval(() => setI(x => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, run, calm]);
  return i;
}
function Typed({ text, run }: { text: string; run: boolean }) {
  const [k, setK] = useState(0), calm = useReducedMotion();
  useEffect(() => {
    if (!run) return;
    if (calm) { setK(text.length); return; }
    setK(0);
    const t = setInterval(() => setK(x => { if (x >= text.length) { clearInterval(t); return x; } return x + 1; }), 38);
    return () => clearInterval(t);
  }, [run, text, calm]);
  return <>{text.slice(0, k)}<i className="caret" aria-hidden="true" /></>;
}

/* ---------------------------------------------------------------- nav */

function Nav({ me }: { me: boolean }) {
  const theme = useTheme(), [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll(), bar = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  useEffect(() => { const f = () => setScrolled(window.scrollY > 10); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  const jump = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: prefersCalm() ? "auto" : "smooth" }); };
  return (
    <header className={`ln-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="ln-wrap ln-navin">
        <a className="ln-brand" href="/" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: prefersCalm() ? "auto" : "smooth" }); }}><span className="logo" aria-hidden="true">N</span><span>NEIGHBOURHOOD OS</span></a>
        <nav className="ln-links" aria-label="Page sections">
          {[["how", "How it works"], ["features", "Features"], ["roles", "Roles"], ["trust", "Trust"]].map(([id, l]) => <a key={id} href={`#${id}`} onClick={jump(id)}>{l}</a>)}
        </nav>
        <div className="ln-actions">
          <button className="iconbtn ln-ghosticon" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="ghost ln-signin" onClick={() => go("/signin")}>{me ? "My neighbourhoods" : "Sign in"}</button>
          <button className="go" onClick={S.enterDemo}><Play size={14} /> Try the demo</button>
        </div>
      </div>
      <motion.div className="ln-progress" style={{ scaleX: bar }} aria-hidden="true" />
    </header>
  );
}

/* ---------------------------------------------------------------- hero */

const PINS: { x: number; y: number; Icon: LucideIcon; phase: number }[] = [
  { x: -400, y: -100, Icon: Trash2, phase: 0 },
  { x: -200, y: 300, Icon: Construction, phase: 2.1 },
  { x: 0, y: -300, Icon: AlertTriangle, phase: 4.6 },
  { x: 200, y: 100, Icon: Lightbulb, phase: 7.3 },
  { x: 400, y: -300, Icon: Droplets, phase: 9.4 },
];
const STAGES = [{ l: "Reported", c: "red" }, { l: "Verified", c: "red" }, { l: "Fixing", c: "amber" }, { l: "Fixed", c: "green" }] as const;
const CYCLE = 12;

function HeroCity() {
  const theme = useTheme(), pal = palette(theme), a11y = useA11y(), calm = a11y.motion || prefersCalm();
  const box = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null), layer = useRef<SVGGElement>(null), pinEls = useRef<(SVGGElement | null)[]>([]);
  const model = useMemo(() => buildModel(genCity(650)), []);
  const [size, setSize] = useState({ w: 600, h: 520 });
  const [tick, setTick] = useState(0);
  const live = useRef({ size, city: pal.city, calm });
  live.current = { size, city: pal.city, calm };
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 500); return () => clearInterval(t); }, []);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const ground = document.createElement("canvas"), obj = document.createElement("canvas");
    let raf = 0, last = -1e9, seen = true, key = "", stamp = 0;
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; });
    io.observe(box.current!);
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const L = live.current, c = cvs.current;
      if (!c || !seen || document.hidden || L.size.w < 2 || ts - last < 32) return;
      last = ts;
      const sec = L.calm ? 0 : ts / 1000, rot = -0.3 + Math.sin((sec * 2 * Math.PI) / 30) * 0.45, tilt = 0.52 + Math.sin((sec * 2 * Math.PI) / 21) * 0.05;
      const pr = makeProj(650, false, { rot, tilt }), dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(L.size.w * dpr), H = Math.round(L.size.h * dpr), k = Math.min(L.size.w / 1660, L.size.h / 1060), c0 = pr.P(0, 0);
      const v = { x: L.size.w / 2 - c0.x * k, y: L.size.h * 0.56 - c0.y * k, k };
      if (c.width !== W || c.height !== H) { c.width = ground.width = obj.width = W; c.height = ground.height = obj.height = H; key = ""; }
      const nk = `${rot.toFixed(4)}|${tilt.toFixed(4)}|${W}|${H}|${L.city.night}`;
      const vt: [number, number, number, number, number, number] = [dpr * k, 0, 0, dpr * k, dpr * v.x, dpr * v.y];
      if (nk !== key) {
        key = nk;
        const g = ground.getContext("2d")!, o = obj.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(...vt); drawGround(g, model, pr, L.city);
        o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, W, H); o.setTransform(...vt); drawObjects(o, model, pr, L.city, { ...v, w: L.size.w, h: L.size.h }, { labels: false, windows: true });
      } else if (L.calm && stamp) return;
      stamp = ts;
      const x = c.getContext("2d")!;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.drawImage(ground, 0, 0);
      if (!L.calm) { x.setTransform(...vt); drawCars(x, model, pr, L.city, ts / 1000); x.setTransform(1, 0, 0, 1, 0, 0); }
      x.drawImage(obj, 0, 0);
      const ps = L.size.w < 600 ? 0.72 : 1;
      PINS.forEach((p, i) => { const a = pr.P(p.x, p.y), el = pinEls.current[i]; el?.setAttribute("transform", `translate(${(v.x + a.x * k).toFixed(1)},${(v.y + a.y * k).toFixed(1)}) scale(${ps})`); });
      layer.current?.setAttribute("data-ready", "1");
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [model]);
  const now = tick / 2;
  return (
    <div className="ln-city" ref={box}>
      <div className="ln-cityglow" aria-hidden="true" />
      <canvas ref={cvs} aria-hidden="true" />
      <svg className="ln-citypins" aria-hidden="true">
        <g ref={layer}>
          {PINS.map((p, i) => {
            const s = calm ? (i % 4) : Math.floor((((now + p.phase) % CYCLE) / CYCLE) * 4), st = STAGES[s], col = pal[st.c], Ic = s === 3 ? Check : p.Icon;
            return (
              <g key={i} ref={el => { pinEls.current[i] = el; }}>
                <ellipse rx="15" ry="8" fill={col} fillOpacity=".22" stroke={col} strokeWidth="1.6" />
                {s < 3 && <ellipse rx="16" ry="8.5" fill="none" stroke={col} strokeWidth="2" className="ring" />}
                {s === 3 && <ellipse key={`b${Math.floor((now + p.phase) / CYCLE)}`} rx="16" ry="8.5" fill="none" stroke={col} strokeWidth="2.5" className="burst" />}
                <line y1="-46" y2="0" stroke={col} strokeWidth="1.8" />
                <g transform="translate(0,-70)" className="mpin-head" style={{ ["--pc" as string]: col }}>
                  <path d="M-6,16 L0,24 L6,16Z" fill={col} />
                  <rect className="mpin-bg" x="-18" y="-18" width="36" height="36" rx="11" stroke={col} strokeWidth="2.2" style={s === 3 ? { fill: col } : undefined} />
                  <Ic x={-10} y={-10} size={20} color={s === 3 ? pal.onCol : col} strokeWidth={2.3} />
                </g>
                <g transform="translate(0,-100)"><rect className="mpin-label" x="-34" y="-10" width="68" height="20" rx="10" style={{ stroke: col }} /><text className="mpin-text" textAnchor="middle" y="4" fontSize="10.5">{st.l}</text></g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function Float({ className, d, mx, my, depth, children }: { className: string; d: number; mx: MotionValue<number>; my: MotionValue<number>; depth: number; children: ReactNode }) {
  const x = useTransform(mx, v => v * depth), y = useTransform(my, v => v * depth);
  return (
    <motion.div className={`ln-float ${className}`} style={{ x, y }} initial={{ opacity: 0, y: 20, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: d, duration: 0.8, ease: EASE }}>
      <div className="ln-bob">{children}</div>
    </motion.div>
  );
}

function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null), mx = useMotionValue(0), my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 70, damping: 16 }), ry = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 70, damping: 16 });
  const smx = useSpring(mx, { stiffness: 60, damping: 15 }), smy = useSpring(my, { stiffness: 60, damping: 15 });
  return (
    <motion.div ref={ref} className="ln-visual" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 1.2, ease: EASE }}
      onPointerMove={e => { const r = ref.current!.getBoundingClientRect(); mx.set((e.clientX - r.left) / r.width - 0.5); my.set((e.clientY - r.top) / r.height - 0.5); }}
      onPointerLeave={() => { mx.set(0); my.set(0); }}>
      <motion.div className="ln-stage" style={{ rotateX: rx, rotateY: ry }}><HeroCity /></motion.div>
      <Float className="f1" d={0.9} mx={smx} my={smy} depth={-26}>
        <span className="fi red"><MapPin size={15} /></span>
        <div><small>New report · just now</small><b>Garbage piled on Lakeview Road</b><em><Mic size={11} /> Spoken in Hindi · Unverified</em></div>
      </Float>
      <Float className="f2" d={1.15} mx={smx} my={smy} depth={-40}>
        <span className="fi violet"><Sparkles size={15} /></span>
        <div><small>AI agent · suggestion</small><b>Complaint drafted for sanitation</b><span className="ln-mini"><Check size={11} /> Awaiting your approval</span></div>
      </Float>
      <Float className="f3" d={1.4} mx={smx} my={smy} depth={30}>
        <span className="fi amber"><Users size={15} /></span>
        <div><small>Report · Garbage on Park Road</small><b>3 neighbours confirmed it</b><span className="ln-bar"><i /></span></div>
      </Float>
      <Float className="f4" d={1.65} mx={smx} my={smy} depth={44}>
        <span className="fi green"><CircleCheck size={15} /></span>
        <div><small>Proof of fix</small><b>Approved by a coordinator</b><em>The pin turns green</em></div>
      </Float>
      <span className="ln-viscap">Live preview · simulated neighbourhood</span>
    </motion.div>
  );
}

function Hero() {
  const words = ["Every", "neighbourhood,", "live", "in", "3D."];
  return (
    <section className="ln-hero">
      <div className="ln-aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="ln-dots" aria-hidden="true" />
      <div className="ln-wrap ln-herogrid">
        <div className="ln-herocopy">
          <motion.div className="ln-pill" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <span className="pd" /> Civic platform · English &amp; <span lang="hi">हिन्दी</span> · Works offline
          </motion.div>
          <h1 className="ln-h1">
            <span className="sr">Every neighbourhood, live in 3D. Report it. Fix it. Prove it.</span>
            <span aria-hidden="true">
              {words.map((w, i) => <motion.span key={i} className="w" initial={{ opacity: 0, y: "0.5em", filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.12 + i * 0.08, duration: 0.8, ease: EASE }}>{w}&nbsp;</motion.span>)}
              <motion.span className="l2" initial={{ opacity: 0, y: "0.4em" }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.9, ease: EASE }}>Report it. Fix it. <em>Prove it.</em></motion.span>
            </span>
          </h1>
          <motion.p className="ln-lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.8, ease: EASE }}>
            NEIGHBOURHOOD OS turns your streets into a live isometric map. Residents report problems, neighbors confirm them, coordinators verify them and see the fix through, and proof of the fix goes back on the map.
          </motion.p>
          <motion.div className="ln-ctas" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.8, ease: EASE }}>
            <button className="go xl ln-shine" onClick={S.enterDemo}><Play size={16} /> Try the live demo</button>
            <button className="xl" onClick={() => go("/signin")}>Sign in <ArrowRight size={16} /></button>
          </motion.div>
          <motion.ul className="ln-ticks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.15, duration: 0.8 }}>
            <li><Check size={14} /> No account needed for the demo</li>
            <li><Check size={14} /> Runs fully in your browser</li>
            <li><Check size={14} /> Humans verify, AI only suggests</li>
          </motion.ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- sources marquee */

const SOURCES: [LucideIcon, string][] = [[MapPin, "OpenStreetMap"], [MessageSquare, "SMS & WhatsApp"], [WifiOff, "Offline-first PWA"], [Sparkles, "AI suggestions"], [Globe, "TinyFish web agent"], [Languages, "English & हिन्दी"]];
function Sources() {
  return (
    <section className="ln-sources" aria-label="Data and services">
      <p>Built on open map data and a few well-labelled services</p>
      <div className="ln-marquee"><div className="ln-track">{[...SOURCES, ...SOURCES].map(([I, l], i) => <span key={i} aria-hidden={i >= SOURCES.length}><I size={16} /> {l}</span>)}</div></div>
    </section>
  );
}

/* ---------------------------------------------------------------- the loop */

function MockReport({ on }: { on: boolean }) {
  return (
    <div className="mk">
      <div className="mk-input"><Typed text="Garbage piled on Lakeview Road" run={on} /></div>
      <div className="mk-row"><span className="chip">garbage</span><span className="chip">medium</span><span className="mk-mic"><Mic size={11} /> Speak</span></div>
      <div className="mk-note amber">Possible duplicate nearby · 82% match</div>
    </div>
  );
}
function MockConfirm({ on }: { on: boolean }) {
  return (
    <div className="mk">
      <div className="mk-avatars">{["AK", "RS", "PN"].map((a, i) => <motion.span key={a} initial={false} animate={{ scale: on ? 1 : 0.6, opacity: on ? 1 : 0.3 }} transition={{ delay: on ? 0.15 * i : 0, type: "spring", stiffness: 300, damping: 18 }}>{a}</motion.span>)}<b>+{on ? 3 : 0}</b></div>
      <div className="mk-btn"><Eye size={12} /> I see this too</div>
      <div className="mk-note">3 flags hide a report until it is reviewed</div>
    </div>
  );
}
function MockVerify({ on }: { on: boolean }) {
  return (
    <div className="mk">
      <AnimatePresence mode="wait" initial={false}>
        {on ? <motion.span key="v" className="chip green mk-chip" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}><BadgeCheck size={12} /> Verified by coordinator</motion.span>
          : <motion.span key="u" className="chip mk-chip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Unverified</motion.span>}
      </AnimatePresence>
      <div className="mk-line"><span className="dotc green" /> Complaint draft approved</div>
      <div className="mk-line"><span className="dotc amber" /> Taken on by a coordinator</div>
    </div>
  );
}
function MockFix({ on }: { on: boolean }) {
  return (
    <div className="mk">
      <div className="mk-line"><b>Garbage on Park Road</b></div>
      <div className="mk-prog"><i style={{ width: on ? "75%" : "12%" }} /></div>
      <div className="mk-line dim">In progress · updated today</div>
      <div className="mk-note green"><Check size={11} /> After photo uploaded</div>
    </div>
  );
}
function MockProve({ on }: { on: boolean }) {
  return (
    <div className="mk">
      <div className={`mk-ba ${on ? "on" : ""}`}>
        <div className="b"><Trash2 size={18} /><span>Before</span></div>
        <div className="a"><Sparkles size={18} /><span>After</span></div>
        <i className="bar" />
      </div>
      <div className="mk-note green"><CircleCheck size={11} /> Approved by a different coordinator</div>
    </div>
  );
}
const LOOP: { k: string; who: string; Icon: LucideIcon; text: string; Mock: (p: { on: boolean }) => JSX.Element }[] = [
  { k: "Report", who: "Resident", Icon: MapPin, text: "Click the map, type or speak in Hindi or English, pick a category and priority, add a photo. Possible duplicates nearby are flagged.", Mock: MockReport },
  { k: "Confirm", who: "Neighbors", Icon: Users, text: "Neighbors press “I see this too”. Three flags from neighbors hide a report until a coordinator reviews it.", Mock: MockConfirm },
  { k: "Verify", who: "Coordinator", Icon: BadgeCheck, text: "Only a human can mark a report verified. The coordinator then takes it on and sends the complaint to the right office.", Mock: MockVerify },
  { k: "Fix", who: "Coordinator", Icon: Wrench, text: "The coordinator moves the report along, posts progress updates and uploads the after photo as evidence.", Mock: MockFix },
  { k: "Prove", who: "Coordinator", Icon: CircleCheck, text: "A different coordinator approves the fix (the four-eyes rule). A before/after slider goes on the issue and the pin turns green.", Mock: MockProve },
];
function Loop() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 55%"] });
  const fill = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  const [active, setActive] = useState(-1);
  useMotionValueEvent(scrollYProgress, "change", v => setActive(v <= 0.02 ? -1 : Math.min(4, Math.floor(v * 5))));
  return (
    <section id="how" className="ln-sec">
      <div className="ln-wrap">
        <Head eyebrow="How it works" title={<>One loop, from <em>pothole</em> to proof.</>} sub="Every problem follows the same five steps, and every step is visible on the map. People make the decisions; the software keeps the record." />
        <div className="ln-loop" ref={ref}>
          <div className="ln-rail" aria-hidden="true"><motion.i style={{ ["--p" as string]: fill }} /></div>
          <ol>
            {LOOP.map((s, i) => (
              <li key={s.k} className={i <= active ? "on" : ""}>
                <div className="ln-node"><s.Icon size={18} /><em>{i + 1}</em></div>
                <Reveal d={0.06 * i} y={18}>
                  <div className="ln-stephead"><h3>{s.k}</h3><span className="ln-who">{s.who}</span></div>
                  <p>{s.text}</p>
                  <s.Mock on={i <= active} />
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- stats */

function Stats() {
  const items: [number, string, string?][] = [[5, "steps from report to proof"], [2, "roles, enforced on the server"], [30, "days chat history is kept", " d"], [3, "neighbour flags hide a report until it is reviewed"], [2, "languages, with voice input"]];
  return (
    <section className="ln-stats" aria-label="At a glance">
      <div className="ln-wrap"><div className="ln-statgrid">
        {items.map(([n, l, s], i) => <Reveal key={l} d={i * 0.07} className="ln-stat"><b><Count to={n} suffix={s} /></b><span>{l}</span></Reveal>)}
      </div></div>
    </section>
  );
}

/* ---------------------------------------------------------------- features bento */

function AgentViz() {
  const ref = useRef<HTMLDivElement>(null), seen = useInView(ref, { margin: "-80px" });
  const steps = ["Understood", "Duplicates checked", "Route", "Draft", "Approved", "Sent", "Reference"];
  const i = useCycle(steps.length + 2, 1100, seen);
  return (
    <div className="agv" ref={ref}>
      <div className="agv-flow">
        <div className="agv-box"><small><Mic size={11} /> Resident said, in Hindi</small><p lang="hi">“{S.DEMO_HINDI}”</p></div>
        <ArrowRight className="agv-arrow" size={18} />
        <div className="agv-box out"><small><Sparkles size={11} /> Understood · English summary</small><p>Garbage has piled up on the street, causing a bad smell, and children's health may be at risk.</p><div className="agv-chips"><span className="chip">garbage</span><span className="chip amber">high</span><span className="chip">Sanitation dept.</span></div></div>
      </div>
      <ol className="agv-steps">
        {steps.map((s, k) => <li key={s} className={k < i ? "done" : k === i ? "now" : ""}>{k < i ? <Check size={11} /> : <span />}{s}{s === "Approved" && <Lock size={10} />}</li>)}
      </ol>
      <div className="agv-draft">
        <div className="row between"><small>Complaint draft · suggestion</small><span className="chip">Hindi version ready</span></div>
        <p><b>To:</b> Municipal sanitation department</p>
        <p><b>Subject:</b> Garbage piled up on Lakeview Road</p>
        <p className="agv-body"><Typed text="Residents report a large pile of garbage on Lakeview Road. It is causing a bad smell and a health risk for children. Please arrange collection and regular clearing. Confirmed by 4 neighbors." run={seen} /></p>
        <div className="agv-act"><span className="agv-approve"><Check size={13} /> Approve</span><small className="dim">This app does not file on government portals for you.</small></div>
      </div>
    </div>
  );
}
function SmsViz({ msgs }: { msgs: [boolean, string][] }) {
  const ref = useRef<HTMLDivElement>(null), seen = useInView(ref, { margin: "-60px" }), i = useCycle(6, 1300, seen);
  return (
    <div className="smv" ref={ref}>
      {msgs.map(([me, t], k) => <motion.div key={k} className={`sm ${me ? "me" : ""}`} initial={false} animate={{ opacity: k < i ? 1 : 0, y: k < i ? 0 : 8 }} transition={{ duration: 0.35, ease: EASE }}>{t}</motion.div>)}
    </div>
  );
}
function Features() {
  return (
    <section id="features" className="ln-sec">
      <div className="ln-wrap">
        <Head eyebrow="Features" title={<>Everything a neighbourhood needs. <em>Nothing</em> it doesn't.</>} sub="From a single pothole to a street full of problems, the same calm interface: a live map, a clear queue of work, and honest records." />
        <div className="ln-bento">
          <Spot className="b-agent">
            <div className="ln-ct"><span className="ln-ic violet"><Sparkles size={18} /></span><div><h3>An AI agent that drafts the complaint</h3><p>It understands the report, picks the complaint route and authority, drafts in English or Hindi, and tracks reference numbers. You approve every step; nothing is ever sent automatically.</p></div></div>
            <AgentViz />
            <span className="ln-tag">AI output is always labelled a suggestion · rule-based fallback without a key</span>
          </Spot>
          <Spot className="b-world" d={0.05}>
            <div className="ln-ct"><span className="ln-ic green"><BarChart3 size={18} /></span><div><h3>Locality status</h3><p>Reported vs resolved, hours to fix and hotspots in one place, with council reports you can export as CSV or print to PDF. Every chart says whether it is Actual or an Estimate.</p></div></div>
            <div className="plv" aria-hidden="true">{[38, 62, 45, 80, 58, 92, 70].map((h, k) => <i key={k} style={{ ["--h" as string]: `${h}%`, animationDelay: `${k * 0.12}s` }} className={k > 4 ? "est" : ""} />)}<span className="chip green">Actual</span><span className="chip amber">Estimate</span></div>
          </Spot>
          <Spot className="b-sos" d={0.1}>
            <div className="ln-ct"><span className="ln-ic teal"><MessageSquare size={18} /></span><div><h3>Neighbourhood chat</h3><p>One room for everyone and a private room for coordinators. Links are blocked, and three reports hide a message.</p></div></div>
            <SmsViz msgs={[[false, "Is the water back on Main Road?"], [true, "Yes, since 6 pm."], [false, "Thanks. I will mark the report fixed."]]} />
          </Spot>
          <Spot className="b-mission">
            <div className="ln-ct"><span className="ln-ic amber"><MapPin size={18} /></span><div><h3>Ward councillor lookup</h3><p>Coordinators find the ward page for the area and read who the councillor is, so complaints reach the right office.</p></div></div>
            <ul className="rpv"><li><MapPin size={14} /> Area read from the map<b>Ward 12</b></li><li><ScrollText size={14} /> Source: official ward page</li></ul>
          </Spot>
          <Spot className="b-res" d={0.05}>
            <div className="ln-ct"><span className="ln-ic teal"><Flag size={18} /></span><div><h3>Notices &amp; priority</h3><p>Coordinators pin notices for the neighbourhood. Every report gets a priority score with the reasons shown.</p></div></div>
            <ul className="rpv"><li><Flag size={14} /> Pinned notice<b>1</b></li><li><BarChart3 size={14} /> Priority score<b className="warn">82 / 100</b></li></ul>
          </Spot>
          <Spot className="b-sms" d={0.05}>
            <div className="ln-ct"><span className="ln-ic teal"><MessageSquare size={18} /></span><div><h3>Works offline, and over SMS</h3><p>Reports queue offline and send when you are back. Text STATUS, FIXED or NOT FIXED.</p></div></div>
            <SmsViz msgs={[[true, "STATUS"], [false, "1 open report: Garbage on Park Road is in progress."], [true, "FIXED"], [false, "Thanks. The report is marked fixed."]]} />
          </Spot>
          <Spot className="b-lang b-a11y" d={0.1}>
            <div className="ln-ct"><span className="ln-ic amber"><Languages size={18} /></span><div><h3>Hindi &amp; English, by voice</h3><p>Speak a report in either language. The agent writes the English summary.</p></div></div>
            <div className="lgv" aria-hidden="true"><b>Aa</b><b lang="hi">अ</b><div className="wave">{Array.from({ length: 18 }, (_, k) => <i key={k} style={{ animationDelay: `${(k % 6) * 0.11}s` }} />)}</div></div>
          </Spot>
          <Spot className="b-a11y" d={0.15}>
            <div className="ln-ct"><span className="ln-ic green"><Accessibility size={18} /></span><div><h3>Accessible by default</h3><p>Keyboard-accessible map, skip link, text size, high contrast, reduced motion, light and dark themes.</p></div></div>
            <div className="a11v" aria-hidden="true"><span>A</span><span className="m">A</span><span className="l">A</span><i className="tg on" /><Keyboard size={18} /></div>
          </Spot>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- roles */

const ROLES: { k: string; Icon: LucideIcon; who: string; can: string[] }[] = [
  { k: "Resident", Icon: UserCheck, who: "Every member", can: ["Report problems and confirm others' reports", "Flag, withdraw and add updates", "Say whether a fix looks done", "Use the neighbourhood chat", "Get notices and updates on your own reports"] },
  { k: "Coordinator", Icon: ShieldCheck, who: "Creator of a named neighbourhood, or approved by one", can: ["Everything a resident can do", "Verify or dispute reports and move them through the steps", "Post proof of a fix, and approve fixes by someone else", "Hide and restore reports and chat messages", "Pin notices, hand off to authorities, manage members"] },
];
function Roles() {
  const [r, setR] = useState(0), role = ROLES[r];
  return (
    <section id="roles" className="ln-sec">
      <div className="ln-wrap">
        <Head eyebrow="Roles" title={<>Two roles. <em>Clear</em> powers.</>} sub="Permissions are enforced on the server, not just hidden in the interface. Every coordinator action is written to an audit log." center />
        <Reveal className="ln-roles">
          <div className="ln-roletabs" role="tablist" aria-label="Roles">
            {ROLES.map((x, i) => (
              <button key={x.k} role="tab" aria-selected={r === i} className={r === i ? "on" : ""} onClick={() => setR(i)}>
                {r === i && <motion.span layoutId="roletab" className="ln-tabbg" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                <x.Icon size={16} /><span>{x.k}</span>
              </button>
            ))}
          </div>
          <div className="ln-rolepanel" role="tabpanel">
            <AnimatePresence mode="wait">
              <motion.div key={role.k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }} className="ln-rolebody">
                <div className="ln-rolebadge"><role.Icon size={30} /><b>{role.k}</b><small>{role.who}</small></div>
                <ul>{role.can.map((c, i) => <motion.li key={c} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, duration: 0.3 }}><Check size={15} />{c}</motion.li>)}</ul>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- trust */

function Trust() {
  const items: [LucideIcon, string, string][] = [
    [UserCheck, "Only humans verify", "A report is verified only by a coordinator. The reporter, or a different coordinator, must confirm every fix."],
    [Sparkles, "AI is always a suggestion", "Summaries, routes, drafts and photo checks are labelled. A rule-based fallback works without any AI key."],
    [FileText, "Simulated data says so", "Demo data and estimates are labelled “simulated” or “estimate” wherever they appear."],
    [AlertTriangle, "Not an emergency service", "The app says so in Chat and Account, and always points to your local emergency number first."],
    [Lock, "Location is opt-in", "Only a roughly 1 km area or a pin you choose is stored. Photos are re-encoded in your browser to strip GPS data."],
    [ScrollText, "Every action is logged", "Coordinator actions go to an audit log that other coordinators can read."],
  ];
  return (
    <section id="trust" className="ln-sec">
      <div className="ln-wrap">
        <Head eyebrow="Trust" title={<>Built on <em>honesty</em>, not hype.</>} sub="Six principles the interface keeps visible, and the limits we tell you about up front." />
        <div className="ln-trust">{items.map(([I, t, d], i) => <Spot key={t} d={i * 0.06} className="ln-tcard"><span className="ln-ic violet"><I size={18} /></span><h3>{t}</h3><p>{d}</p></Spot>)}</div>
        <Reveal className="ln-limits">
          <b>Honest limits</b>
          <ul>
            <li>OpenStreetMap coverage varies; a labelled schematic city is drawn when data is thin.</li>
            <li>Location claims are self-asserted, and updates arrive by polling every 5 seconds.</li>
            <li>Chat needs an internet connection. Hindi translations have not had native review yet.</li>
            <li>Authority names and escalation steps are generic and must be checked for your city.</li>
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- live TinyFish try-it */

function TryTinyFish() {
  const [on, setOn] = useState(false), [city, setCity] = useState(""), [cat, setCat] = useState<S.Cat>("garbage"), [busy, setBusy] = useState(false), [res, setRes] = useState<S.TfRouteCheck | null>(null), [err, setErr] = useState("");
  useEffect(() => { let a = true; S.tfPublicOn().then(v => { if (a) setOn(v); }); return () => { a = false; }; }, []);
  if (!on) return null;
  const run = async () => {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await S.tfPublicRoute(cat, city.trim())); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <section id="try-tinyfish" className="ln-sec">
      <div className="ln-wrap">
        <Head eyebrow="Live with TinyFish" center title={<>Find your city&rsquo;s <em>real complaint page</em>.</>} sub="No account needed. TinyFish searches the live web and reads the official pages for your city. The same step runs inside every report." />
        <Reveal className="ln-try">
          <div className="ln-tryrow">
            <input value={city} onChange={e => setCity(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && city.trim().length > 1 && !busy) void run(); }} placeholder="Your city or area, for example Dwarka, Delhi" maxLength={60} aria-label="City" />
            <select value={cat} onChange={e => setCat(e.target.value as S.Cat)} aria-label="Problem type">{(Object.keys(S.CAT_EN) as S.Cat[]).map(c => <option key={c} value={c}>{S.CAT_EN[c]}</option>)}</select>
            <button className="xl" disabled={busy || city.trim().length < 2} onClick={run}><Globe size={16} /> {busy ? "Reading official pages…" : "Find it"}</button>
          </div>
          {err && <p className="ln-tryerr" role="alert">{err}</p>}
          {res && (
            <div className="ln-tryout" aria-live="polite">
              <b>Results for {res.city}{res.region ? ` (${res.region})` : ""}</b>
              {res.sources.map(r => <span key={r.url}><a href={r.url} {...ext}>{r.title || r.url}</a> · {r.official ? "Government website" : "Not confirmed as official"}</span>)}
              {res.helplines.length > 0 && <span>Helplines found on the pages: {res.helplines.map(h => h.value).join(", ")}</span>}
              {res.emails.length > 0 && <span>Emails found: {res.emails.map(h => h.value).join(", ")}</span>}
              {res.links.map(l => <span key={l.url}><a href={l.url} {...ext}>{l.label}</a> · {l.kind === "track" ? "Track a complaint" : "Complaint page"}</span>)}
              <small>{res.note}</small>
            </div>
          )}
          <small className="ln-trynote">Powered by TinyFish Search and Fetch. Read by software, so it can be wrong or out of date: always confirm on the official site. Results are limited to India. Each visitor gets a few tries an hour.</small>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- cta + footer */

function FinalCta({ me }: { me: boolean }) {
  return (
    <section className="ln-sec ln-final">
      <div className="ln-wrap">
        <Reveal className="ln-cta">
          <div className="ln-ctaglow" aria-hidden="true" />
          <h2>See your neighbourhood <em>come alive</em>.</h2>
          <p>Open the simulated demo, switch between the two roles, and run the guided AI agent. No account needed.</p>
          <div className="ln-ctas">
            <button className="xl ln-white ln-shine" onClick={S.enterDemo}><Play size={16} /> Try the live demo</button>
            <button className="xl ln-outline" onClick={() => go("/signin")}>{me ? "Open my neighbourhoods" : "Sign in or create an account"} <ArrowRight size={16} /></button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
function Footer() {
  return (
    <footer className="ln-foot">
      <div className="ln-wrap ln-footgrid">
        <div><a className="ln-brand" href="/"><span className="logo" aria-hidden="true">N</span><span>NEIGHBOURHOOD OS</span></a><p>A live isometric map for every neighbourhood. Report it, fix it, prove it.</p></div>
        <div><b>Product</b><button className="ln-flink" onClick={S.enterDemo}>Live demo</button><button className="ln-flink" onClick={() => go("/signin")}>Sign in</button><a href="#how">How it works</a><a href="#features">Features</a></div>
        <div><b>Principles</b><a href="#trust">Trust &amp; honest limits</a><a href="#roles">Roles &amp; permissions</a></div>
      </div>
      <div className="ln-wrap ln-footnote">
        <p><Siren size={14} /> NEIGHBOURHOOD OS is not an emergency service. In an emergency, call your local emergency number (112 in India).</p>
        <p>Map data © OpenStreetMap contributors · Official complaint pages found with TinyFish</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  const app = S.useApp(), me = !!app.me;
  useEffect(() => { document.title = "NEIGHBOURHOOD OS · Report it. Fix it. Prove it."; return () => { document.title = "NEIGHBOURHOOD OS"; }; }, []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="ln">
        <a className="skip" href="#main">Skip to content</a>
        <Nav me={me} />
        <main id="main">
          <Hero />
          <Sources />
          <Loop />
          <Stats />
          <Features />
          <TryTinyFish />
          <Roles />
          <Trust />
          <FinalCta me={me} />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}