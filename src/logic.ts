import { draftComplaint } from "./agent";
import { routeFor } from "./routes";

export type Role = "resident" | "admin";
/** Turns any stored role into one of the two real roles. Older members saved as volunteer or moderator count as residents. */
export const asRole = (r: unknown): Role => (r === "admin" ? "admin" : "resident");
export type Status = "reported" | "review" | "assigned" | "progress" | "pending" | "resolved";
export type Verif = "unverified" | "review" | "verified" | "disputed" | "resolved";
export type Cat = "pothole" | "garbage" | "streetlight" | "water" | "unsafe" | "blocked" | "other";
export type Priority = "low" | "medium" | "high" | "critical";
export type Kind = "shelter" | "water" | "aid" | "donation" | "assembly" | "equipment";

export const STATUSES: Status[] = ["reported", "review", "assigned", "progress", "pending", "resolved"];
/** How long reporters get to answer "Is it fixed?" before a coordinator may close the report without confirmation. */
export const UNCONFIRMED_AFTER_MS = 7 * 24 * 3600 * 1000;
/** The person who reported a problem plus everyone who confirmed it ("I see this too"). */
export const reportersOf = (i: Pick<Issue, "author" | "confirmedBy">) => [...new Set([i.author, ...i.confirmedBy])].filter(n => n && n !== "Former member");
/** True when this person may answer "Is it fixed?" for a fix that is waiting for confirmation. */
export const canConfirmFix = (i: Issue, name: string) => i.status === "pending" && !i.hidden && i.pendingBy !== name && reportersOf(i).includes(name);
/** The photo shown as "After" in the before/after slider: the newest proof photo, so new evidence after a rejected fix replaces the old one. Older proof stays in the evidence list. */
export const afterPhoto = (i: Pick<Issue, "proof">) => [...i.proof].reverse().find(p => p.photo)?.photo;
/** When the fix was submitted for review. Older reports without a timestamp fall back to the activity log. */
export const pendingSince = (i: Issue) => i.pendingAt ?? [...i.log].reverse().find(l => l.text === "Status moved to pending")?.t ?? i.created;
export const STATUS_LABEL: Record<Status, string> = { reported: "Reported", review: "Under review", assigned: "Assigned", progress: "In progress", pending: "Resolution pending review", resolved: "Resolved" };
export const CATS: Cat[] = ["pothole", "garbage", "streetlight", "water", "unsafe", "blocked", "other"];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export type Closure = "reviewer" | "reporter" | "unconfirmed";
export interface Proof { t: number; by: string; text: string; photo?: string }
export interface Issue {
  id: string; title: string; cat: Cat; desc: string; lat: number; lng: number;
  priority: Priority; status: Status; verif: Verif; reports: number; proof: Proof[];
  log: { t: number; by: string; text: string }[]; missionId?: string; photo?: string; created: number; resolvedAt?: number; handoff?: Handoff; agent?: AgentRecord;
  pendingBy?: string; pendingAt?: number; closure?: Closure; reviewedBy?: string; rejections?: number; feedback?: Record<string, { ok: boolean; note: string; t: number }>; updates?: Proof[]; assignments?: { t: number; by: string; text: string }[]; actionPlan?: { approvedBy: string; approvedAt: number };
  author: string; confirmedBy: string[]; flags: string[]; hidden?: boolean;
  /** Coordinators who have checked this report. Two different coordinators are needed before it counts as verified. */
  verifiedBy?: string[];
}
export interface AgentDraft { level: number; to: string; lang: "en" | "hi"; subject: string; body: string; edited?: boolean; approvedBy?: string; approvedAt?: number; sentAt?: number; via?: "copied" | "emailed" | "mailto" | "simulated"; emailedTo?: string }
export interface AgentRecord { lang: "hi" | "en" | "other"; original: string; summaryEn: string; source: "ai" | "rules" | "scripted"; draft: AgentDraft; history: { level: number; to: string; sentAt: number; ref?: string }[]; escalateAt?: number; created: number; replies?: { t: number; by: string; text: string }[] }
export interface Handoff { to: string; email?: string; ref: string; sentAt: number; by: string; status: "sent" | "acknowledged" | "resolved" | "no_response" }
export interface Authority { id: string; name: string; email: string; phone: string }
export interface Notice { id: string; title: string; body: string; author: string; created: number; pinned: boolean; urgent: boolean }
export interface Mission { id: string; title: string; issueId?: string; need: number; joined: string[]; hours: number; done: boolean; lat?: number; lng?: number }
/** Where a mission happens: the spot a coordinator marked, or the location of the report it is linked to. */
export const missionSpot = (d: Pick<Doc, "issues">, m: Mission): { lat: number; lng: number } | null => {
  if (m.lat != null && m.lng != null) return { lat: m.lat, lng: m.lng };
  const i = m.issueId ? d.issues.find(x => x.id === m.issueId) : undefined;
  return i ? { lat: i.lat, lng: i.lng } : null;
};
export interface Resource { id: string; name: string; kind: Kind; lat: number; lng: number; note: string; low?: boolean }
export interface Volunteer { id: string; name: string; skills: Cat[]; available: boolean; lat?: number; lng?: number; abilities?: string[] }
export interface Ev { t: number; text: string; tone: string; to?: string }
export type SosNeed = "medical" | "rescue" | "shelter" | "food_water" | "other";
export type SosStatus = "open" | "acknowledged" | "assigned" | "helped" | "closed";
export interface Sos {
  id: string; author: string; lat: number | null; lng: number | null; need: SosNeed; people: number; note: string;
  status: SosStatus; assigned: string[]; contact?: string; created: number; expires: number; closedAt?: number; log: { t: number; by: string; text: string }[];
}
export type CoordKind = "verify" | "step" | "submit" | "approve" | "sendback" | "escalate" | "notice" | "reopened";
export interface CoordEntry { t: number; by: string; k: CoordKind; id?: string }
// missions, resources, volunteers and sos stay as empty legacy fields so the map component (unchanged) still compiles. Nothing writes to them any more.
export interface Doc { issues: Issue[]; missions: Mission[]; resources: Resource[]; volunteers: Volunteer[]; events: Ev[]; demo: number; sos?: Sos[]; notices?: Notice[]; authorities?: Authority[]; digestAt?: number; memberCount?: number; coordLog?: CoordEntry[] }
export interface Who { role: Role; name: string }
export interface Insights { source: "rules" | "ai"; summary: string; bullets: { title: string; detail: string }[] }
export interface SuggestInput { title: string; desc: string; cat?: Cat; lat: number; lng: number }

