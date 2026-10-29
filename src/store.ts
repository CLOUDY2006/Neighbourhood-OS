import { useSyncExternalStore } from "react";
import { createClient } from "@supabase/supabase-js";
import * as L from "./logic";
import { genCity, type MapData } from "./mapdata";
import { demoWorld, simulatedAlert, type Alert, type WorldEvent } from "./world";
import { understand, type Analysis } from "./agent";
import * as C from "./chat";
export * from "./logic";
export * from "./world";
export * from "./agent";
export * from "./routes";
export * from "./plan";
export * from "./chat";
export type { MapData } from "./mapdata";

export type State = L.Doc & { role: L.Role };
export interface NInfo { id: string; kind: "cell" | "named" | "demo"; name: string; lat: number; lng: number; r: number; role: L.Role; members?: number }
export interface Me { id: string; email: string; handle: string; platformAdmin: boolean }
export interface AppState { mode: "none" | "demo" | "live"; ready: boolean; error: string; me: Me | null; mine: NInfo[]; nbhd: NInfo | null; map: MapData | null; mapNote: string; online: boolean; queued: number; stale: boolean; alerts: Alert[]; world: WorldEvent[] | null; worldInfo: { sources: { name: string; ok: boolean; n: number }[]; updated: number } | null; chat?: ChatIds; chatSeen?: ChatIds }
/** Newest message id per chat room you can open (from the server), and the newest one you have seen on this device. */
export type ChatIds = Partial<Record<C.Room, number>>;
export interface Member { userId: string; name: string; role: L.Role; requested: boolean; joined: string }
export interface Place { name: string; lat: number; lng: number }
export interface NearNamed { id: string; name: string; r: number; lat: number; lng: number; members: number }

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const LIVE_AVAILABLE = !!(SB_URL && SB_KEY);
const sb = LIVE_AVAILABLE ? createClient(SB_URL!, SB_KEY!) : null;

const DEMO_KEY = "neighbourhood-os-demo-v4";
export const DEMO_N: NInfo = { id: "demo", kind: "demo", name: "Maple Nagar (fictional demo)", lat: 28.5663, lng: 77.2115, r: 650, role: "resident" };
const enc = encodeURIComponent;

let doc: L.Doc = L.seed();
let role: L.Role = "resident", ver = -1, timer: ReturnType<typeof setInterval> | undefined;
let view: State = { ...doc, role };
let app: AppState = { mode: "none", ready: !LIVE_AVAILABLE, error: "", me: null, mine: [], nbhd: null, map: null, mapNote: "", online: typeof navigator === "undefined" ? true : navigator.onLine, queued: readQ().length, stale: false, alerts: [], world: null, worldInfo: null };
const subs = new Set<() => void>(), subsApp = new Set<() => void>();

function commit() {
  view = { ...doc, role };
  if (app.mode === "demo") { try { localStorage.setItem(DEMO_KEY, JSON.stringify(doc)); } catch { /* ignore */ } }
  cacheDoc();
  subs.forEach(f => f());
}
function setApp(p: Partial<AppState>) { app = { ...app, ...p }; subsApp.forEach(f => f()); }
export const useStore = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => view, () => view);
export const useApp = () => useSyncExternalStore(f => { subsApp.add(f); return () => { subsApp.delete(f); }; }, () => app, () => app);
export const myName = () => (app.mode === "live" ? app.me?.handle ?? "" : `${role === "admin" ? "Coordinator" : "Resident"} (you)`);
export const can = L.can;