export type Action =
  | { t: "report"; title: string; desc: string; cat: Cat; priority: Priority; lat: number; lng: number; photo?: string; agent?: { lang: string; original: string; summaryEn: string; source: string } }
  | { t: "merge"; id: string }
  | { t: "verify"; id: string; v: Verif }
  | { t: "advance"; id: string }
  | { t: "proof"; id: string; text: string; photo?: string }
  | { t: "flag"; id: string }
  | { t: "withdraw"; id: string }
  | { t: "spam"; id: string }
  | { t: "hide"; id: string }
  | { t: "restore"; id: string }
  | { t: "noticeAdd"; title: string; body: string; urgent: boolean; pinned: boolean }
  | { t: "noticeRemove"; id: string }
  | { t: "authoritySet"; name: string; email: string; phone: string }
  | { t: "authorityRemove"; id: string }
  | { t: "handoff"; id: string; authorityId: string; ref: string }
  | { t: "handoffStatus"; id: string; status: Handoff["status"]; ref?: string }
  | { t: "agentStart"; id: string; lang: string; original: string; summaryEn: string; source: string }
  | { t: "agentDraft"; id: string; lang?: "en" | "hi"; subject?: string; body?: string }
  | { t: "agentApprove"; id: string }
  | { t: "agentSend"; id: string; via: "copied" | "emailed" | "mailto" | "simulated"; ref?: string; emailTo?: string }
  | { t: "agentReply"; id: string; text: string; ref?: string; status?: "acknowledged" | "resolved" }
  | { t: "agentRef"; id: string; ref: string }
  | { t: "agentEscalate"; id: string }
  | { t: "approveResolution"; id: string; note?: string }
  | { t: "rejectResolution"; id: string; reason: string }
  | { t: "reporterConfirm"; id: string; ok: boolean; note?: string }
  | { t: "closeUnconfirmed"; id: string; note?: string }
  | { t: "feedback"; id: string; ok: boolean; note?: string }
  | { t: "update"; id: string; text: string; photo?: string }
  | { t: "demo" }
  | { t: "reset" };

// Two roles only: resident and coordinator (stored as "admin").
// The server uses the same table, so anything not listed here is refused there too.
const ALL: Role[] = ["resident", "admin"];
export const CAN: Record<Action["t"], readonly Role[]> = {
  report: ALL, merge: ALL, verify: ["admin"], advance: ["admin"], proof: ["admin"], flag: ["resident"],
  noticeAdd: ["admin"], noticeRemove: ["admin"],
  authoritySet: ["admin"], authorityRemove: ["admin"], handoff: ["admin"], handoffStatus: ["admin"],
  agentStart: ALL, agentDraft: ALL, agentApprove: ALL, agentSend: ALL, agentReply: ["admin"], agentRef: ALL, agentEscalate: ["admin"],
  withdraw: ALL, spam: ["admin"], hide: ["admin"], restore: ["admin"],
  approveResolution: ["admin"], rejectResolution: ["admin"], reporterConfirm: ALL, closeUnconfirmed: ["admin"], feedback: ALL, update: ALL,
  demo: ALL, reset: ALL,
};
export const can = (r: Role, t: Action["t"]) => !!CAN[t]?.includes(r);
/** Different coordinators needed to verify a report, and to hide one as spam. */
export const COORDS_TO_VERIFY = 2, SPAM_FLAGS_TO_HIDE = 2;

const ago = (m: number) => Date.now() - m * 60000;
const svg = (body: string) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#10192e"/><rect y="120" width="320" height="80" fill="#1b2540"/><rect y="150" width="320" height="4" fill="#2a3658"/>${body}</svg>`);
export const DEMO_BEFORE = svg('<g fill="#6b5a3a"><circle cx="70" cy="140" r="18"/><circle cx="110" cy="152" r="14"/><circle cx="150" cy="138" r="20"/><circle cx="210" cy="148" r="16"/><circle cx="250" cy="142" r="19"/></g><g fill="#3f7a4a"><rect x="60" y="128" width="14" height="10"/><rect x="140" y="126" width="12" height="9"/><rect x="240" y="130" width="14" height="9"/></g><text x="10" y="20" fill="#ff7683" font-family="sans-serif" font-size="12">BEFORE (simulated illustration)</text>');
export const DEMO_AFTER = svg('<g fill="#2dff9a" opacity=".6"><circle cx="40" cy="132" r="7"/><circle cx="280" cy="130" r="8"/></g><rect x="20" y="168" width="280" height="3" fill="#3de8ff" opacity=".4"/><text x="10" y="20" fill="#2dff9a" font-family="sans-serif" font-size="12">AFTER (simulated illustration)</text>');

export function seed(): Doc {
  const mk = (id: string, title: string, cat: Cat, lat: number, lng: number, priority: Priority, status: Status, verif: Verif, reports: number, mins: number, proofText?: string): Issue => ({
    id, title, cat, desc: "Simulated demo report.", lat, lng, priority, status, verif, reports, photo: id === "i4" ? DEMO_BEFORE : undefined, author: "Demo resident", confirmedBy: [], flags: [], created: ago(mins),
    proof: proofText ? [{ t: ago(mins * 0.8), by: "Demo coordinator", text: proofText }] : [],
    resolvedAt: status === "resolved" ? ago(mins * 0.8) : undefined,
    log: [{ t: ago(mins), by: "Demo resident", text: "Issue reported" }],
  });
  return {
    demo: 0, sos: [], missions: [], resources: [], volunteers: [],
    issues: [
      mk("i1", "Deep pothole near Bus Stop 4", "pothole", 28.5692, 77.2078, "high", "review", "review", 3, 300),
      mk("i2", "Streetlights out on Park Lane", "streetlight", 28.564, 77.207, "medium", "progress", "verified", 2, 900),
      mk("i3", "Water leak outside Block C", "water", 28.5668, 77.2152, "high", "assigned", "verified", 4, 600),
      mk("i4", "Garbage piled on Lakeview Road", "garbage", 28.5655, 77.2125, "medium", "reported", "unverified", 1, 120),
      mk("i5", "Overflowing bins near market", "garbage", 28.566, 77.2133, "medium", "reported", "unverified", 2, 90),
      mk("i6", "Dumped waste at park gate", "garbage", 28.5649, 77.2117, "high", "review", "review", 1, 60),
      mk("i7", "Open manhole on Elm Street", "unsafe", 28.57, 77.211, "critical", "reported", "unverified", 1, 20),
      mk("i8", "Pothole on Main Street", "pothole", 28.563, 77.214, "medium", "resolved", "resolved", 2, 4000, "Simulated after-photo: road patched"),
      mk("i9", "Broken bench at playground", "other", 28.5675, 77.2065, "low", "resolved", "resolved", 1, 3000, "Simulated after-photo: bench replaced"),
      mk("i10", "Fallen tree blocking Park Lane", "blocked", 28.5648, 77.2082, "high", "reported", "unverified", 2, 45),
    ],
    events: [{ t: Date.now(), text: "Demo neighbourhood loaded (simulated data)", tone: "info" }],
    notices: [{ id: "n1", title: "Cleanup this Sunday", body: "Simulated notice. Everyone is welcome to report problems on the map.", author: "Coordinator (demo)", created: ago(600), pinned: true, urgent: false }],
    authorities: [{ id: "au1", name: "Municipal ward office (demo)", email: "", phone: "" }],
    coordLog: [
      { t: ago(50), by: "Coordinator (demo)", k: "verify", id: "i1" }, { t: ago(45), by: "Coordinator (demo)", k: "step", id: "i1" },
      { t: ago(30), by: "Asha K. (demo coordinator)", k: "verify", id: "i2" }, { t: ago(20), by: "Asha K. (demo coordinator)", k: "approve", id: "i5" },
    ],
  };
}

export const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const KW: Record<Cat, string[]> = {
  pothole: ["pothole", "crater", "road"], garbage: ["garbage", "trash", "waste", "bin", "litter", "dump"],
  streetlight: ["light", "lamp", "dark"], water: ["water", "leak", "pipe", "flood", "tanker"],
  unsafe: ["unsafe", "manhole", "wire", "crime", "stray"], blocked: ["blocked", "fallen tree", "tree fell", "road closed", "barricade", "obstruction"], other: [],
};
const STOP = new Set(["the", "and", "for", "with", "near", "from", "this", "that", "are", "was", "has", "have", "not", "all", "over", "out", "its", "into", "there", "very"]);
const tok = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w)));
const jac = (a: Set<string>, b: Set<string>) => { let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n / (a.size + b.size - n || 1); };
export function suggest(d: Doc, i: SuggestInput) {
  const t = (i.title + " " + i.desc).toLowerCase();
  let cat: Cat = i.cat ?? "other", best = 0;
  CATS.forEach(c => { const n = KW[c].filter(k => t.includes(k)).length; if (n > best) { best = n; cat = c; } });
  const words = tok(i.title + " " + i.desc);
  const candidates = d.issues.filter(x => x.status !== "resolved" && !x.hidden && dist(x, i) < 300)
    .map(x => ({ issue: x, score: jac(words, tok(x.title + " " + x.desc)) * 0.6 + (x.cat === cat ? 0.25 : 0) + (1 - dist(x, i) / 300) * 0.15 }))
    .filter(c => c.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 3);
  const dup = candidates[0] && candidates[0].score >= 0.4 ? candidates[0].issue : undefined;
  return { cat, dup, candidates };
}

export function crisisZones(d: Doc) {
  const zones: { cat: Cat; lat: number; lng: number; count: number }[] = [];
  CATS.forEach(c => {
    const list = d.issues.filter(i => i.cat === c && i.status !== "resolved"), used = new Set<string>();
    list.forEach(i => {
      if (used.has(i.id)) return;
      const nb = list.filter(j => dist(i, j) < 250);
      if (nb.length >= 3) {
        nb.forEach(j => used.add(j.id));
        zones.push({ cat: c, count: nb.reduce((a, j) => a + j.reports, 0), lat: nb.reduce((a, j) => a + j.lat, 0) / nb.length, lng: nb.reduce((a, j) => a + j.lng, 0) / nb.length });
      }
    });
  });
  return zones;
}

export const emptyDoc = (): Doc => ({
  demo: 0, sos: [], issues: [], missions: [], resources: [], volunteers: [],
  events: [{ t: Date.now(), text: "Neighbourhood created. Be the first to report an issue or offer help", tone: "info" }],
});

export function insights(d: Doc): Insights {
  const open = d.issues.filter(i => i.status !== "resolved");
  const byCat = CATS.map(c => [c, open.filter(i => i.cat === c).length] as const).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const zones = crisisZones(d);
  const crit = open.filter(i => i.priority === "critical" && i.verif === "unverified");
  const bullets: Insights["bullets"] = [];
  if (byCat.length) bullets.push({ title: "Recurring problems", detail: byCat.slice(0, 3).map(([c, n]) => `${n} open ${c} report${n > 1 ? "s" : ""}`).join(", ") });
  zones.forEach(z => bullets.push({ title: "Area needing attention", detail: `${z.count} reports of ${z.cat} within one area. A coordinator should review them together` }));
  if (crit.length) bullets.push({ title: "Unreviewed critical reports", detail: crit.map(i => i.title).join("; ") });
  hotspots(d).forEach(h => bullets.push({ title: "Recurring problem area", detail: `${h.n} reports of mostly ${h.cat} within about 150 m in 90 days. This is a pattern in past reports, not a prediction` }));
  return { source: "rules", summary: `${open.length} open issues, ${zones.length} crisis cluster(s).`, bullets };
}

function purgeOld(d: Doc) {
  const now = Date.now();
  if (d.notices) d.notices = d.notices.filter(n => n.pinned || now - n.created < 90 * 86400000).slice(0, 50);
}
export const DEMO = [
  "A resident speaks a report in Hindi. The agent understands it, merges it with the existing garbage report, picks the complaint route and drafts the complaint",
  "The coordinator reviews and verifies the report",
  "The coordinator approves the complaint draft and it is sent (simulated). A reference number comes back",
  "Three days pass with no reply (fast-forward). The agent prepares an escalation draft and waits for approval",
  "The coordinator takes the report on and moves it to Assigned",
  "The coordinator uploads the after photo as proof of the fix",
  "The coordinator asks for review, and a neighbor confirms it looks fixed",
  "A different coordinator approves the resolution. The map turns green and the escalation is cancelled",
];
export const DEMO_HINDI = "हमारी गली में बहुत कचरा जमा हो गया है, बदबू आ रही है और बच्चे बीमार हो सकते हैं।";