export class QueuedError extends Error {}
class HttpErr extends Error { constructor(public status: number, m: string) { super(m); } }
const QKEY = "nos-queue";
interface Queued { nid: string; a: L.Action; at: number }
const QUEUEABLE = new Set<string>(["report", "merge", "proof", "flag", "spam"]);
function readQ(): Queued[] { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { return []; } }
function writeQ(q: Queued[]) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* ignore */ } setApp({ queued: q.filter(x => x.nid === app.nbhd?.id).length }); }
const sameQ = (x: Queued, y: Queued) => x.at === y.at && x.nid === y.nid;
let flushing = false;
async function flushQueue() {
  if (flushing || app.mode !== "live" || !app.nbhd) return;
  const id = app.nbhd.id, mine = readQ().filter(x => x.nid === id);
  if (!mine.length) return;
  flushing = true;
  try {
    for (const item of mine) {
      try {
        const j = await api<{ doc: L.Doc; version: number; role: L.Role }>(`/api/n/${enc(id)}/action`, item.a);
        doc = j.doc; ver = j.version; role = L.asRole(j.role); commit();
        writeQ(readQ().filter(x => !sameQ(x, item)));
      } catch (e) {
        if (e instanceof HttpErr) { writeQ(readQ().filter(x => !sameQ(x, item))); setApp({ error: `A saved action could not be sent: ${e.message}` }); } else break;
      }
    }
  } finally { flushing = false; }
}
function wipeLocal() {
  try { Object.keys(localStorage).filter(k => k.startsWith("nos-doc-") || k === QKEY).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  navigator.serviceWorker?.controller?.postMessage("clear");
  setApp({ queued: 0 });
}
function cacheDoc() {
  if (app.mode !== "live" || !app.nbhd) return;
  try {
    const { sos: _s, authorities: _a, ...rest } = doc;
    localStorage.setItem(`nos-doc-${app.nbhd.id}`, JSON.stringify({ doc: rest, role }));
  } catch { /* ignore */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { setApp({ online: true }); void flushQueue(); void refresh(); });
  window.addEventListener("offline", () => setApp({ online: false }));
  setInterval(() => void flushQueue(), 15000);
}

async function token() { const { data } = await sb!.auth.getSession(); return data.session?.access_token ?? ""; }
async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpErr(r.status, (j as { error?: string }).error || `Request failed (${r.status})`);
  return j as T;
}

function stopPoll() { if (timer) clearInterval(timer); timer = undefined; }
async function refresh() {
  if (app.mode !== "live" || !app.nbhd || document.visibilityState === "hidden") return;
  const id = app.nbhd.id;
  try {
    const j = await api<{ version: number; doc?: L.Doc; role: L.Role; unchanged?: boolean; alerts?: Alert[]; chat?: ChatIds }>(`/api/n/${enc(id)}/state?v=${ver}`);
    if (app.nbhd?.id !== id) return;
    const al = j.alerts ?? [];
    if (JSON.stringify(al) !== JSON.stringify(app.alerts)) setApp({ alerts: al });
    if (j.chat && JSON.stringify(j.chat) !== JSON.stringify(app.chat)) setApp({ chat: j.chat });
    let changed = false;
    if (app.stale || !app.online) setApp({ stale: false, online: true });
    void flushQueue();
    if (L.asRole(j.role) !== role) { role = L.asRole(j.role); changed = true; }
    if (!j.unchanged && j.doc) { ver = j.version; doc = j.doc; changed = true; }
    if (changed) commit();
  } catch { if (!app.stale) setApp({ stale: true }); }
}

async function loadMap(n: NInfo, tries = 0) {
  try {
    const m = await api<MapData | { source: "none"; reason?: "sparse" | "unavailable" | "loading" }>(`/api/n/${enc(n.id)}/map`);
    if (app.nbhd?.id !== n.id) return;
    if (m.source === "none") {
      const why = (m as { reason?: string }).reason;
      const note = why === "loading" ? "Loading the real map from OpenStreetMap. A sample map is shown until it arrives."
        : why === "unavailable" ? "The OpenStreetMap server did not answer, so a sample map is shown for now. Trying again soon."
        : "OpenStreetMap has little data for this area, so a schematic view is shown.";
      setApp({ map: { ...genCity(n.r), places: [] }, mapNote: note });
      // The server keeps downloading in the background, so ask again until the real map is there.
      const again = why === "loading" ? (tries < 40 ? 6000 : 0) : why === "unavailable" && tries < 2 ? 50000 : 0;
      if (again) setTimeout(() => { if (app.nbhd?.id === n.id && app.map?.source === "generated") void loadMap(n, tries + 1); }, again);
    }
    else setApp({ map: m as MapData, mapNote: (m as MapData).sparse ? "Few buildings are mapped here on OpenStreetMap." : "" });
  } catch { if (app.nbhd?.id === n.id) setApp({ map: { ...genCity(n.r), places: [] }, mapNote: "Could not load map data, so a schematic view is shown." }); }
}