const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
/** A plain email address check. The server uses it before emailing a complaint to an authority. */
export const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 120 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(v);
const str = (v: unknown, max: number, label: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} is required`);
  return v.trim().slice(0, max);
};
const num = (v: unknown, label: string) => {
  if (typeof v !== "number" || !isFinite(v)) throw new Error(`${label} must be a number`);
  return v;
};
const img = (p: unknown) => (typeof p === "string" && (p === DEMO_BEFORE || p === DEMO_AFTER || /^data:image\/(jpeg|png|webp);base64,/.test(p) ? p.length < 300000 : /^[0-9a-f-]{36}$/.test(p)) ? p : undefined);

export function reduce(doc: Doc, who: Who, a: Action, bounds?: { lat: number; lng: number; r: number; name?: string }): { doc: Doc; result?: string } {
  if (!a || !can(who.role, a.t)) throw new Error(`The ${who.role} role is not allowed to do this`);
  let d = structuredClone(doc), result: string | undefined;
  purgeOld(d); dueEscalations(d, Date.now(), bounds?.name);
  if (d.coordLog) d.coordLog = d.coordLog.filter(e => e.t >= prevMonthStart(Date.now())).slice(-800);
  const ev = (text: string, tone = "info", to?: string) => { d.events.unshift({ t: Date.now(), text, tone, to }); d.events = d.events.slice(0, 60); };
  const tell = (i: Issue, text: string) => { if (i.author !== who.name) ev(text, "info", i.author); };
  // Work credit for the monthly coordinator table. Only coordinators earn it; the table itself dedupes and caps it.
  const cred = (k: CoordKind, id?: string, by?: string) => { const n = by ?? (who.role === "admin" ? who.name : undefined); if (n) (d.coordLog ??= []).push({ t: Date.now(), by: n, k, id }); };
  const tellAll = (i: Issue, text: string) => reportersOf(i).forEach(n => { if (n !== who.name) ev(text, "info", n); });
  const assigned = (i: Issue | undefined, text: string) => { if (i) (i.assignments ??= []).push({ t: Date.now(), by: who.name, text }); };
  const issue = (id: string) => { const i = d.issues.find(x => x.id === id); if (!i) throw new Error("Issue not found"); return i; };
  const log = (i: Issue, text: string, tone = "info") => { i.log.push({ t: Date.now(), by: who.name, text }); ev(`${i.title}: ${text}`, tone); };
  const inBounds = (lat: number, lng: number) => {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("Invalid location");
    if (bounds && dist(bounds, { lat, lng }) > bounds.r * 1.15) throw new Error("That spot is outside this neighbourhood");
  };
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const nbhd = bounds?.name ?? "our neighbourhood";
  const owns = (i: Issue) => who.role === "admin" || i.author === who.name;
  const makeAgent = (i: Issue, info: { lang: string; original: string; summaryEn: string; source: string }): AgentRecord => {
    const lang = info.lang === "hi" || info.lang === "en" ? info.lang : "other", dl: "en" | "hi" = lang === "hi" ? "hi" : "en", route = routeFor(i.cat);
    const summaryEn = str(info.summaryEn, 300, "Summary"), original = txt(info.original, 600);
    const dft = draftComplaint({ lang: dl, level: 0, to: route.authority, nbhd, cat: i.cat, summaryEn, original, lat: i.lat, lng: i.lng, reports: i.reports, created: i.created, hasPhoto: !!i.photo, verified: i.verif === "verified" || i.verif === "resolved" });
    return { lang, original, summaryEn, source: info.source === "ai" || info.source === "scripted" ? info.source : "rules", draft: { level: 0, to: route.authority, lang: dl, ...dft }, history: [], created: Date.now() };
  };

  switch (a.t) {
    case "report": {
      if (!CATS.includes(a.cat) || !PRIORITIES.includes(a.priority)) throw new Error("Invalid category or priority");
      const lat = num(a.lat, "Latitude"), lng = num(a.lng, "Longitude");
      inBounds(lat, lng);
      if (d.issues.length >= 2000) throw new Error("This neighbourhood has reached its report limit");
      if (d.issues.filter(i => i.author === who.name && i.status !== "resolved" && !i.hidden).length >= 15) throw new Error("You already have 15 open reports. Wait for some to be resolved");
      const n: Issue = {
        id: uid("i"), title: str(a.title, 120, "Title"), desc: (typeof a.desc === "string" ? a.desc : "").trim().slice(0, 1000),
        cat: a.cat, priority: a.priority, lat, lng, status: "reported", verif: "unverified", reports: 1, proof: [], log: [],
        created: Date.now(), photo: img(a.photo), author: who.name, confirmedBy: [], flags: [],
      };
      if (a.agent) n.agent = makeAgent(n, a.agent);
      d.issues.push(n); log(n, "Reported. Unverified until a coordinator reviews it", "alert"); result = n.id; break;
    }
    case "merge": {
      const i = issue(a.id);
      if (i.hidden) throw new Error("Issue not found");
      if (i.author === who.name) throw new Error("You reported this one already");
      if (i.confirmedBy.includes(who.name)) throw new Error("You already confirmed this issue");
      i.confirmedBy.push(who.name); i.reports += 1; log(i, "Another resident confirmed this issue (+1 report)"); break;
    }
    case "withdraw": {
      const i = issue(a.id);
      if (i.author !== who.name) throw new Error("Only the author can withdraw a report");
      if (i.status !== "reported") throw new Error("A coordinator already started on this report");
      i.hidden = true; ev("A report was withdrawn by its author"); break;
    }
    case "spam": {
      const i = issue(a.id);
      if (i.author === who.name) throw new Error("You cannot flag your own report");
      if (i.flags.includes(who.name)) throw new Error("You already flagged this report");
      i.flags.push(who.name);
      if (i.flags.length >= SPAM_FLAGS_TO_HIDE && !i.hidden) { i.hidden = true; ev("A report was hidden after two coordinators flagged it as spam", "alert"); }
      else log(i, `Flagged as spam by a coordinator (${i.flags.length} of ${SPAM_FLAGS_TO_HIDE})`, "alert");
      break;
    }
    case "hide": { const i = issue(a.id); i.hidden = true; ev("A coordinator hid a report", "info"); break; }
    case "restore": { const i = issue(a.id); i.hidden = false; i.flags = []; ev("A coordinator restored a report", "info"); break; }
    case "verify": {
      const i = issue(a.id);
      if (!["verified", "disputed", "review"].includes(a.v)) throw new Error("Invalid verification state");
      if (a.v !== "verified") { i.verifiedBy = []; i.verif = a.v; log(i, `Marked ${a.v} by a coordinator`, "info"); break; }
      const by = i.verifiedBy ?? [];
      if (by.includes(who.name)) throw new Error("You already checked this report. A different coordinator must verify it too");
      i.verifiedBy = [...by, who.name]; cred("verify", i.id);
      if (i.verifiedBy.length >= COORDS_TO_VERIFY) { i.verif = "verified"; log(i, `Verified by two coordinators (${i.verifiedBy.length} of ${COORDS_TO_VERIFY})`, "ok"); }
      else log(i, `Checked by a coordinator (${i.verifiedBy.length} of ${COORDS_TO_VERIFY}). A different coordinator must verify it too`, "info");
      break;
    }
    case "advance": {
      const i = issue(a.id), next = STATUSES[STATUSES.indexOf(i.status) + 1];
      if (!next) throw new Error("Already resolved");
      if (next === "resolved") throw new Error("A different coordinator must review and approve the fix");
      if (next === "pending" && !i.proof.length) throw new Error("Add proof of fix before asking for review");
      i.status = next; cred(next === "pending" ? "submit" : "step", i.id);
      if (next === "review") i.verif = "review";
      if (next === "pending") { i.pendingBy = who.name; i.pendingAt = Date.now(); i.closure = undefined; }
      if (next === "pending") reportersOf(i).forEach(n => { if (n !== who.name) ev(`Is the problem fixed? "${i.title}" was marked as done. Please check and answer Yes or Not fully.`, "alert", n); });
      else tell(i, `Your report "${i.title}" is now: ${STATUS_LABEL[next]}`);
      log(i, `Status moved to ${next}`, "info"); break;
    }
    case "approveResolution": {
      const i = issue(a.id);
      if (i.status !== "pending") throw new Error("This fix is not waiting for review");
      if (i.pendingBy === who.name) throw new Error("A different reviewer must approve this fix");
      const fb = Object.values(i.feedback ?? {});
      if (fb.filter(f => !f.ok).length > fb.filter(f => f.ok).length) throw new Error("Neighbors say it is not fully fixed. Review the feedback or request more work");
      i.status = "resolved"; i.verif = "resolved"; i.resolvedAt = Date.now(); i.reviewedBy = who.name; i.closure = "reviewer";
      if (i.agent) i.agent.escalateAt = undefined;
      cred("approve", i.id);
      tellAll(i, `The report "${i.title}" was verified as resolved`);
      log(i, `Resolution approved${txt(a.note, 200) ? `: ${txt(a.note, 200)}` : ""}`, "ok"); break;
    }
    case "rejectResolution": {
      const i = issue(a.id);
      if (i.status !== "pending") throw new Error("This fix is not waiting for review");
      cred("sendback", i.id); if (i.pendingBy) cred("reopened", i.id, i.pendingBy);
      i.status = "progress"; i.verif = "disputed"; i.rejections = (i.rejections ?? 0) + 1; i.pendingBy = undefined;
      tellAll(i, `The fix for "${i.title}" needs more work`);
      log(i, `Fix not approved: ${str(a.reason, 200, "Reason")}`, "alert"); break;
    }
    case "reporterConfirm": {
      const i = issue(a.id);
      const reopenClosed = i.status === "resolved" && i.closure === "unconfirmed" && !a.ok;
      if (i.hidden || (i.status !== "pending" && !reopenClosed)) throw new Error("This fix is not waiting for your answer");
      if (i.pendingBy === who.name) throw new Error("You submitted this fix, so someone else must confirm it");
      if (!reportersOf(i).includes(who.name)) throw new Error("Only the person who reported this problem, or someone who confirmed it, can answer this");
      const note = txt(a.note, 200);
      if (!a.ok) {
        if (i.pendingBy) cred("reopened", i.id, i.pendingBy);
        i.status = "progress"; i.verif = "disputed"; i.rejections = (i.rejections ?? 0) + 1;
        i.pendingBy = undefined; i.pendingAt = undefined; i.resolvedAt = undefined; i.closure = undefined; i.reviewedBy = undefined; i.feedback = {};
        tellAll(i, `A reporter says "${i.title}" is not fully fixed. It is back in progress.`);
        log(i, `A reporter says it is not fully fixed${note ? `: ${note}` : ""}. Back in progress`, "alert"); break;
      }
      (i.feedback ??= {})[who.name] = { ok: true, note, t: Date.now() };
      const fb = Object.values(i.feedback);
      if (fb.filter(f => !f.ok).length > fb.filter(f => f.ok).length) throw new Error("Other neighbors say it is not fully fixed. A coordinator should review it");
      i.status = "resolved"; i.verif = "resolved"; i.resolvedAt = Date.now(); i.reviewedBy = who.name; i.closure = "reporter";
      if (i.agent) i.agent.escalateAt = undefined;
      tellAll(i, `The fix for "${i.title}" was confirmed by a reporter. It is resolved.`);
      log(i, `Confirmed as fixed by a reporter${note ? `: ${note}` : ""}`, "ok"); break;
    }
    case "closeUnconfirmed": {
      const i = issue(a.id);
      if (i.hidden || i.status !== "pending") throw new Error("This fix is not waiting for confirmation");
      const left = pendingSince(i) + UNCONFIRMED_AFTER_MS - Date.now();
      if (left > 0) throw new Error(`Give the reporters ${Math.ceil(left / 864e5)} more day(s) to answer before closing without confirmation`);
      const fb = Object.values(i.feedback ?? {});
      if (fb.filter(f => !f.ok).length > fb.filter(f => f.ok).length) throw new Error("Neighbors say it is not fully fixed. Review the feedback or request more work");
      i.status = "resolved"; i.resolvedAt = Date.now(); i.reviewedBy = who.name; i.closure = "unconfirmed";
      if (i.agent) i.agent.escalateAt = undefined;
      tellAll(i, `"${i.title}" was closed without confirmation because nobody answered. If it is still broken, you can reopen it.`);
      log(i, `Closed without confirmation: nobody answered in ${Math.round(UNCONFIRMED_AFTER_MS / 864e5)} days${txt(a.note, 200) ? `. ${txt(a.note, 200)}` : ""}`, "info"); break;
    }
    case "feedback": {
      const i = issue(a.id);
      if (i.hidden || (i.status !== "pending" && i.status !== "resolved")) throw new Error("Feedback opens when a fix is waiting for review");
      (i.feedback ??= {})[who.name] = { ok: !!a.ok, note: txt(a.note, 200), t: Date.now() };
      log(i, a.ok ? "A neighbor says it looks fixed" : "A neighbor says it is not fully fixed", a.ok ? "info" : "alert"); break;
    }
    case "update": {
      const i = issue(a.id);
      if (i.hidden) throw new Error("Issue not found");
      const text = txt(a.text, 500), photo = img(a.photo);
      if (!text && !photo) throw new Error("Add a note or a photo");
      if ((i.updates ??= []).length >= 40) throw new Error("This issue already has many updates");
      i.updates.push({ t: Date.now(), by: who.name, text, photo }); log(i, "Update added", "info"); break;
    }
    case "proof": {
      const i = issue(a.id), text = typeof a.text === "string" ? a.text.trim().slice(0, 500) : "", photo = img(a.photo);
      if (!text && !photo) throw new Error("Add a note or a photo");
      i.proof.push({ t: Date.now(), by: who.name, text, photo });
      if (i.status === "assigned") i.status = "progress";
      log(i, "Progress evidence uploaded", "ok"); break;
    }
    case "flag": {
      const i = issue(a.id);
      if (i.status === "resolved") { i.status = "review"; i.verif = "disputed"; log(i, "Flagged as not fully fixed. Sent back for review", "alert"); }
      else log(i, "Flagged for coordinator attention", "alert");
      break;
    }
    case "agentStart": {
      const i = issue(a.id);
      if (i.agent) throw new Error("The agent already started on this issue");
      if (!owns(i) && !i.confirmedBy.includes(who.name)) throw new Error("Only the author, someone who confirmed it, or a coordinator can start the agent");
      i.agent = makeAgent(i, a); log(i, "AI agent prepared a complaint draft", "ok"); break;
    }
    case "agentDraft": {
      const i = issue(a.id), A = i.agent;
      if (!A) throw new Error("Start the agent first");
      if (!owns(i)) throw new Error("Only the author or a coordinator can change the draft");
      if (A.draft.sentAt) throw new Error("This complaint was already sent");
      if (typeof a.subject === "string" || typeof a.body === "string") {
        A.draft.subject = str(a.subject ?? A.draft.subject, 200, "Subject"); A.draft.body = str(a.body ?? A.draft.body, 3000, "Complaint text"); A.draft.edited = true;
      } else {
        const dl = a.lang === "hi" || a.lang === "en" ? a.lang : A.draft.lang, last = A.history[A.history.length - 1];
        const g = draftComplaint({ lang: dl, level: A.draft.level, to: A.draft.to, nbhd, cat: i.cat, summaryEn: A.summaryEn, original: A.original, lat: i.lat, lng: i.lng, reports: i.reports, created: i.created, hasPhoto: !!i.photo, verified: i.verif === "verified" || i.verif === "resolved", prev: A.draft.level > 0 && last ? { to: last.to, sentAt: last.sentAt, ref: last.ref } : undefined });
        A.draft = { level: A.draft.level, to: A.draft.to, lang: dl, ...g };
      }
      A.draft.approvedAt = undefined; A.draft.approvedBy = undefined; break;
    }
    case "agentApprove": {
      const i = issue(a.id), A = i.agent;
      if (!A) throw new Error("Start the agent first");
      if (!owns(i)) throw new Error("Only the author or a coordinator can approve");
      if (A.draft.sentAt) throw new Error("This complaint was already sent");
      A.draft.approvedAt = Date.now(); A.draft.approvedBy = who.name; log(i, "Complaint approved by a person", "ok"); break;
    }
    case "agentSend": {
      const i = issue(a.id), A = i.agent;
      if (!A) throw new Error("Start the agent first");
      if (!owns(i)) throw new Error("Only the author or a coordinator can mark this as sent");
      if (!A.draft.approvedAt) throw new Error("Approve the complaint before sending it");
      if (A.draft.sentAt) throw new Error("This complaint was already sent");
      if (!["copied", "emailed", "mailto", "simulated"].includes(a.via)) throw new Error("Invalid way of sending");
      const mailed = a.via === "emailed" || a.via === "mailto";
      if (mailed) {
        if (who.role !== "admin") throw new Error("Only a coordinator can email a complaint");
        if (!isEmail(a.emailTo)) throw new Error("Enter a valid email address for the authority");
      }
      const now = Date.now(), ref = txt(a.ref, 60), wait = routeFor(i.cat).ladder[A.draft.level]?.waitDays;
      A.draft.sentAt = now; A.draft.via = a.via; A.draft.emailedTo = mailed ? a.emailTo : undefined;
      A.history.push({ level: A.draft.level, to: A.draft.to, sentAt: now, ref: ref || undefined });
      i.handoff = { to: A.draft.to, email: mailed ? a.emailTo : undefined, ref, sentAt: now, by: who.name, status: "sent" };
      A.escalateAt = wait ? now + wait * 86400000 : undefined; cred("escalate", i.id);
      log(i, `Complaint ${a.via === "emailed" ? `emailed to ${a.emailTo}` : a.via === "mailto" ? `emailed to ${a.emailTo} from the coordinator's own email` : `sent to ${A.draft.to}`}${a.via === "simulated" ? " (simulated)" : ""}${ref ? `. Reference ${ref}` : ""}`, "ok"); break;
    }
    case "agentReply": {
      const i = issue(a.id), A = i.agent;
      if (!A || !i.handoff) throw new Error("Send the complaint first");
      const text = str(a.text, 1000, "The reply");
      (A.replies ??= []).push({ t: Date.now(), by: who.name, text });
      A.replies = A.replies.slice(-20);
      const ref = txt(a.ref, 60);
      if (ref) { i.handoff.ref = ref; const last = A.history[A.history.length - 1]; if (last) last.ref = ref; }
      if (a.status !== undefined) {
        if (!["acknowledged", "resolved"].includes(a.status)) throw new Error("Invalid status");
        i.handoff.status = a.status;
      }
      log(i, `Authority reply recorded${ref ? `. Reference ${ref}` : ""}${a.status ? `. Marked ${a.status}` : ""}`, "ok"); break;
    }
    case "agentRef": {
      const i = issue(a.id), A = i.agent;
      if (!A || !i.handoff) throw new Error("Send the complaint first");
      if (!owns(i)) throw new Error("Only the author or a coordinator can record this");
      const ref = str(a.ref, 60, "Reference number");
      i.handoff.ref = ref; const last = A.history[A.history.length - 1]; if (last) last.ref = ref;
      log(i, `Reference number received: ${ref}`, "ok"); break;
    }
    case "agentEscalate": {
      const i = issue(a.id);
      if (!i.agent) throw new Error("Start the agent first");
      if (i.status === "resolved") throw new Error("This issue is already resolved");
      if (!escalate(i, nbhd)) throw new Error("Nothing to escalate yet, or this is the last level. Consider contacting your elected representative or filing a right-to-information request");
      log(i, "Escalation draft prepared. Review and approve it to send", "alert"); break;
    }
    case "noticeAdd": {
      const n: Notice = { id: uid("n"), title: str(a.title, 100, "Title"), body: txt(a.body, 1000), author: who.name, created: Date.now(), pinned: !!a.pinned, urgent: !!a.urgent };
      cred("notice", n.id); (d.notices ??= []).unshift(n); d.notices = d.notices.slice(0, 50); ev(`${n.urgent ? "Urgent notice" : "Notice"}: ${n.title}`, n.urgent ? "alert" : "info"); result = n.id; break;
    }
    case "noticeRemove": { d.notices = (d.notices ?? []).filter(n => n.id !== a.id); break; }
    case "authoritySet": {
      const email = txt(a.email, 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address looks wrong");
      const list = (d.authorities ??= []);
      if (list.length >= 20) throw new Error("The directory is full");
      list.push({ id: uid("au"), name: str(a.name, 60, "Name"), email, phone: txt(a.phone, 30) }); break;
    }
    case "authorityRemove": { d.authorities = (d.authorities ?? []).filter(x => x.id !== a.id); break; }
    case "handoff": {
      const i = issue(a.id), au = (d.authorities ?? []).find(x => x.id === a.authorityId);
      if (!au) throw new Error("Choose an authority from the directory");
      i.handoff = { to: au.name, email: au.email || undefined, ref: txt(a.ref, 60), sentAt: Date.now(), by: who.name, status: "sent" };
      cred("escalate", i.id); log(i, `Handed off to ${au.name}`, "ok"); break;
    }
    case "handoffStatus": {
      const i = issue(a.id);
      if (!i.handoff) throw new Error("This issue has not been handed off");
      if (!["sent", "acknowledged", "resolved", "no_response"].includes(a.status)) throw new Error("Invalid status");
      i.handoff.status = a.status; if (typeof a.ref === "string") i.handoff.ref = a.ref.slice(0, 60);
      log(i, `Authority response: ${a.status.replace("_", " ")}`, "info"); break;
    }
    case "demo": {
      const step = d.demo, t = "i4", R = "Resident (demo)", C = "Coordinator (demo)";
      if (step >= DEMO.length) throw new Error("Demo finished. Reset to run it again");
      const as = (role: Role, name: string, x: Action) => { d = reduce(d, { role, name }, x).doc; };
      const iss = () => d.issues.find(i => i.id === t)!;
      if (step === 0) {
        const dup = suggest(d, { title: "Garbage all over Lakeview Road", desc: "Trash dumped near the bins", cat: "garbage", lat: 28.5654, lng: 77.2126 }).dup;
        if (dup) as("resident", R, { t: "merge", id: dup.id });
        as("resident", R, { t: "agentStart", id: t, lang: "hi", original: DEMO_HINDI, summaryEn: "Garbage has piled up on the street, causing a bad smell, and children's health may be at risk.", source: "scripted" });
      }
      if (step === 1) { as("admin", C, { t: "advance", id: t }); as("admin", C, { t: "verify", id: t, v: "verified" }); as("admin", "Coordinator B (demo)", { t: "verify", id: t, v: "verified" }); as("admin", C, { t: "agentDraft", id: t }); }
      if (step === 2) { as("admin", C, { t: "agentApprove", id: t }); as("admin", C, { t: "agentSend", id: t, via: "simulated", ref: "DEMO-2043" }); }
      if (step === 3) { iss().agent!.escalateAt = Date.now() - 1000; dueEscalations(d, Date.now(), nbhd); }
      if (step === 4) as("admin", C, { t: "advance", id: t });
      if (step === 5) as("admin", C, { t: "proof", id: t, text: "Simulated after photo: bags collected, the whole road cleared", photo: DEMO_AFTER });
      if (step === 6) { as("admin", C, { t: "advance", id: t }); as("resident", R, { t: "feedback", id: t, ok: true, note: "The street looks clean now" }); }
      if (step === 7) as("admin", "Coordinator B (demo)", { t: "approveResolution", id: t, note: "Evidence checked against the original photo" });
      d.demo = step + 1; break;
    }
    case "reset": return { doc: seed() };
    default: throw new Error("Unknown action");
  }
  return { doc: d, result };
}

export interface Stats { reports: number; confirms: number; proofs: number }
const blank = (): Stats => ({ reports: 0, confirms: 0, proofs: 0 });
const goodV = (i: Issue) => i.verif === "verified" || i.verif === "resolved";
export function statsFor(d: Doc) {
  const m = new Map<string, Stats>(), g = (n: string) => { let x = m.get(n); if (!x) { x = blank(); m.set(n, x); } return x; };
  d.issues.forEach(i => {
    if (i.hidden) return;
    if (goodV(i)) { g(i.author).reports++; i.confirmedBy.forEach(n => { g(n).confirms++; }); }
    if (i.status === "resolved" && i.closure !== "unconfirmed") i.proof.forEach(p => { g(p.by).proofs++; });
  });
  m.delete("Former member"); m.delete("System");
  return m;
}
export const points = (s: Stats) => s.reports * 3 + s.confirms + s.proofs * 3;
// ---- Monthly coordinator table. Fixed visible rules; it restarts on the 1st of every month (UTC), so old work never competes with new work. ----
export const COORD_POINTS: Record<CoordKind | "resolved" | "confirmedBonus", number> = { verify: 2, step: 1, submit: 2, approve: 3, sendback: 1, escalate: 2, notice: 1, reopened: -2, resolved: 5, confirmedBonus: 2 };
export const COORD_NOTICE_CAP = 3;
export const COORD_MIN_RATINGS = 5;
export const monthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export const nextMonthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
export const prevMonthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1); };
export interface CoordRow { name: string; role: string; score: number; fixes: number; reviews: number; escalations: number; reopened: number; rating: { ok: number; total: number } | null; rank: number }
export function coordinatorBoard(d: Doc, coords: { name: string; role: string }[], now = Date.now()) {
  const from = monthStart(now), to = nextMonthStart(now), inMonth = (t?: number) => t != null && t >= from && t < to;
  const rows = new Map<string, CoordRow & { ok: number; bad: number }>();
  coords.forEach(c => { if (!rows.has(c.name)) rows.set(c.name, { name: c.name, role: c.role, score: 0, fixes: 0, reviews: 0, escalations: 0, reopened: 0, rating: null, rank: 0, ok: 0, bad: 0 }); });
  const seen = new Set<string>(), notices = new Map<string, number>();
  for (const e of d.coordLog ?? []) {
    const r = rows.get(e.by);
    if (!r || !inMonth(e.t)) continue;
    const key = `${e.by}|${e.k}|${e.id ?? ""}`;
    if (seen.has(key)) continue; // one credit per person, kind and item, so repeating clicks earns nothing
    if (e.k === "notice") { const n = (notices.get(e.by) ?? 0) + 1; notices.set(e.by, n); if (n > COORD_NOTICE_CAP) continue; }
    seen.add(key);
    r.score += COORD_POINTS[e.k];
    if (e.k === "approve" || e.k === "sendback") r.reviews++;
    if (e.k === "escalate") r.escalations++;
    if (e.k === "reopened") r.reopened++;
  }
  d.issues.forEach(i => {
    const r = i.pendingBy ? rows.get(i.pendingBy) : undefined;
    if (!r || i.hidden) return;
    if (i.status === "resolved" && inMonth(i.resolvedAt)) { r.fixes++; r.score += COORD_POINTS.resolved + (i.closure === "reporter" ? COORD_POINTS.confirmedBonus : 0); }
    if (inMonth(i.resolvedAt) || inMonth(i.pendingAt)) Object.entries(i.feedback ?? {}).forEach(([n, f]) => { if (n === r.name) return; if (f.ok) r.ok++; else r.bad++; });
  });
  const list = [...rows.values()].map(r => ({ ...r, rating: r.ok + r.bad >= COORD_MIN_RATINGS ? { ok: r.ok, total: r.ok + r.bad } : null }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  list.forEach((r, n) => { r.rank = n > 0 && list[n - 1].score === r.score ? list[n - 1].rank : n + 1; });
  return { rows: list.map(({ ok: _o, bad: _b, ...r }) => r as CoordRow), from, resetsAt: to };
}

export function hotspots(d: Doc) {
  const now = Date.now(), cells = new Map<string, { n: number; lat: number; lng: number; cats: Map<Cat, number> }>();
  d.issues.forEach(i => {
    if (i.hidden || now - i.created > 90 * 86400000) return;
    const k = `${Math.round(i.lat / 0.0015)}:${Math.round(i.lng / 0.0015)}`;
    let c = cells.get(k); if (!c) { c = { n: 0, lat: 0, lng: 0, cats: new Map() }; cells.set(k, c); }
    c.n++; c.lat += i.lat; c.lng += i.lng; c.cats.set(i.cat, (c.cats.get(i.cat) ?? 0) + 1);
  });
  return [...cells.values()].filter(c => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3)
    .map(c => ({ n: c.n, lat: c.lat / c.n, lng: c.lng / c.n, cat: [...c.cats].sort((a, b) => b[1] - a[1])[0][0] }));
}

export function weeklyDigest(d: Doc) {
  const now = Date.now(), w = 7 * 86400000, ins = insights(d);
  const fresh = d.issues.filter(i => !i.hidden && now - i.created < w).length, fixed = d.issues.filter(i => i.resolvedAt && now - i.resolvedAt < w).length;
  return { title: "Weekly neighbourhood summary", body: `This week: ${fresh} new report(s), ${fixed} fixed. ${ins.summary}\n${ins.bullets.map(b => `- ${b.title}: ${b.detail}`).join("\n")}` };
}

function escalate(i: Issue, nbhd: string) {
  const A = i.agent;
  if (!A) return false;
  const last = A.history[A.history.length - 1];
  if (!last || A.draft.level !== last.level) return false;
  const next = routeFor(i.cat).ladder[last.level];
  if (!next) return false;
  const g = draftComplaint({ lang: A.draft.lang, level: last.level + 1, to: next.to, nbhd, cat: i.cat, summaryEn: A.summaryEn, original: A.original, lat: i.lat, lng: i.lng, reports: i.reports, created: i.created, hasPhoto: !!i.photo, verified: i.verif === "verified" || i.verif === "resolved", prev: { to: last.to, sentAt: last.sentAt, ref: last.ref } });
  A.draft = { level: last.level + 1, to: next.to, lang: A.draft.lang, ...g };
  A.escalateAt = undefined;
  return true;
}

export function dueEscalations(d: Doc, now = Date.now(), nbhd = "our neighbourhood") {
  const titles: string[] = [];
  d.issues.forEach(i => {
    if (!i.agent?.escalateAt || now < i.agent.escalateAt || i.status === "resolved" || i.hidden) return;
    if (i.handoff && (i.handoff.status === "acknowledged" || i.handoff.status === "resolved")) { i.agent.escalateAt = undefined; return; }
    if (escalate(i, nbhd)) { i.log.push({ t: now, by: "AI agent", text: "No resolution by the deadline. Escalation draft prepared. Review and approve it to send" }); titles.push(i.title); }
    else i.agent.escalateAt = undefined;
  });
  if (titles.length) d.events.unshift({ t: now, text: `Escalation draft ready: ${titles.join("; ")}`.slice(0, 200), tone: "alert" });
  return titles;
}