export async function enter(n: NInfo) {
  stopPoll();
  role = L.asRole(n.role); ver = -1; doc = L.emptyDoc();
  let cached = false;
  try { const c = JSON.parse(localStorage.getItem(`nos-doc-${n.id}`) || "null"); if (c?.doc) { doc = c.doc; role = L.asRole(c.role ?? n.role); cached = true; } } catch { /* ignore */ }
  setApp({ mode: "live", nbhd: n, map: null, mapNote: "", error: "", alerts: [], stale: cached, queued: readQ().filter(x => x.nid === n.id).length, chat: {}, chatSeen: readSeen(n.id) });
  commit();
  try { localStorage.setItem("nos-last-n", n.id); } catch { /* ignore */ }
  await refresh();
  void loadMap(n);
  timer = setInterval(refresh, 5000);
}
export function enterDemo() {
  stopPoll();
  try { const r = localStorage.getItem(DEMO_KEY); doc = r ? JSON.parse(r) : L.seed(); } catch { doc = L.seed(); }
  role = "resident";
  setApp({ mode: "demo", nbhd: DEMO_N, map: genCity(650), mapNote: "Simulated neighbourhood. The streets and buildings are made up.", alerts: [], chatSeen: readSeen("demo") });
  commit(); demoChatSync();
}
export async function loadWorld() {
  if (app.mode === "demo") { const w = demoWorld(); setApp({ world: w, worldInfo: { sources: [{ name: "Simulated", ok: true, n: w.length }], updated: Date.now() } }); return; }
  const j = await api<{ events: WorldEvent[]; sources: { name: string; ok: boolean; n: number }[]; updated: number }>("/api/world");
  setApp({ world: j.events, worldInfo: { sources: j.sources, updated: j.updated } });
}
export function toggleDemoAlert() { if (app.mode === "demo") setApp({ alerts: app.alerts.length ? [] : [simulatedAlert(DEMO_N)] }); }
export function leave() { stopPoll(); setApp({ mode: "none", nbhd: null, map: null, mapNote: "" }); }
export function setRole(r: L.Role) { if (app.mode === "demo") { role = r; commit(); demoChatSync(); } }

export async function dispatch(a: L.Action): Promise<string | undefined> {
  if (app.mode === "live" && app.nbhd) {
    try {
      const j = await api<{ doc: L.Doc; result?: string; version: number; role: L.Role }>(`/api/n/${enc(app.nbhd.id)}/action`, a);
      doc = j.doc; ver = j.version; role = L.asRole(j.role); commit(); return j.result;
    } catch (e) {
      if (!(e instanceof HttpErr) && QUEUEABLE.has(a.t) && !("photo" in a && a.photo)) {
        writeQ([...readQ(), { nid: app.nbhd.id, a, at: Date.now() }].slice(-50));
        throw new QueuedError("You are offline. Saved on this device and sent automatically when you are back online");
      }
      throw e;
    }
  }
  const j = L.reduce(doc, { role, name: myName() }, a, app.nbhd ? { lat: app.nbhd.lat, lng: app.nbhd.lng, r: 1e7, name: app.nbhd.name } : undefined);
  doc = j.doc; commit(); return j.result;
}

let pendingN: string | null = null, signingIn = false;
try {
  const q = new URLSearchParams(location.search).get("n");
  if (q) { localStorage.setItem("nos-pending-n", q); history.replaceState(null, "", location.pathname); }
  pendingN = localStorage.getItem("nos-pending-n");
} catch { /* ignore */ }

async function onSignedIn() {
  if (signingIn) return;
  signingIn = true;
  try {
    const me = await api<Me>("/api/me");
    const mine = await api<NInfo[]>("/api/neighbourhoods/mine");
    setApp({ me, mine, ready: true, error: "" });
    if (pendingN) {
      const id = pendingN; pendingN = null; localStorage.removeItem("nos-pending-n");
      try { await enter(await api<NInfo>(`/api/neighbourhoods/${enc(id)}/join`, {})); await refreshMine(); } catch (e) { setApp({ error: (e as Error).message }); }
    } else if (app.mode === "none") {
      const last = localStorage.getItem("nos-last-n"), n = mine.find(x => x.id === last);
      if (n) await enter(n);
    }
  } catch (e) { setApp({ ready: true, error: (e as Error).message }); }
  finally { signingIn = false; }
}
function onSignedOut() {
  stopPoll();
  const demo = app.mode === "demo";
  setApp({ me: null, mine: [], mode: demo ? "demo" : "none", nbhd: demo ? app.nbhd : null, map: demo ? app.map : null });
}
if (sb) {
  sb.auth.getSession().then(({ data }) => { if (data.session) void onSignedIn(); else setApp({ ready: true }); });
  sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_IN" && session && !app.me) void onSignedIn(); if (ev === "SIGNED_OUT") onSignedOut(); });
}

export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await sb!.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: location.origin } });
  if (error) throw new Error(error.message);
  return data.session ? "signed-in" : "confirm";
}
export async function signIn(email: string, password: string) { const { error } = await sb!.auth.signInWithPassword({ email, password }); if (error) throw new Error(error.message); }
export async function resetPassword(email: string) { const { error } = await sb!.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw new Error(error.message); }
export async function signOut() { await sb?.auth.signOut(); localStorage.removeItem("nos-last-n"); wipeLocal(); onSignedOut(); }

export async function refreshMine() { setApp({ mine: await api<NInfo[]>("/api/neighbourhoods/mine") }); }
export async function joinCell(cellId: string) { const n = await api<NInfo>("/api/neighbourhoods/cell", { cell: cellId }); await refreshMine(); await enter(n); }
export async function joinById(id: string) { const n = await api<NInfo>(`/api/neighbourhoods/${enc(id)}/join`, {}); await refreshMine(); await enter(n); }
export async function createNamed(i: { name: string; lat: number; lng: number; r: number }) { const n = await api<NInfo>("/api/neighbourhoods", i); await refreshMine(); await enter(n); }
export const cellCount = (cell: string) => api<{ members: number }>(`/api/neighbourhoods/cell-count?cell=${enc(cell)}`);
export const nearbyNamed = (lat: number, lng: number) => api<NearNamed[]>(`/api/neighbourhoods/nearby?lat=${lat}&lng=${lng}`);
export const searchNamed = (q: string) => api<NearNamed[]>(`/api/neighbourhoods/search?q=${enc(q)}`);
export const geocode = (q: string) => api<Place[]>(`/api/geocode?q=${enc(q)}`);
export async function leaveNeighbourhood() { if (!app.nbhd) return; await api(`/api/n/${enc(app.nbhd.id)}/leave`, {}); localStorage.removeItem("nos-last-n"); await refreshMine(); leave(); }
export async function deleteAccount() { await api("/api/me", undefined, "DELETE"); await sb?.auth.signOut(); localStorage.removeItem("nos-last-n"); wipeLocal(); onSignedOut(); }

export const members = () => api<Member[]>(`/api/n/${enc(app.nbhd!.id)}/members`);
export const setMemberRole = (userId: string, r: L.Role) => api(`/api/n/${enc(app.nbhd!.id)}/members/${enc(userId)}/role`, { role: r });
export const coordinators = () => api<{ name: string; role: L.Role }[]>(`/api/n/${enc(app.nbhd!.id)}/coordinators`);
export const auditLog = () => api<{ at: string; who: string; action: string; detail: string }[]>(`/api/n/${enc(app.nbhd!.id)}/audit`);
export const requestCoordinator = () => api(`/api/n/${enc(app.nbhd!.id)}/coordinator-request`, {});
export const uploadPhoto = async (dataUrl: string) => (await api<{ id: string }>(`/api/n/${enc(app.nbhd!.id)}/photos`, { photo: dataUrl })).id;

const urls = new Map<string, Promise<string>>();
export function photoUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return Promise.resolve(src);
  let p = urls.get(src);
  if (!p) {
    p = (async () => {
      const r = await fetch(`/api/photos/${enc(src)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!r.ok) throw new Error("photo unavailable");
      return URL.createObjectURL(await r.blob());
    })();
    urls.set(src, p);
    p.catch(() => urls.delete(src));
  }
  return p;
}

export const report = (i: { title: string; desc: string; cat: L.Cat; priority: L.Priority; lat: number; lng: number; photo?: string; agent?: { lang: string; original: string; summaryEn: string; source: string } }) => dispatch({ t: "report", ...i });
export const merge = (id: string) => dispatch({ t: "merge", id });
export const withdraw = (id: string) => dispatch({ t: "withdraw", id });
export const spam = (id: string) => dispatch({ t: "spam", id });
export const hide = (id: string) => dispatch({ t: "hide", id });
export const restore = (id: string) => dispatch({ t: "restore", id });
export const setVerif = (id: string, v: L.Verif) => dispatch({ t: "verify", id, v });
export const advance = (id: string) => dispatch({ t: "advance", id });
export const addProof = (id: string, text: string, photo?: string) => dispatch({ t: "proof", id, text, photo });
export const flag = (id: string) => dispatch({ t: "flag", id });
export const runDemo = () => dispatch({ t: "demo" });
export const reset = () => { if (app.mode === "demo") { demoChat = C.demoChatSeed(); saveDemoChat(); } return dispatch({ t: "reset" }); };

// ---- Neighbourhood chat. Rooms belong to the neighbourhood you are in; the server checks your membership there.
export interface ChatPage { msgs: C.ChatMsg[]; rev: number; more?: boolean }
const chatBase = (room: C.Room) => `/api/n/${enc(app.nbhd!.id)}/chat/${room}`;
const SEEN_KEY = (nid: string) => `nos-chat-seen-${nid}`;
function readSeen(nid: string): ChatIds { try { return JSON.parse(localStorage.getItem(SEEN_KEY(nid)) || "{}"); } catch { return {}; } }
export function markChatSeen(room: C.Room, id: number) {
  if (!app.nbhd || id <= (app.chatSeen?.[room] ?? 0)) return;
  const seen = { ...app.chatSeen, [room]: id };
  try { localStorage.setItem(SEEN_KEY(app.nbhd.id), JSON.stringify(seen)); } catch { /* ignore */ }
  setApp({ chatSeen: seen });
}
export const chatUnread = (a: AppState, r: L.Role, room?: C.Room) => C.roomsFor(r).some(x => (!room || x.id === room) && (a.chat?.[x.id] ?? 0) > (a.chatSeen?.[x.id] ?? 0));

const DEMO_CHAT_KEY = "neighbourhood-os-demo-chat-v1";
let demoChat: C.DemoMsg[] = (() => { try { const r = localStorage.getItem(DEMO_CHAT_KEY); return r ? JSON.parse(r) : C.demoChatSeed(); } catch { return C.demoChatSeed(); } })();
function saveDemoChat() { try { localStorage.setItem(DEMO_CHAT_KEY, JSON.stringify(demoChat)); } catch { /* ignore */ } demoChatSync(); }
function demoChatSync() {
  if (app.mode !== "demo") return;
  setApp({ chat: Object.fromEntries(C.roomsFor(role).map(r => [r.id, Math.max(0, ...demoChat.filter(m => m.room === r.id && m.state === "ok").map(m => m.id))])) });
}
function demoMsg(room: C.Room, id: number) {
  const m = demoChat.find(x => x.id === id && x.room === room);
  if (!m || m.state === "deleted") throw new Error("Message not found");
  return m;
}
const demoRev = () => Math.max(0, ...demoChat.map(m => m.rev)) + 1;
function demoView(m: C.DemoMsg, mod: boolean): C.ChatMsg {
  const me = myName();
  return { id: m.id, rev: m.rev, room: m.room, by: m.by, role: m.role, t: m.t, state: m.state, text: m.state === "ok" || (m.state === "hidden" && mod) ? m.text : "", mine: m.by === me, reported: m.reporters.includes(me), ...(mod ? { reports: m.reporters.length } : {}) };
}
const demoRoom = (room: C.Room) => C.chatAccess(role, room);

export async function chatLoad(room: C.Room, q: { since?: number; before?: number } = {}): Promise<ChatPage> {
  if (app.mode === "live") {
    const p = new URLSearchParams();
    if (q.since != null) p.set("since", String(q.since));
    if (q.before != null) p.set("before", String(q.before));
    return api<ChatPage>(`${chatBase(room)}?${p}`);
  }
  demoRoom(room);
  const mod = C.canModerateChat(role, room), all = demoChat.filter(m => m.room === room);
  if (q.since != null) { const ch = all.filter(m => m.rev > q.since!).sort((a, b) => a.rev - b.rev); return { msgs: ch.map(m => demoView(m, mod)), rev: ch.length ? ch[ch.length - 1].rev : q.since }; }
  const page = all.filter(m => q.before == null || m.id < q.before).sort((a, b) => a.id - b.id).slice(-C.CHAT_PAGE);
  return { msgs: page.map(m => demoView(m, mod)), rev: Math.max(0, ...all.map(m => m.rev)), more: page.length === C.CHAT_PAGE };
}
export async function chatSend(room: C.Room, text: string): Promise<C.ChatMsg> {
  if (app.mode === "live") {
    try { return (await api<{ msg: C.ChatMsg }>(chatBase(room), { text })).msg; }
    catch (e) { throw e instanceof HttpErr ? e : new Error("Could not send. You seem to be offline. Chat messages are not saved for later, so send it again when you are back online"); }
  }
  demoRoom(room);
  const m: C.DemoMsg = { id: Math.max(0, ...demoChat.map(x => x.id)) + 1, rev: demoRev(), room, by: myName(), role, text: C.chatText(text), t: Date.now(), state: "ok", reporters: [] };
  demoChat.push(m); saveDemoChat();
  return demoView(m, C.canModerateChat(role, room));
}
export async function chatReport(room: C.Room, id: number) {
  if (app.mode === "live") { await api(`${chatBase(room)}/${id}/report`, {}); return; }
  demoRoom(room);
  const m = demoMsg(room, id), me = myName();
  if (m.by === me) throw new Error("You cannot report your own message");
  if (!m.reporters.includes(me)) { m.reporters.push(me); if (m.state === "ok" && m.reporters.length >= C.CHAT_HIDE_AT) m.state = "hidden"; m.rev = demoRev(); saveDemoChat(); }
}
export async function chatHide(room: C.Room, id: number, hidden: boolean) {
  if (app.mode === "live") { await api(`${chatBase(room)}/${id}/hide`, { hidden }); return; }
  demoRoom(room);
  if (!C.canModerateChat(role, room)) throw new Error("Only coordinators can hide messages");
  const m = demoMsg(room, id);
  m.state = hidden ? "hidden" : "ok"; if (!hidden) m.reporters = []; m.rev = demoRev(); saveDemoChat();
}
export async function chatDelete(room: C.Room, id: number) {
  if (app.mode === "live") { await api(`${chatBase(room)}/${id}`, undefined, "DELETE"); return; }
  demoRoom(room);
  const m = demoMsg(room, id);
  if (m.by !== myName()) throw new Error("You can only delete your own messages");
  m.state = "deleted"; m.text = ""; m.reporters = []; m.rev = demoRev(); saveDemoChat();
}

export const quickSuggest = (i: L.SuggestInput) => L.suggest(doc, i);
const aiBase = () => `/api/n/${enc(app.nbhd!.id)}/ai`;
export const aiPhoto = (photo: string, mode: "report" | "proof", cat?: string) => api<{ label: string; note: string; source: string }>(`${aiBase()}/image`, { photo, mode, cat });
export const aiSuggest = (i: L.SuggestInput) => api<{ cat: L.Cat; summary: string; needs: string[]; dupId?: string; source: string }>(`${aiBase()}/suggest`, i);
export const aiInsights = (): Promise<L.Insights> => (app.mode === "live" ? api<L.Insights>(`${aiBase()}/insights`, {}) : Promise.resolve(L.insights(doc)));

export const noticeAdd = (i: { title: string; body: string; urgent: boolean; pinned: boolean }) => dispatch({ t: "noticeAdd", ...i });
export const noticeRemove = (id: string) => dispatch({ t: "noticeRemove", id });
export const authoritySet = (name: string, email: string, phone: string) => dispatch({ t: "authoritySet", name, email, phone });
export const authorityRemove = (id: string) => dispatch({ t: "authorityRemove", id });
export const handoff = (id: string, authorityId: string, ref: string) => dispatch({ t: "handoff", id, authorityId, ref });
export const handoffStatus = (id: string, status: L.Handoff["status"], ref?: string) => dispatch({ t: "handoffStatus", id, status, ref });

export interface Caps { ai: boolean; tinyfish?: boolean; push: string | null; email: boolean; sms: boolean; whatsapp: boolean; cap: number }
export interface Chan { kind: string; target: string; verified: boolean }
export const capabilities = () => api<Caps>("/api/capabilities");
export const channels = () => api<Chan[]>(`/api/n/${enc(app.nbhd!.id)}/channels`);
export const setChannel = (kind: string, body: unknown = {}) => api(`/api/n/${enc(app.nbhd!.id)}/channels/${kind}`, body);
export const removeChannel = (kind: string) => api(`/api/n/${enc(app.nbhd!.id)}/channels/${kind}`, undefined, "DELETE");
const b64ToU8 = (b: string) => { const s = atob((b + "=".repeat((4 - (b.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); };
export async function enablePush(key: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser does not support push notifications");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notification permission was not given");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  await setChannel("push", { subscription: sub.toJSON() });
}
export const aiCompare = (issueId: string, photo: string) => api<{ samePlace: string; fixed: string; note: string; source: string }>(`${aiBase()}/compare`, { issueId, photo });

export interface TfRouteCheck {
  city: string; region?: string; cat: L.Cat; checkedAt: number; simulated?: boolean;
  sources: { title: string; url: string; official: boolean; snippet: string }[];
  helplines: { value: string; url: string }[]; emails: { value: string; url: string }[];
  links: { label: string; url: string; kind: "complaint" | "track" }[]; note: string;
}
export interface TfStatus { state: "running" | "done" | "failed"; streamingUrl?: string; found?: boolean; status?: string; lastUpdated?: string; remarks?: string; suggest?: "acknowledged" | "resolved"; error?: string; simulated?: boolean }
const tfBase = () => `/api/n/${enc(app.nbhd!.id)}/tinyfish`;
export const tfAvailable = async (): Promise<boolean> => (app.mode === "demo" ? true : capabilities().then(c => !!c.tinyfish).catch(() => false));

/** Open to anyone, no account. The server limits each visitor and the whole site. */
export const tfPublicOn = (): Promise<boolean> => fetch("/api/public/tinyfish").then(r => r.json()).then((j: { enabled?: boolean }) => !!j.enabled).catch(() => false);
export async function tfPublicRoute(cat: L.Cat, city: string): Promise<TfRouteCheck> {
  const r = await fetch("/api/public/tinyfish/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cat, city }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  return j as TfRouteCheck;
}

export async function tfVerifyRoute(cat: L.Cat, city?: string): Promise<TfRouteCheck> {
  if (app.mode === "demo") {
    if (city?.trim() && (await tfPublicOn())) return tfPublicRoute(cat, city.trim());
    await new Promise(r => setTimeout(r, 1200));
    return {
      city: "Maple Nagar (fictional demo city)", region: "India", cat, checkedAt: Date.now(), simulated: true,
      sources: [{ title: "Example municipal grievance portal (simulated)", url: "https://example.org/", official: false, snippet: "Simulated example. No real website was read in demo mode." }],
      helplines: [{ value: "1800 000 0000", url: "https://example.org/" }], emails: [],
      links: [{ label: "Register a complaint (simulated)", url: "https://example.org/complaint", kind: "complaint" }, { label: "Track a complaint (simulated)", url: "https://example.org/track", kind: "track" }],
      note: "This is a simulated example. Type a real city above to run it live, or sign in to a real neighbourhood.",
    };
  }
  return api<TfRouteCheck>(`${tfBase()}/route`, { cat, city: city || undefined });
}
export async function tfStartStatus(issueId: string, url: string): Promise<string> {
  if (app.mode === "demo") return `demo:${Date.now()}`;
  return (await api<{ runId: string }>(`${tfBase()}/status`, { issueId, url })).runId;
}
export async function tfPollStatus(runId: string): Promise<TfStatus> {
  if (runId.startsWith("demo:")) {
    if (Date.now() - Number(runId.slice(5)) < 3000) return { state: "running", simulated: true };
    return { state: "done", simulated: true, found: true, status: "Registered. Assigned to the zonal officer.", lastUpdated: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), remarks: "Simulated example. No real portal was visited.", suggest: "acknowledged" };
  }
  return api<TfStatus>(`${tfBase()}/runs/${enc(runId)}`);
}

export interface TfWardArea { locality: string; city: string; postcode: string }
export interface TfWardPages { area: TfWardArea; sources: TfRouteCheck["sources"]; simulated?: boolean }
export interface TfWard {
  state: "running" | "done" | "failed"; streamingUrl?: string; error?: string; simulated?: boolean;
  found?: boolean; ward?: string; councillor?: string; phone?: string; email?: string; office?: string; sourceUrl?: string; remarks?: string;
}
export async function tfWardPages(city?: string): Promise<TfWardPages> {
  if (app.mode === "demo") {
    await new Promise(r => setTimeout(r, 1000));
    return {
      simulated: true, area: { locality: "Maple Nagar", city: city?.trim() || "Maple City", postcode: "" },
      sources: [{ title: "Know your ward councillor (simulated)", url: "https://example.org/wards", official: false, snippet: "Simulated example. No real website was read in demo mode." }],
    };
  }
  return api<TfWardPages>(`${tfBase()}/ward/pages`, { city: city || undefined });
}
export async function tfStartWard(url: string, area: TfWardArea): Promise<string> {
  if (app.mode === "demo") return `demo:${Date.now()}`;
  return (await api<{ runId: string }>(`${tfBase()}/ward`, { url, area })).runId;
}
export async function tfPollWard(runId: string): Promise<TfWard> {
  if (runId.startsWith("demo:")) {
    if (Date.now() - Number(runId.slice(5)) < 3000) return { state: "running", simulated: true };
    return { state: "done", simulated: true, found: true, ward: "Ward 42, Maple Nagar", councillor: "A. Sharma (fictional)", phone: "011 0000 0000", email: "", office: "Ward office, Community Hall, Maple Nagar", sourceUrl: "https://example.org/wards", remarks: "Simulated example. No real website was visited." };
  }
  return api<TfWard>(`${tfBase()}/runs/${enc(runId)}`);
}

export async function agentAnalyze(text: string): Promise<Analysis> {
  if (app.mode === "live" && app.nbhd) {
    try { return await api<Analysis>(`/api/n/${enc(app.nbhd.id)}/agent/analyze`, { text }); } catch (e) { if (e instanceof HttpErr) throw e; }
  }
  return understand(text);
}
export const agentStart = (id: string, lang: string, original: string, summaryEn: string, source: string) => dispatch({ t: "agentStart", id, lang, original, summaryEn, source });
export const agentDraft = (id: string, p: { lang?: "en" | "hi"; subject?: string; body?: string }) => dispatch({ t: "agentDraft", id, ...p });
export const agentApprove = (id: string) => dispatch({ t: "agentApprove", id });
export const agentSend = (id: string, via: "copied" | "emailed" | "mailto" | "simulated", ref?: string, emailTo?: string) => dispatch({ t: "agentSend", id, via, ref, emailTo });
export const agentRef = (id: string, ref: string) => dispatch({ t: "agentRef", id, ref });
export const agentReply = (id: string, text: string, ref?: string, status?: "acknowledged" | "resolved") => dispatch({ t: "agentReply", id, text, ref, status });
/** True when this server can email complaints (SMTP is set up). Never in the demo, which only simulates sending. */
export const emailAvailable = async (): Promise<boolean> => (app.mode === "demo" ? false : capabilities().then(c => !!c.email).catch(() => false));
/** Emails the approved complaint to an authority from the server, with the photo attached, then records it as sent. Coordinators only. */
export async function agentEmail(id: string, to: string, ref?: string): Promise<{ attached: number }> {
  if (app.mode !== "live" || !app.nbhd) throw new Error("Emailing works in a real neighbourhood only");
  const j = await api<{ doc: L.Doc; version: number; role: L.Role; attached: number }>(`/api/n/${enc(app.nbhd.id)}/issues/${enc(id)}/email-complaint`, { to, ref: ref ?? "" });
  doc = j.doc; ver = j.version; role = L.asRole(j.role); commit();
  return { attached: j.attached };
}
export const agentEscalate = (id: string) => dispatch({ t: "agentEscalate", id });

export const approveResolution = (id: string, note?: string) => dispatch({ t: "approveResolution", id, note });
export const rejectResolution = (id: string, reason: string) => dispatch({ t: "rejectResolution", id, reason });
export const feedback = (id: string, ok: boolean, note?: string) => dispatch({ t: "feedback", id, ok, note });
export const reporterConfirm = (id: string, ok: boolean, note?: string) => dispatch({ t: "reporterConfirm", id, ok, note });
export const closeUnconfirmed = (id: string, note?: string) => dispatch({ t: "closeUnconfirmed", id, note });
/** Demo only: pretend the reporters stayed silent for a week, so "Close without confirmation" can be tried. Simulated. */
export function demoSkipWait(id: string) {
  if (app.mode !== "demo") return;
  doc = structuredClone(doc);
  const i = doc.issues.find(x => x.id === id);
  if (i && i.status === "pending") { i.pendingAt = Date.now() - L.UNCONFIRMED_AFTER_MS - 1000; commit(); }
}
/** Demo only: answer "Is it fixed?" as the person who reported the problem, so one person can try the whole flow. Simulated. */
export async function demoAnswerAsReporter(id: string, ok: boolean, note?: string): Promise<string | undefined> {
  if (app.mode !== "demo") throw new Error("This shortcut only works in the demo");
  const i = doc.issues.find(x => x.id === id);
  const name = i ? L.reportersOf(i).find(n => n !== i.pendingBy) : undefined;
  if (!i || !name) throw new Error("No reporter found for this report");
  const j = L.reduce(doc, { role: "resident", name }, { t: "reporterConfirm", id, ok, note }, app.nbhd ? { lat: app.nbhd.lat, lng: app.nbhd.lng, r: 1e7, name: app.nbhd.name } : undefined);
  doc = j.doc; commit(); return j.result;
}
export const addUpdate = (id: string, text: string, photo?: string) => dispatch({ t: "update", id, text, photo });