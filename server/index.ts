import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import compression from "compression";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { asRole, can, dist as metresBetween, isEmail, dueEscalations, purgeSafety, purgeSos, reportersOf, emptyDoc, reduce, SAFETY_KM, STATUS_LABEL, weeklyDigest, type Action, type Cat, type Doc, type Role } from "../src/logic";

import { alertsFor, hazardsNear, SEV_RANK, type Alert } from "../src/world";
import { canModerateChat, chatAccess, chatText, CHAT_DAYS, CHAT_HIDE_AT, CHAT_PAGE, ROOMS, roomsFor, type ChatMsg, type Room } from "../src/chat";
import { CELL_R, parseCell } from "../src/geo";
import { pool, tx } from "./db";
import { areaOf, cityOf, fetchMap, geocode, NAMES_ON, placeName } from "./osm";
import { aiAnalyze, aiCompare, aiEnabled, aiImage, aiInsights, aiLabel, aiSuggest } from "./ai";
import { getStatusRun, getWardRun, runOwner, startStatusRun, startWardRun, tfEnabled, tfLabel, TinyFishError, trackRun, verifyRoute, wardPages } from "./tinyfish";
import { getWorld, worldSnapshot } from "./world";
import { capAlertsFor, capFeedCount, capSnapshot, getCap } from "./cap";
import { buildComplaintEmail } from "../src/complaintMail";
import { regionFor, suggestionsFor } from "../src/authorityDirectory";
import { caps, notify, sendEmail, sendText, sign, tgApi, tgBot, tgSecret, tgSetup, tgToken, twilioAuth, twilioReady, twilioToken } from "./notify";
import { DRAFT_MINUTES, MAX_PHOTO_BYTES, MSG, descOf, mergeDraft, missing, parseBody, sniff, stripJpegMetadata, titleOf, type Draft } from "./textReport";
import { CAT_EN, understand } from "../src/agent";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) {
  if (!process.env[k]) { console.error(`${k} is not set. See the README.`); process.exit(1); }
}
const PORT = Number(process.env.PORT || 8787);
const REQUIRE_CONFIRMED = process.env.REQUIRE_EMAIL_CONFIRMED === "true";
const PLATFORM = (process.env.PLATFORM_ADMINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
interface User { id: string; email: string; name: string; handle: string; platformAdmin: boolean }

const hits = new Map<string, number[]>();
function rl(key: string, max: number, ms: number) {
  const now = Date.now(), a = (hits.get(key) ?? []).filter(t => now - t < ms);
  if (a.length >= max) throw new HttpError(429, "You are doing that too often. Please try again later");
  a.push(now); hits.set(key, a);
}
const tokens = new Map<string, { u: User; exp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of hits) if (!a.length || now - a[a.length - 1] > 86400000) hits.delete(k);
  for (const [k, v] of tokens) if (v.exp < now) tokens.delete(k);
}, 600000).unref();

async function authenticate(req: express.Request): Promise<User> {
  const t = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (!t) throw new HttpError(401, "Please sign in");
  const c = tokens.get(t);
  if (c && c.exp > Date.now()) return c.u;
  const { data, error } = await sb.auth.getUser(t);
  if (error || !data.user) throw new HttpError(401, "Please sign in again");
  if (REQUIRE_CONFIRMED && !data.user.email_confirmed_at) throw new HttpError(403, "Please confirm your email address first");
  const raw = String(data.user.user_metadata?.display_name ?? data.user.email?.split("@")[0] ?? "Neighbor");
  const name = raw.normalize("NFKC").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 30) || "Neighbor";
  const email = data.user.email ?? "";
  const u: User = { id: data.user.id, email, name, handle: `${name} #${data.user.id.slice(0, 6)}`, platformAdmin: PLATFORM.includes(email.toLowerCase()) };
  tokens.set(t, { u, exp: Date.now() + 60000 });
  return u;
}

type Q = { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }> };
async function memberRole(c: Q, nid: string, u: User): Promise<Role> {
  const r = await c.query("select role from members where neighbourhood_id = $1 and user_id = $2", [nid, u.id]);
  if (!r.rows[0]) { if (u.platformAdmin) return "admin"; throw new HttpError(403, "Join this neighbourhood first"); }
  return u.platformAdmin ? "admin" : asRole(r.rows[0].role);
}
const info = (n: any, role: Role, members?: number) => ({ id: n.id, kind: n.kind, name: n.name, lat: n.center_lat, lng: n.center_lng, r: n.radius_m, role, ...(members == null ? {} : { members }) });
const viewDoc = (d: Doc, role: Role, handle: string, memberCount = 0): Doc => {
  // Older neighbourhoods may still hold volunteer, mission or resource data. It is never sent to anyone.
  // Every member sees every SOS request, because it is an emergency. A phone number from a text-message SOS stays with its author and the coordinators.
  const sos = (d.sos ?? []).map(x => (role === "admin" || x.author === handle ? x : { ...x, contact: undefined }));
  // Safety plans waiting for approval are for coordinators. Everyone sees the approved ones.
  const safety = (d.safety ?? []).filter(p => role === "admin" || p.status === "approved");
  const base: Doc = { ...d, memberCount, missions: [], resources: [], volunteers: [], sos, safety, events: d.events.filter(e => !e.to || e.to === handle) };
  if (role === "admin") return base;
  return {
    ...base, authorities: undefined,
    issues: d.issues.filter(i => !i.hidden).map(i => ({ ...i, flags: [], handoff: i.handoff ? { ...i.handoff, email: undefined } : undefined })),
  };
};
const countMembers = async (c: Q, id: string) => (await c.query("select count(*)::int as n from members where neighbourhood_id = $1", [id])).rows[0].n as number;
const alertsOf = (n: { center_lat: number; center_lng: number; radius_m: number }): Alert[] => {
  const c = { lat: n.center_lat, lng: n.center_lng };
  return [...capAlertsFor(capSnapshot(), c, n.radius_m), ...alertsFor(worldSnapshot().events, c)].sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]).slice(0, 6);
};
const isId = (s: string) => /^[A-Za-z0-9:_-]{1,40}$/.test(s);

// The first FOUNDING_COORDINATORS people to join any neighbourhood (named or automatic cell) become coordinators. Everyone after is a resident.
const FOUNDING_COORDINATORS = 3;
async function ensureMember(nid: string, u: User, role: Role = "resident"): Promise<Role> {
  return tx(async c => {
    // One join at a time per neighbourhood, so two people joining together cannot both take the same founding slot.
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [nid]);
    const ex = await c.query("select role from members where neighbourhood_id = $1 and user_id = $2", [nid, u.id]);
    if (ex.rows[0]) return asRole(ex.rows[0].role);
    const cnt = await c.query("select count(*)::int as n from members where user_id = $1", [u.id]);
    if (cnt.rows[0].n >= 5) throw new HttpError(400, "You can belong to up to 5 neighbourhoods. Leave one first");
    const size = (await c.query("select count(*)::int as n from members where neighbourhood_id = $1", [nid])).rows[0].n as number;
    const finalRole: Role = role === "admin" || size < FOUNDING_COORDINATORS ? "admin" : role;
    await c.query("insert into members (neighbourhood_id, user_id, display_name, role) values ($1, $2, $3, $4) on conflict do nothing", [nid, u.id, u.handle, finalRole]);
    if (finalRole === "admin" && role !== "admin") await c.query("insert into audit_log (neighbourhood_id, user_id, who, action, detail) values ($1, $2, $3, 'role', $4)", [nid, u.id, u.handle, JSON.stringify({ member: u.id, role: "admin", reason: "founding member" })]);
    return finalRole;
  });
}

const fail = (res: express.Response, e: unknown) => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Something went wrong on our side. Please try again" });
};
const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => { fn(req, res).catch(e => fail(res, e)); };

const app = express();
app.disable("x-powered-by");
// Hosts such as Render, Railway and Fly put one proxy in front. Without this every visitor looks like the same address to the rate limits.
{ const hops = (process.env.TRUST_PROXY ?? "").trim() === "" ? 1 : Number(process.env.TRUST_PROXY); if (Number.isInteger(hops) && hops >= 0) app.set("trust proxy", hops); }
app.use(compression());
app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Frame-Options", "DENY"); next(); });
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/me", ah(async (req, res) => {
  const u = await authenticate(req);
  res.json({ id: u.id, email: u.email, handle: u.handle, platformAdmin: u.platformAdmin });
}));

app.get("/api/neighbourhoods/mine", ah(async (req, res) => {
  const u = await authenticate(req);
  const r = await pool.query("select n.*, m.role, (select count(*)::int from members x where x.neighbourhood_id = n.id) as members from members m join neighbourhoods n on n.id = m.neighbourhood_id where m.user_id = $1 order by m.joined_at", [u.id]);
  res.json(r.rows.map(n => info(n, u.platformAdmin ? "admin" : n.role, n.members)));
}));

// How many people have joined an automatic area, so a newcomer sees it before joining. Only a number is returned.
app.get("/api/neighbourhoods/cell-count", ah(async (req, res) => {
  const u = await authenticate(req); rl(`cellcount:${u.id}`, 60, 3600000);
  const cell = parseCell(String(req.query.cell ?? ""));
  if (!cell) throw new HttpError(400, "Invalid area");
  res.json({ members: await countMembers(pool, cell.id) });
}));

app.post("/api/neighbourhoods/cell", ah(async (req, res) => {
  const u = await authenticate(req); rl(`cell:${u.id}`, 30, 3600000);
  const cell = parseCell(String(req.body?.cell ?? ""));
  if (!cell) throw new HttpError(400, "Invalid area");
  let n = (await pool.query("select * from neighbourhoods where id = $1", [cell.id])).rows[0];
  if (!n) {
    const name = await placeName(cell.lat, cell.lng);
    n = (await pool.query(
      "insert into neighbourhoods (id, kind, name, center_lat, center_lng, radius_m, doc) values ($1, 'cell', $2, $3, $4, $5, $6) on conflict (id) do update set id = excluded.id returning *",
      [cell.id, name, cell.lat, cell.lng, CELL_R, JSON.stringify(emptyDoc())],
    )).rows[0];
  }
  res.json(info(n, await ensureMember(n.id, u)));
}));

app.post("/api/neighbourhoods", ah(async (req, res) => {
  const u = await authenticate(req); rl(`create:${u.id}`, 3, 86400000);
  const name = String(req.body?.name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng), r = Math.round(Number(req.body?.r));
  if (name.length < 3) throw new HttpError(400, "Choose a name with at least 3 characters");
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, "Invalid location");
  if (!(r >= 200 && r <= 2000)) throw new HttpError(400, "The radius must be between 200 and 2000 meters");
  const id = "n_" + randomUUID().replace(/-/g, "").slice(0, 12);
  const n = (await pool.query("insert into neighbourhoods (id, kind, name, center_lat, center_lng, radius_m, created_by, doc) values ($1, 'named', $2, $3, $4, $5, $6, $7) returning *", [id, name, lat, lng, r, u.id, JSON.stringify(emptyDoc())])).rows[0];
  prefetchMap(n);
  res.json(info(n, await ensureMember(id, u, "admin")));
}));

app.post("/api/neighbourhoods/:id/join", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id); rl(`join:${u.id}`, 30, 3600000);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  let n = (await pool.query("select * from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) {
    const cell = parseCell(id);
    if (!cell) throw new HttpError(404, "Neighbourhood not found");
    n = (await pool.query("insert into neighbourhoods (id, kind, name, center_lat, center_lng, radius_m, doc) values ($1, 'cell', $2, $3, $4, $5, $6) on conflict (id) do update set id = excluded.id returning *", [cell.id, await placeName(cell.lat, cell.lng), cell.lat, cell.lng, CELL_R, JSON.stringify(emptyDoc())])).rows[0];
  }
  prefetchMap(n);
  res.json(info(n, await ensureMember(id, u)));
}));

const near = (rows: any[]) => rows.map(n => ({ id: n.id, name: n.name, r: n.radius_m, lat: n.center_lat, lng: n.center_lng, members: n.members }));
app.get("/api/neighbourhoods/nearby", ah(async (req, res) => {
  const u = await authenticate(req); rl(`nearby:${u.id}`, 60, 3600000);
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new HttpError(400, "Invalid location");
  const r = await pool.query("select n.*, (select count(*)::int from members m where m.neighbourhood_id = n.id) as members from neighbourhoods n where kind = 'named' and center_lat between $1 and $2 and center_lng between $3 and $4 limit 20", [lat - 0.03, lat + 0.03, lng - 0.04, lng + 0.04]);
  res.json(near(r.rows));
}));
app.get("/api/neighbourhoods/search", ah(async (req, res) => {
  const u = await authenticate(req); rl(`search:${u.id}`, 60, 3600000);
  const q = String(req.query.q ?? "").trim().replace(/[%_\\]/g, m => "\\" + m).slice(0, 60);
  if (q.length < 2) return res.json([]);
  const r = await pool.query("select n.*, (select count(*)::int from members m where m.neighbourhood_id = n.id) as members from neighbourhoods n where kind = 'named' and name ilike $1 limit 10", [`%${q}%`]);
  res.json(near(r.rows));
}));

app.get("/api/geocode", ah(async (req, res) => {
  const u = await authenticate(req); rl(`geo:${u.id}`, 20, 60000);
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (q.length < 3) return res.json([]);
  res.json(await geocode(q));
}));

app.get("/api/n/:id/state", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  const role = await memberRole(pool, id, u);
  const v = (await pool.query("select version, center_lat, center_lng, radius_m from neighbourhoods where id = $1", [id])).rows[0];
  if (!v) throw new HttpError(404, "Neighbourhood not found");
  const alerts = alertsOf(v), chat = await chatLatest(id, u);
  if (Number(req.query.v) === v.version) return res.json({ unchanged: true, version: v.version, role, alerts, chat });
  const d = (await pool.query("select doc, version from neighbourhoods where id = $1", [id])).rows[0];
  res.json({ version: d.version, doc: viewDoc(d.doc, role, u.handle, await countMembers(pool, id)), role, alerts, chat });
}));

const LIMITS: Partial<Record<Action["t"], [number, number]>> = {
  report: [10, 86400000], proof: [30, 86400000], spam: [20, 86400000], merge: [40, 86400000], flag: [20, 86400000],
  sos: [3, 86400000], safetyPlan: [10, 86400000], update: [40, 86400000], feedback: [30, 86400000], reporterConfirm: [30, 86400000], agentStart: [20, 86400000], agentDraft: [60, 86400000], agentSend: [30, 86400000], noticeAdd: [20, 86400000],
};
const ADMIN_ACTIONS = new Set(["verify", "spam", "agentSend", "agentReply", "advance", "hide", "restore", "handoff", "handoffStatus", "noticeAdd", "noticeRemove", "authoritySet", "authorityRemove", "agentEscalate", "approveResolution", "rejectResolution", "closeUnconfirmed", "sosAck", "sosStatus", "safetyPlan", "safetyApprove", "safetyReject", "safetyClose"]);

interface Actor { id: string; handle: string; platformAdmin: boolean }
async function runAction(id: string, u: Actor, a: Action, internal = false) {
  if (!a || typeof a.t !== "string") throw new HttpError(400, "Invalid request");
  // "Emailed" can only be recorded by the email route below, after the email was really sent.
  if (a.t === "agentSend" && a.via === "emailed" && !internal) throw new HttpError(400, "Use the email button to email a complaint");
  rl(`act:${u.id}`, 120, 60000);
  const lim = LIMITS[a.t]; if (lim) rl(`${a.t}:${id}:${u.id}`, lim[0], lim[1]);
  if (a.t === "report") rl(`reportH:${id}:${u.id}`, 4, 3600000);
  const out = await tx(async c => {
    const role = await memberRole(c, id, u as User);
    if (!can(role, a.t)) throw new HttpError(403, `The ${role} role is not allowed to do this`);
    if (a.t === "demo" || a.t === "reset") throw new HttpError(403, "Demo actions are not available in real neighbourhoods");
    if (a.t === "agentSend" && a.via === "simulated") throw new HttpError(400, "Simulated sending is only for the demo");
    const n = (await c.query("select name, center_lat, center_lng, radius_m, doc, version from neighbourhoods where id = $1 for update", [id])).rows[0];
    if (!n) throw new HttpError(404, "Neighbourhood not found");
    if ("photo" in a && a.photo != null) {
      if (!/^[0-9a-f-]{36}$/.test(String(a.photo))) throw new HttpError(400, "Upload the photo first");
      if (!(await c.query("select 1 from photos where id = $1 and neighbourhood_id = $2 and user_id = $3", [a.photo, id, u.id])).rows[0]) throw new HttpError(400, "Photo not found");
    }
    // A safety plan is only allowed while a hazard is within 100 km. The server looks the hazard up itself, so a browser cannot claim one.
    let act: Action = a;
    if (a.t === "safetyPlan") {
      const found = [...alertsOf(n), ...hazardsNear(worldSnapshot().events, { lat: n.center_lat, lng: n.center_lng })].find(h => h.id === a.hazard?.id && h.km <= SAFETY_KM);
      if (!found) throw new HttpError(403, `No hazard is within ${SAFETY_KM} km right now, so a safety plan cannot be created`);
      act = { ...a, hazard: { id: found.id, title: found.title, type: found.type, km: found.km } };
    }
    let r;
    try { r = reduce(n.doc, { role, name: u.handle }, act, { lat: n.center_lat, lng: n.center_lng, r: n.radius_m, name: n.name }); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const version = n.version + 1;
    await c.query("update neighbourhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(r.doc)]);
    if (ADMIN_ACTIONS.has(a.t)) await c.query("insert into audit_log (neighbourhood_id, user_id, who, action, detail) values ($1, $2, $3, $4, $5)", [id, u.id, u.handle, a.t, JSON.stringify({ id: (a as any).id ?? (a as any).mid ?? null }).slice(0, 200)]);
    return { raw: r.doc, doc: viewDoc(r.doc, role, u.handle, await countMembers(c, id)), result: r.result, version, role };
  });
  void afterAction(id, a, out.raw, u.handle);
  return out;
}

async function afterAction(id: string, a: Action, raw: Doc, actor: string) {
  try {
    if (a.t === "sos") await notify(id, "admins", { title: "New SOS request", body: "A neighbour asked for help and it is on the map. Open the SOS tab.", urgent: true });
    else if (a.t === "safetyPlan") await notify(id, "admins", { title: "A safety plan needs approval", body: "A coordinator wrote a safety plan for a nearby hazard. Open the World tab to review it.", urgent: true });
    else if (a.t === "safetyApprove") {
      const p = raw.safety?.find(x => x.id === a.id);
      if (p) await notify(id, "all", { title: `Safety plan: ${p.hazardTitle}`.slice(0, 80), body: "Your coordinators approved a safety plan. Open the Command tab to read it.", urgent: true });
    }
    else if (a.t === "noticeAdd" && a.urgent) await notify(id, "all", { title: a.title, body: a.body.slice(0, 140), urgent: true });
    else if (a.t === "advance" || a.t === "approveResolution" || a.t === "rejectResolution" || a.t === "reporterConfirm" || a.t === "closeUnconfirmed") {
      const i = raw.issues.find(x => x.id === a.id);
      if (i) {
        const others = reportersOf(i).filter(n => n !== actor);
        if (a.t === "advance" && i.status === "pending") {
          for (const n of others) await notify(id, { name: n }, { title: "Is the problem fixed?", body: `"${i.title}": the team says it is done. Open the app and answer Yes or Not fully, or reply FIXED or NOT FIXED by text.`, urgent: true });
          await notify(id, "admins", { title: "A fix is waiting for review", body: i.title, urgent: true });
        } else if (a.t === "advance") {
          await notify(id, { name: i.author }, { title: "Update on your report", body: `"${i.title}" is now: ${STATUS_LABEL[i.status]}` });
        } else if (a.t === "reporterConfirm") {
          const fixed = i.status === "resolved";
          await notify(id, "admins", { title: fixed ? "A reporter confirmed the fix" : "A reporter says it is not fully fixed", body: i.title, urgent: !fixed });
          for (const n of others) await notify(id, { name: n }, { title: "Update on your report", body: `"${i.title}" is now: ${STATUS_LABEL[i.status]}` });
        } else if (a.t === "closeUnconfirmed") {
          for (const n of others) await notify(id, { name: n }, { title: "Report closed without confirmation", body: `"${i.title}" was closed because nobody answered. If it is still broken, open the app and reopen it.` });
        } else {
          for (const n of others) await notify(id, { name: n }, { title: "Update on your report", body: `"${i.title}" is now: ${STATUS_LABEL[i.status]}` });
        }
      }
    }
    else if (a.t === "handoff") {
      const i = raw.issues.find(x => x.id === a.id);
      if (i?.handoff?.email) {
        const url = `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=18/${i.lat}/${i.lng}`;
        await sendEmail(i.handoff.email, `Community report: ${i.title}`, `A neighbourhood coordinator is forwarding a community-reported issue.\n\nTitle: ${i.title}\nType: ${i.cat}\nPriority: ${i.priority}\nReports from neighbors: ${i.reports}\nDetails: ${i.desc || "none"}\nLocation: ${url}\nReference: ${i.handoff.ref || "none"}\n\nThis message was sent through NEIGHBOURHOOD OS. It contains no personal details of the people who reported it. This issue is community-reported and has been reviewed by a human coordinator.`).catch(e => console.warn("Handoff email failed:", e.message));
      }
    }
  } catch (e) { console.error("afterAction failed:", e); }
}

/** Emails an approved complaint to an authority, then records it as sent. Coordinators only. */
const emailing = new Set<string>();
app.post("/api/n/:id/issues/:iid/email-complaint", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id), iid = String(req.params.iid);
  if (!isId(id) || !isId(iid)) throw new HttpError(400, "Invalid request");
  const role = await memberRole(pool, id, u);
  if (role !== "admin") throw new HttpError(403, "Only a coordinator can email a complaint");
  if (!caps().email) throw new HttpError(400, "Email is not set up on this server");
  rl(`emailc:${u.id}`, 10, 3600000); rl(`emailc-n:${id}`, 40, 86400000);
  const to = String(req.body?.to ?? "").trim(), ref = String(req.body?.ref ?? "").trim().slice(0, 60);
  if (!isEmail(to)) throw new HttpError(400, "Enter a valid email address for the authority");
  const n = (await pool.query("select name, doc from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighbourhood not found");
  const i = (n.doc as Doc).issues.find(x => x.id === iid && !x.hidden);
  if (!i?.agent) throw new HttpError(400, "Start the AI agent on this report first");
  if (i.status === "resolved") throw new HttpError(400, "This report is already resolved");
  if (!i.agent.draft.approvedAt) throw new HttpError(400, "Approve the complaint before sending it");
  if (i.agent.draft.sentAt) throw new HttpError(400, "This complaint was already sent");
  const key = `${id}:${iid}`;
  if (emailing.has(key)) throw new HttpError(409, "This complaint is being sent right now");
  emailing.add(key);
  try {
    // Attach the original photo and up to two proof photos (they stay inside this neighbourhood).
    const ids = [i.photo, ...i.proof.map(p => p.photo)].filter((p): p is string => !!p && /^[0-9a-f-]{36}$/.test(p)).slice(0, 3);
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    let bytes = 0;
    for (const pid of ids) {
      const p = (await pool.query("select mime, data from photos where id = $1 and neighbourhood_id = $2", [pid, id])).rows[0];
      if (!p || bytes + p.data.length > 8_000_000) continue;
      bytes += p.data.length;
      attachments.push({ filename: `photo-${attachments.length + 1}.${String(p.mime).includes("png") ? "png" : "jpg"}`, content: p.data, contentType: String(p.mime) });
    }
    const mail = buildComplaintEmail(i, n.name, ref);
    try { await sendEmail(to, mail.subject, mail.text, { replyTo: process.env.SMTP_FROM || process.env.CONTACT_EMAIL, attachments }); }
    catch (e) { console.warn("Complaint email failed:", (e as Error).message); throw new HttpError(502, "The email could not be sent. Check the address and the server's email settings, then try again"); }
    let out;
    try { out = await runAction(id, u, { t: "agentSend", id: iid, via: "emailed", ref, emailTo: to }, true); }
    catch (e) { throw new HttpError(500, `The email was sent to ${to}, but it could not be recorded: ${(e as Error).message}. Use "I sent it" to record it by hand`); }
    res.json({ doc: out.doc, result: out.result, version: out.version, role: out.role, attached: attachments.length });
  } finally { emailing.delete(key); }
}));

app.post("/api/n/:id/action", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  const a = req.body as Action;
  const out = await runAction(id, u, a);
  res.json({ doc: out.doc, result: out.result, version: out.version, role: out.role });
}));

app.get("/api/world", ah(async (req, res) => {
  const u = await authenticate(req); rl(`world:${u.id}`, 30, 60000);
  const w = await getWorld();
  res.json({ events: w.events, sources: w.sources, updated: w.updated });
}));

const MAP_WAIT = Number(process.env.MAP_WAIT_MS ?? 10000); // how long a visit waits for a fresh download before answering "loading"
const mapMisses = new Map<string, { at: number; reason: "sparse" | "unavailable" }>();
const MISS_TTL = { sparse: 600000, unavailable: 45000 };
const noMap = (res: express.Response, reason: "sparse" | "unavailable" | "loading") => { res.setHeader("X-Map-Status", "none"); res.json({ source: "none", reason }); };

// One download per neighbourhood at a time, however many people ask. It keeps running in the background and saves the result.
const mapJobs = new Map<string, Promise<any | null>>();
function startMapJob(id: string, lat: number, lng: number, r: number): Promise<any | null> {
  const running = mapJobs.get(id); if (running) return running;
  const job = (async () => {
    try {
      const m = await fetchMap(lat, lng, r);
      if (m.roads.length < 8) { mapMisses.set(id, { at: Date.now(), reason: "sparse" }); return null; }
      await pool.query("update neighbourhoods set map = $2, map_fetched_at = now() where id = $1", [id, JSON.stringify(m)]);
      mapMisses.delete(id);
      return m;
    } catch (e) { console.warn("Map fetch failed for", id, (e as Error).message); mapMisses.set(id, { at: Date.now(), reason: "unavailable" }); return null; }
  })().finally(() => mapJobs.delete(id));
  mapJobs.set(id, job);
  return job;
}
const recentMiss = (id: string) => { const m = mapMisses.get(id); return m && Date.now() - m.at < MISS_TTL[m.reason] ? m : null; };
/** Start downloading the real map early, so the first visit finds it ready. Never waits and never throws. */
const prefetchMap = (n: any) => { if (n && !n.map && !recentMiss(n.id)) void startMapJob(n.id, n.center_lat, n.center_lng, n.radius_m).catch(() => undefined); };

app.get("/api/n/:id/map", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  await memberRole(pool, id, u);
  const n = (await pool.query("select center_lat, center_lng, radius_m, map, map_fetched_at from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighbourhood not found");
  const fresh = !!(n.map && n.map_fetched_at && Date.now() - new Date(n.map_fetched_at).getTime() < 30 * 86400000);
  // A map saved before place names existed has no "places" list, and an old one may be out of date. Show it now and refresh in the background.
  const old = n.map && n.map.source === "osm" ? n.map : null;
  const needsNames = NAMES_ON && fresh && old && old.places === undefined;
  const shape = (m: any) => (NAMES_ON || !m?.places?.length ? m : { ...m, places: [] }); // names switched off: never send saved names
  if (fresh && !needsNames) return res.json(shape(n.map));
  const miss = recentMiss(id);
  if (miss) return old ? res.json(shape(old)) : noMap(res, miss.reason);
  const job = startMapJob(id, n.center_lat, n.center_lng, n.radius_m);
  // Give the download a short head start. If it is still running, answer now and let the app ask again.
  const wait = old ? Math.min(3000, MAP_WAIT) : MAP_WAIT;
  const got = await Promise.race([job, new Promise<undefined>(r => setTimeout(() => r(undefined), wait))]);
  if (got) return res.json(shape(got));
  if (old) return res.json(shape(old));
  noMap(res, got === null ? (recentMiss(id)?.reason ?? "unavailable") : "loading");
}));

const MAGIC = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b.subarray(1, 4).toString() === "PNG" ? "image/png" : b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null);
app.post("/api/n/:id/photos", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  rl(`photo:${u.id}`, 30, 86400000);
  await memberRole(pool, id, u);
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.photo ?? ""));
  if (!m) throw new HttpError(400, "Send a JPEG, PNG or WebP image");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 300000) throw new HttpError(400, "That image is too large");
  const mime = MAGIC(buf);
  if (!mime) throw new HttpError(400, "That file is not a valid image");
  const r = await pool.query("insert into photos (neighbourhood_id, user_id, mime, data) values ($1, $2, $3, $4) returning id", [id, u.id, mime, buf]);
  res.json({ id: r.rows[0].id });
}));
app.get("/api/photos/:pid", ah(async (req, res) => {
  const u = await authenticate(req); const pid = String(req.params.pid);
  if (!/^[0-9a-f-]{36}$/.test(pid)) throw new HttpError(400, "Invalid photo");
  const p = (await pool.query("select neighbourhood_id, mime, data from photos where id = $1", [pid])).rows[0];
  if (!p) throw new HttpError(404, "Photo not found");
  await memberRole(pool, p.neighbourhood_id, u);
  res.setHeader("Content-Type", p.mime); res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(p.data);
}));

const needAdmin = async (req: express.Request) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  if ((await memberRole(pool, id, u)) !== "admin") throw new HttpError(403, "Only coordinators can do this");
  return { u, id };
};
// Any member can see who the coordinators are. The monthly ranking itself is computed in the browser from the shared document.
app.get("/api/n/:id/coordinators", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  await memberRole(pool, id, u);
  const r = await pool.query("select display_name, role from members where neighbourhood_id = $1 and role = 'admin' order by joined_at limit 100", [id]);
  res.json(r.rows.map(m => ({ name: m.display_name, role: "admin" })));
}));
app.get("/api/n/:id/members", ah(async (req, res) => {
  const { id } = await needAdmin(req);
  const r = await pool.query("select user_id, display_name, role, coordinator_requested_at, joined_at from members where neighbourhood_id = $1 order by joined_at limit 500", [id]);
  res.json(r.rows.map(m => ({ userId: m.user_id, name: m.display_name, role: asRole(m.role), requested: !!m.coordinator_requested_at, joined: m.joined_at })));
}));
app.post("/api/n/:id/members/:uid/role", ah(async (req, res) => {
  const { u, id } = await needAdmin(req); const uid = String(req.params.uid), role = String(req.body?.role);
  if (!["resident", "admin"].includes(role)) throw new HttpError(400, "Invalid role");
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new HttpError(400, "Invalid member");
  await tx(async c => {
    const t = (await c.query("select role from members where neighbourhood_id = $1 and user_id = $2 for update", [id, uid])).rows[0];
    if (!t) throw new HttpError(404, "Member not found");
    if (t.role === "admin" && role !== "admin") {
      const n = (await c.query("select count(*)::int as n from members where neighbourhood_id = $1 and role = 'admin'", [id])).rows[0].n;
      if (n <= 1) throw new HttpError(400, "A neighbourhood needs at least one coordinator");
    }
    await c.query("update members set role = $3, coordinator_requested_at = null where neighbourhood_id = $1 and user_id = $2", [id, uid, role]);
    await c.query("insert into audit_log (neighbourhood_id, user_id, who, action, detail) values ($1, $2, $3, 'role', $4)", [id, u.id, u.handle, JSON.stringify({ member: uid, role })]);
  });
  res.json({ ok: true });
}));
app.get("/api/n/:id/audit", ah(async (req, res) => {
  const { id } = await needAdmin(req);
  const r = await pool.query("select at, who, action, detail from audit_log where neighbourhood_id = $1 order by at desc limit 30", [id]);
  res.json(r.rows.map(a => ({ at: a.at, who: a.who, action: a.action, detail: a.detail ? Object.values(a.detail).filter(Boolean).join(" ") : "" })));
}));
app.post("/api/n/:id/coordinator-request", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id); rl(`coord:${u.id}`, 5, 86400000);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  await memberRole(pool, id, u);
  await pool.query("update members set coordinator_requested_at = now() where neighbourhood_id = $1 and user_id = $2 and role <> 'admin'", [id, u.id]);
  res.json({ ok: true });
}));
app.post("/api/n/:id/leave", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  await tx(async c => {
    const m = (await c.query("select role from members where neighbourhood_id = $1 and user_id = $2 for update", [id, u.id])).rows[0];
    if (!m) return;
    if (m.role === "admin") {
      const k = (await c.query("select count(*)::int as n from members where neighbourhood_id = $1", [id])).rows[0].n;
      const a = (await c.query("select count(*)::int as n from members where neighbourhood_id = $1 and role = 'admin'", [id])).rows[0].n;
      if (a <= 1 && k > 1) throw new HttpError(400, "Promote another coordinator before leaving");
    }
    await c.query("delete from members where neighbourhood_id = $1 and user_id = $2", [id, u.id]);
  });
  res.json({ ok: true });
}));

// ---- Neighbourhood chat
// Rooms are scoped to one neighbourhood. Access comes only from the person's own membership row in it,
// so a coordinator elsewhere never reaches this area's rooms. Platform admins get no pass here.
const ownRole = async (c: Q, nid: string, u: User): Promise<Role | null> => { const r = (await c.query("select role from members where neighbourhood_id = $1 and user_id = $2", [nid, u.id])).rows[0]; return r ? asRole(r.role) : null; };
async function chatLatest(nid: string, u: User): Promise<Partial<Record<Room, number>>> {
  const role = await ownRole(pool, nid, u);
  if (!role) return {};
  const r = await pool.query("select r.room, (select m.id from chat_messages m where m.neighbourhood_id = $1 and m.room = r.room and m.state = 'ok' order by m.id desc limit 1) as id from unnest($2::text[]) as r(room)", [nid, roomsFor(role).map(x => x.id)]);
  return Object.fromEntries(r.rows.map(x => [x.room, Number(x.id ?? 0)]));
}
async function chatRoom(req: express.Request) {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  const role = await ownRole(pool, id, u);
  let room: Room;
  try { room = chatAccess(role, req.params.room); } catch (e) { throw new HttpError(403, (e as Error).message); }
  return { u, id, room, role: role! };
}
const chatId = (s: unknown) => { const n = Number(s); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, "Invalid message"); return n; };
// One writer at a time per room, so `rev` values become visible in order and polling with `since` never skips a message.
const chatWrite = <T>(nid: string, room: Room, fn: (c: Q) => Promise<T>) => tx(async c => { await c.query("select pg_advisory_xact_lock(hashtext($1))", [`chat:${nid}:${room}`]); return fn(c); });
const CHAT_SEL = "select m.id, m.rev, m.room, m.user_id, m.display_name, m.body, m.state, m.reports, m.created_at, mb.role from chat_messages m left join members mb on mb.neighbourhood_id = m.neighbourhood_id and mb.user_id = m.user_id";
const chatView = (r: any, u: User, mod: boolean): ChatMsg => {
  const reports: string[] = r.reports ?? [];
  return {
    id: Number(r.id), rev: Number(r.rev), room: r.room, by: r.display_name, role: r.role ? asRole(r.role) : undefined, t: new Date(r.created_at).getTime(), state: r.state,
    text: r.state === "ok" || (r.state === "hidden" && mod) ? r.body : "", mine: r.user_id === u.id, reported: reports.includes(u.id), ...(mod ? { reports: reports.length } : {}),
  };
};
const optId = (v: unknown) => { const n = Number(v); return v != null && v !== "" && Number.isSafeInteger(n) && n >= 0 ? n : null; };
app.get("/api/n/:id/chat/:room", ah(async (req, res) => {
  const { u, id, room, role } = await chatRoom(req); const mod = canModerateChat(role, room);
  rl(`chatR:${u.id}`, 240, 60000);
  const since = optId(req.query.since), before = optId(req.query.before);
  if (since != null) {
    const rows = (await pool.query(`${CHAT_SEL} where m.neighbourhood_id = $1 and m.room = $2 and m.rev > $3 order by m.rev limit 200`, [id, room, since])).rows;
    return res.json({ msgs: rows.map(r => chatView(r, u, mod)), rev: rows.length ? Number(rows[rows.length - 1].rev) : since });
  }
  const rows = (await pool.query(`${CHAT_SEL} where m.neighbourhood_id = $1 and m.room = $2 and ($3::bigint is null or m.id < $3) order by m.id desc limit ${CHAT_PAGE}`, [id, room, before])).rows.reverse();
  const rev = Number((await pool.query("select coalesce(max(rev), 0) as r from chat_messages where neighbourhood_id = $1 and room = $2", [id, room])).rows[0].r);
  res.json({ msgs: rows.map(r => chatView(r, u, mod)), rev, more: rows.length === CHAT_PAGE });
}));
app.post("/api/n/:id/chat/:room", ah(async (req, res) => {
  const { u, id, room, role } = await chatRoom(req);
  rl(`chat:${id}:${u.id}`, 8, 60000); rl(`chatD:${u.id}`, 300, 86400000);
  let text: string;
  try { text = chatText(req.body?.text); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const r = await chatWrite(id, room, async c => (await c.query("insert into chat_messages (neighbourhood_id, room, user_id, display_name, body) values ($1, $2, $3, $4, $5) returning id, rev, room, user_id, display_name, body, state, reports, created_at, $6::text as role", [id, room, u.id, u.handle, text, role])).rows[0]);
  res.json({ msg: chatView(r, u, canModerateChat(role, room)) });
}));
app.post("/api/n/:id/chat/:room/:mid/report", ah(async (req, res) => {
  const { u, id, room } = await chatRoom(req); const mid = chatId(req.params.mid);
  rl(`chatRep:${u.id}`, 20, 86400000);
  const hidden = await chatWrite(id, room, async c => {
    const r = (await c.query("select user_id, state, reports from chat_messages where id = $1 and neighbourhood_id = $2 and room = $3 for update", [mid, id, room])).rows[0];
    if (!r || r.state === "deleted") throw new HttpError(404, "Message not found");
    if (r.user_id === u.id) throw new HttpError(400, "You cannot report your own message");
    if ((r.reports as string[]).includes(u.id)) return false;
    const hide = r.state === "ok" && r.reports.length + 1 >= CHAT_HIDE_AT;
    await c.query("update chat_messages set reports = array_append(reports, $2::uuid), state = case when $3 then 'hidden' else state end, rev = nextval('chat_rev_seq') where id = $1", [mid, u.id, hide]);
    return hide;
  });
  if (hidden) void notify(id, "admins", { title: "A chat message was hidden", body: `Neighbours reported a message in the ${ROOMS.find(r => r.id === room)!.name} room, so it was hidden. Open Chat to review it.` });
  res.json({ ok: true, hidden });
}));
app.post("/api/n/:id/chat/:room/:mid/hide", ah(async (req, res) => {
  const { u, id, room, role } = await chatRoom(req); const mid = chatId(req.params.mid), hide = req.body?.hidden !== false;
  if (!canModerateChat(role, room)) throw new HttpError(403, "Only coordinators can hide messages");
  await chatWrite(id, room, async c => {
    const r = (await c.query("select display_name, state from chat_messages where id = $1 and neighbourhood_id = $2 and room = $3 for update", [mid, id, room])).rows[0];
    if (!r || r.state === "deleted") throw new HttpError(404, "Message not found");
    // Restoring clears the reports, so the coordinator's decision is not undone by the same reports.
    await c.query(`update chat_messages set state = $2, ${hide ? "" : "reports = '{}', "}rev = nextval('chat_rev_seq') where id = $1`, [mid, hide ? "hidden" : "ok"]);
    await c.query("insert into audit_log (neighbourhood_id, user_id, who, action, detail) values ($1, $2, $3, $4, $5)", [id, u.id, u.handle, hide ? "chatHide" : "chatRestore", JSON.stringify({ room, author: r.display_name })]);
  });
  res.json({ ok: true });
}));
app.delete("/api/n/:id/chat/:room/:mid", ah(async (req, res) => {
  const { u, id, room } = await chatRoom(req); const mid = chatId(req.params.mid);
  await chatWrite(id, room, async c => {
    const r = (await c.query("select user_id from chat_messages where id = $1 and neighbourhood_id = $2 and room = $3 for update", [mid, id, room])).rows[0];
    if (!r) throw new HttpError(404, "Message not found");
    if (r.user_id !== u.id) throw new HttpError(403, "You can only delete your own messages");
    await c.query("update chat_messages set state = 'deleted', body = '', reports = '{}', rev = nextval('chat_rev_seq') where id = $1", [mid]);
  });
  res.json({ ok: true });
}));

app.get("/api/capabilities", ah(async (req, res) => {
  await authenticate(req);
  res.json({ ai: aiEnabled(), tinyfish: tfEnabled(), ...caps(), cap: capFeedCount() });
}));

const KINDS_CH = ["push", "email", "sms", "whatsapp", "telegram"];
const mask = (k: string, t: string) => (k === "push" ? "This device" : k === "telegram" ? "Telegram chat" : k === "email" ? t.replace(/^(.).*(@.*)$/, "$1***$2") : `***${t.slice(-4)}`);
app.get("/api/n/:id/channels", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  await memberRole(pool, id, u);
  const r = await pool.query("select kind, target, verified from channels where user_id = $1 and neighbourhood_id = $2", [u.id, id]);
  res.json(r.rows.map(c => ({ kind: c.kind, target: mask(c.kind, c.target), verified: c.verified })));
}));
app.post("/api/n/:id/channels/:kind", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id), kind = String(req.params.kind), b = req.body ?? {};
  if (!isId(id) || !KINDS_CH.includes(kind)) throw new HttpError(400, "Invalid request");
  rl(`chan:${u.id}`, 20, 3600000);
  await memberRole(pool, id, u);
  const put = (target: string, verified: boolean, code: string | null) => pool.query(
    "insert into channels (user_id, neighbourhood_id, kind, target, verified, code, code_at) values ($1, $2, $3, $4, $5, $6, now()) on conflict (user_id, neighbourhood_id, kind) do update set target = excluded.target, verified = excluded.verified, code = excluded.code, code_at = now()",
    [u.id, id, kind, target, verified, code]);
  if (kind === "push") {
    const sub = b.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, "Invalid push subscription");
    await put(JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }), true, null);
    return res.json({ ok: true });
  }
  if (kind === "email") {
    if (!caps().email) throw new HttpError(400, "Email is not set up on this server");
    await put(u.email, true, null); return res.json({ ok: true });
  }
  if (kind === "telegram") {
    if (!caps().telegram) throw new HttpError(400, "Telegram is not set up on this server");
    rl(`tgstart:${u.id}`, 10, 3600000);
    const code = randomUUID().replace(/-/g, "").slice(0, 12);
    await put("", false, code);
    const bot = await tgBot().catch(() => { throw new HttpError(502, "Could not reach Telegram. Check the bot token"); });
    return res.json({ link: `https://t.me/${bot}?start=${code}`, bot });
  }
  if (typeof b.phone === "string") {
    if (!/^\+[1-9]\d{7,14}$/.test(b.phone)) throw new HttpError(400, "Use the international format, for example +919876543210");
    if (!(kind === "sms" ? caps().sms : caps().whatsapp)) throw new HttpError(400, "This channel is not set up on this server");
    rl(`code:${u.id}`, 3, 3600000);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await put(b.phone, false, code);
    await sendText(b.phone, `NEIGHBOURHOOD OS code: ${code}`, kind === "whatsapp").catch((e) => { console.error("sendText failed:", e?.message); throw new HttpError(502, "Could not send the code. Check the number"); });
    return res.json({ sent: true });
  }
  if (typeof b.code === "string") {
    rl(`verify:${u.id}`, 10, 3600000);
    const r = (await pool.query("select code, code_at from channels where user_id = $1 and neighbourhood_id = $2 and kind = $3", [u.id, id, kind])).rows[0];
    if (!r || !r.code || Date.now() - new Date(r.code_at).getTime() > 600000 || r.code !== b.code.trim()) throw new HttpError(400, "That code is wrong or expired");
    await pool.query("update channels set verified = true, code = null where user_id = $1 and neighbourhood_id = $2 and kind = $3", [u.id, id, kind]);
    return res.json({ ok: true });
  }
  throw new HttpError(400, "Invalid request");
}));
app.delete("/api/n/:id/channels/:kind", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id) || !KINDS_CH.includes(String(req.params.kind))) throw new HttpError(400, "Invalid request");
  await pool.query("delete from channels where user_id = $1 and neighbourhood_id = $2 and kind = $3", [u.id, id, req.params.kind]);
  res.json({ ok: true });
}));

/** Downloads a photo someone sent by WhatsApp/SMS, checks it really is a JPEG or PNG, strips its metadata (GPS, camera) and stores it. */
async function photoFromMessage(url: string, uid: string, nid: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)twilio\.com$/.test(u.hostname)) throw new Error("Unexpected photo address");
  rl(`photo:${uid}`, 30, 86400000);
  const auth = twilioAuth();
  const r = await fetch(url, { headers: auth ? { Authorization: auth } : {}, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Photo download failed");
  if (Number(r.headers.get("content-length") || 0) > MAX_PHOTO_BYTES) throw new Error("Photo too large");
  const raw = Buffer.from(await r.arrayBuffer());
  if (raw.length > MAX_PHOTO_BYTES) throw new Error("Photo too large");
  const kind = sniff(raw);
  if (!kind) throw new Error("Not a JPEG or PNG");
  const data = kind === "jpeg" ? stripJpegMetadata(raw) : raw;
  return (await pool.query("insert into photos (neighbourhood_id, user_id, mime, data) values ($1, $2, $3, $4) returning id", [nid, uid, `image/${kind}`, data])).rows[0].id;
}

/** Same checks as photoFromMessage, for a photo sent to the Telegram bot. */
async function photoFromTelegram(fileId: string, uid: string, nid: string): Promise<string> {
  rl(`photo:${uid}`, 30, 86400000);
  const f = await tgApi("getFile", { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${tgToken()}/${String(f.file_path)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Photo download failed");
  const raw = Buffer.from(await r.arrayBuffer());
  if (raw.length > MAX_PHOTO_BYTES) throw new Error("Photo too large");
  const kind = sniff(raw);
  if (!kind) throw new Error("Not a JPEG or PNG");
  const data = kind === "jpeg" ? stripJpegMetadata(raw) : raw;
  return (await pool.query("insert into photos (neighbourhood_id, user_id, mime, data) values ($1, $2, $3, $4) returning id", [nid, uid, `image/${kind}`, data])).rows[0].id;
}

const esc = (t: string) => t.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
app.post("/api/sms", ah(async (req, res) => {
  const reply = (t: string) => { console.log("[sms] replying:", t.slice(0, 120)); return res.type("text/xml").send(`<Response><Message>${esc(t.slice(0, 450))}</Message></Response>`); };
  const token = twilioToken();
  if (!token) throw new HttpError(503, "Messaging is not configured");
  const url = `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/api/sms`, given = String(req.headers["x-twilio-signature"] || ""), want = sign(url, req.body as Record<string, string>);
  console.log("[sms] incoming from", String(req.body.From || ""), "body:", String(req.body.Body || "").slice(0, 40));
  if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) { console.error("[sms] REJECTED: signature mismatch. PUBLIC_URL used:", JSON.stringify(process.env.PUBLIC_URL || ""), "| signature header present:", !!given, "| check PUBLIC_URL and TWILIO_AUTH_TOKEN on Render"); throw new HttpError(403, "Invalid signature"); }
  const from = String(req.body.From || "").replace(/^whatsapp:/, "");
  const nMedia = Number.parseInt(String(req.body.NumMedia ?? "0"), 10) || 0, mUrl = nMedia > 0 ? String(req.body.MediaUrl0 ?? "") : "";
  const lat = Number.parseFloat(String(req.body.Latitude ?? "")), lng = Number.parseFloat(String(req.body.Longitude ?? ""));
  return inbound({ from, kinds: ["sms", "whatsapp"], channel: String(req.body.From || "").startsWith("whatsapp:") ? "WhatsApp" : "SMS", body: String(req.body.Body || ""), lat: Number.isFinite(lat) ? lat : undefined, lng: Number.isFinite(lng) ? lng : undefined, media: mUrl ? (uid, nid) => photoFromMessage(mUrl, uid, nid) : undefined }, reply);
}));

type Inbound = { from: string; kinds: string[]; channel: "WhatsApp" | "SMS" | "Telegram"; body: string; lat?: number; lng?: number; media?: (uid: string, nid: string) => Promise<string> };
/** Shared by Twilio (SMS, WhatsApp) and Telegram: the same report-by-message conversation. */
async function inbound(m: Inbound, reply: (t: string) => unknown): Promise<unknown> {
  const from = m.from, words = m.body.trim().split(/\s+/);
  rl(`sms:${from}`, 20, 3600000);
  const ch = (await pool.query("select c.user_id, c.neighbourhood_id, m.display_name, n.center_lat, n.center_lng from channels c join members m on m.user_id = c.user_id and m.neighbourhood_id = c.neighbourhood_id join neighbourhoods n on n.id = c.neighbourhood_id where c.kind = any($2) and c.target = $1 and c.verified order by c.created_at desc limit 1", [from, m.kinds])).rows[0];
  if (!ch) return reply("This number is not linked. Link it in NEIGHBOURHOOD OS under Account, Notifications.");
  const actor: Actor = { id: ch.user_id, handle: ch.display_name, platformAdmin: false }, cmd = (words[0] || "").toUpperCase();
  try {
    if (cmd === "FIXED" || cmd === "NOTFIXED" || (cmd === "NOT" && (words[1] || "").toUpperCase() === "FIXED")) {
      const ok = cmd === "FIXED", n = (await pool.query("select doc from neighbourhoods where id = $1", [ch.neighbourhood_id])).rows[0];
      const mine = ((n?.doc?.issues ?? []) as Doc["issues"]).filter(i => i.status === "pending" && !i.hidden && i.pendingBy !== actor.handle && reportersOf(i).includes(actor.handle));
      if (!mine.length) return reply("No fix is waiting for your answer right now.");
      if (mine.length > 1) return reply(`${mine.length} fixes are waiting for your answer. Please open NEIGHBOURHOOD OS and answer each one.`);
      await runAction(ch.neighbourhood_id, actor, { t: "reporterConfirm", id: mine[0].id, ok, note: "[via text message]" });
      return reply(ok ? `Thanks. "${mine[0].title}" is marked as fixed.` : `Thanks. "${mine[0].title}" is back in progress.`);
    }
    if (cmd === "STATUS") { const n = (await pool.query("select doc, center_lat, center_lng, radius_m from neighbourhoods where id = $1", [ch.neighbourhood_id])).rows[0]; const al = alertsOf(n).filter(a => SEV_RANK[a.sev] >= 2); return reply(`${n.doc.issues.filter((i: any) => i.status !== "resolved" && !i.hidden).length} open issues. ${al.length ? `ALERT: ${al[0].title}` : "No official alerts."}`); }

    // ---- Reporting a problem by message: a description, a place and an optional photo, in any order
    const channel = m.channel;
    const pin = { lat: m.lat ?? NaN, lng: m.lng ?? NaN };
    const hasPin = Number.isFinite(pin.lat) && Number.isFinite(pin.lng);
    const mediaUrl = m.media;
    const parsed = parseBody(hasPin ? "" : m.body); // a shared pin's label is not a description
    if (parsed.cmd === "help" && !hasPin && !mediaUrl) return reply(MSG.help);
    const key = [ch.user_id, ch.neighbourhood_id];
    if (parsed.cmd === "cancel") { await pool.query("delete from text_drafts where user_id = $1 and neighbourhood_id = $2", key); return reply(MSG.cancelled); }
    const row = (await pool.query("select text, photo::text as photo, lat, lng, approx from text_drafts where user_id = $1 and neighbourhood_id = $2 and created_at > now() - make_interval(mins => $3)", [...key, DRAFT_MINUTES])).rows[0];
    const prev: Draft | null = row ? { text: row.text ?? undefined, photo: row.photo ?? undefined, lat: row.lat ?? undefined, lng: row.lng ?? undefined, approx: !!row.approx } : null;
    let photoNote = "", photo: string | undefined;
    if (mediaUrl) { try { photo = await m.media!(ch.user_id, ch.neighbourhood_id); } catch (e) { console.warn("Photo from message skipped:", (e as Error).message); photoNote = MSG.photoSkipped; } }
    const draft = mergeDraft(prev, { text: parsed.text, photo, lat: hasPin ? pin.lat : parsed.lat, lng: hasPin ? pin.lng : parsed.lng, centre: parsed.cmd === "centre" }, { lat: ch.center_lat, lng: ch.center_lng });
    const save = (d: Draft) => pool.query("insert into text_drafts (user_id, neighbourhood_id, text, photo, lat, lng, approx, created_at) values ($1, $2, $3, $4, $5, $6, $7, now()) on conflict (user_id, neighbourhood_id) do update set text = $3, photo = $4, lat = $5, lng = $6, approx = $7, created_at = now()", [...key, d.text ?? null, d.photo ?? null, d.lat ?? null, d.lng ?? null, !!d.approx]);
    const need = missing(draft);
    if (need) {
      if (!prev && !draft.text && draft.lat === undefined && !draft.photo) return reply(MSG.tooShort);
      await save(draft); pool.query("delete from text_drafts where created_at < now() - interval '1 day'").catch(() => undefined);
      return reply((draft.text ? MSG.askLocation(draft.text) : draft.lat !== undefined ? MSG.askText : MSG.askBoth) + photoNote);
    }
    let info; try { info = await aiAnalyze(draft.text!); } catch { info = understand(draft.text!); }
    const title = titleOf(draft.text!);
    try {
      // The pin decides which of the person's neighbourhoods the report goes to (they can belong to several)
      const mine = (await pool.query("select m.neighbourhood_id, m.display_name, n.name, n.center_lat, n.center_lng, n.radius_m from members m join neighbourhoods n on n.id = m.neighbourhood_id where m.user_id = $1", [ch.user_id])).rows as { neighbourhood_id: string; display_name: string; name: string; center_lat: number; center_lng: number; radius_m: number }[];
      const ranked = mine.map(h => ({ h, d: metresBetween({ lat: h.center_lat, lng: h.center_lng }, { lat: draft.lat!, lng: draft.lng! }) })).sort((a, b) => a.d - b.d);
      const list = ranked.map(x => `${x.h.name} ${Math.round(x.d)} m (limit ${Math.round(x.h.radius_m * 1.15)} m)`).join("; ");
      let hit = ranked.find(x => x.d <= x.h.radius_m * 1.15), moved = 0, pt = { lat: draft.lat!, lng: draft.lng! };
      if (!hit && ranked.length && ranked[0].d <= 3000) {
        // A member's pin slightly outside their own neighbourhood: keep the report, move the pin to the nearest edge and say so
        hit = ranked[0]; moved = Math.round(hit.d);
        const k = (hit.h.radius_m * 0.98) / hit.d;
        pt = { lat: hit.h.center_lat + (draft.lat! - hit.h.center_lat) * k, lng: hit.h.center_lng + (draft.lng! - hit.h.center_lng) * k };
      }
      if (!hit) throw new HttpError(400, ranked.length ? `That spot is not near any of your neighbourhoods. Distances from their centres: ${list}` : "You are not in a neighbourhood yet");
      const where: Actor = { id: ch.user_id, handle: hit.h.display_name, platformAdmin: false };
      const out = await runAction(hit.h.neighbourhood_id, where, { t: "report", title, desc: (descOf(draft, channel) + (moved ? `\n[The shared pin was about ${moved} m from the centre of this neighbourhood, outside its area, so it was moved to the nearest edge. Please confirm the location.]` : "")).slice(0, 1000), cat: info.cat, priority: info.priority, lat: pt.lat, lng: pt.lng, photo: draft.photo, agent: { lang: info.lang, original: draft.text!, summaryEn: info.summaryEn, source: info.source } });
      await pool.query("delete from text_drafts where user_id = $1 and neighbourhood_id = $2", key);
      return reply(MSG.done(title, String(out.result), CAT_EN[info.cat as Cat]) + (mine.length > 1 ? ` Neighbourhood: ${hit.h.name}.` : "") + photoNote);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) { await pool.query("delete from text_drafts where user_id = $1 and neighbourhood_id = $2", key); return reply("You have sent several reports this hour. Please try again a little later."); }
      await save({ ...draft, lat: undefined, lng: undefined, approx: false }); // keep the description and photo, ask for the place again
      return reply(`${e instanceof HttpError || e instanceof Error ? e.message : "Something went wrong"}. Send your location again, or CANCEL.`);
    }
  } catch (e) { console.error("[sms] handler error:", (e as Error)?.message); return reply(e instanceof HttpError ? e.message : "Something went wrong. Try again."); }
}

/** Telegram webhook. Telegram calls it with every message sent to the bot (registered by tgSetup at startup). */
const tgText = (t: string) => t.replace(/WhatsApp: tap \+ then Location\. SMS: paste a map link or type CENTRE( to use the neighbourhood centre)?\./, "Telegram: tap the paperclip, then Location, or type CENTRE to use the neighbourhood centre.");
app.post("/api/telegram", async (req, res) => {
  try {
    if (!tgToken()) return res.sendStatus(503);
    if (String(req.headers["x-telegram-bot-api-secret-token"] || "") !== tgSecret()) { console.error("[tg] REJECTED: wrong secret header"); return res.sendStatus(403); }
    const msg = req.body?.message;
    if (!msg?.chat?.id || msg.chat.type !== "private") return res.json({});
    const chatId = String(msg.chat.id);
    const reply = (t: string) => { console.log("[tg] replying:", t.slice(0, 120)); return res.json({ method: "sendMessage", chat_id: msg.chat.id, text: tgText(t).slice(0, 3500) }); };
    const text = String(msg.text ?? msg.caption ?? "").trim();
    console.log("[tg] incoming from chat", chatId, "text:", text.slice(0, 40));
    const start = /^\/start(?:@\w+)?(?:\s+(\w+))?$/.exec(text);
    if (start) {
      if (!start[1]) return reply("Hello! To link this chat, open NEIGHBOURHOOD OS, go to Account, Notifications, and press Link Telegram.");
      const r = await pool.query("update channels set target = $1, verified = true, code = null where kind = 'telegram' and not verified and code = $2 and code_at > now() - interval '10 minutes' returning user_id", [chatId, start[1]]);
      return reply(r.rowCount ? "Linked. You can now report a problem here: send a short description (and a photo if you can), then share your location. Send HELP for the steps." : "That link has expired or was already used. Press Link Telegram in the app again.");
    }
    const photos = Array.isArray(msg.photo) ? (msg.photo as { file_id: string; file_size?: number }[]).filter(p => (p.file_size ?? 0) <= MAX_PHOTO_BYTES) : [];
    const fileId = photos.length ? photos[photos.length - 1].file_id : "";
    const loc = msg.location as { latitude?: number; longitude?: number } | undefined;
    await inbound({ from: chatId, kinds: ["telegram"], channel: "Telegram", body: text.replace(/^\/(\w+)(@\w+)?/, "$1"), lat: loc?.latitude, lng: loc?.longitude, media: fileId ? (uid, nid) => photoFromTelegram(fileId, uid, nid) : undefined }, reply);
  } catch (e) {
    console.error("[tg] handler error:", (e as Error)?.message);
    if (!res.headersSent) res.json({}); // always answer 200 so Telegram does not keep retrying
  }
});

app.post("/api/n/:id/agent/analyze", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  rl(`analyze:${u.id}`, 40, 3600000);
  await memberRole(pool, id, u);
  const text = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (text.length < 3) throw new HttpError(400, "Describe the problem first");
  res.json(await aiAnalyze(text));
}));

app.post("/api/n/:id/ai/compare", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  rl(`ai:${u.id}`, 20, 3600000);
  await memberRole(pool, id, u);
  const n = (await pool.query("select doc from neighbourhoods where id = $1", [id])).rows[0];
  const i = n?.doc.issues.find((x: any) => x.id === req.body?.issueId && !x.hidden);
  if (!i?.photo || !/^[0-9a-f-]{36}$/.test(i.photo)) throw new HttpError(400, "This issue has no original photo to compare with");
  const p = (await pool.query("select mime, data from photos where id = $1 and neighbourhood_id = $2", [i.photo, id])).rows[0];
  if (!p) throw new HttpError(404, "Original photo not found");
  try { res.json(await aiCompare({ mime: p.mime, b64: p.data.toString("base64") }, String(req.body?.photo ?? ""), i.cat)); } catch (e) { throw new HttpError(400, (e as Error).message); }
}));

const aiRoute = (fn: (doc: Doc, body: any) => Promise<unknown>, max: number) => ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  rl(`ai:${u.id}`, max, 3600000);
  const role = await memberRole(pool, id, u);
  const n = (await pool.query("select doc from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighbourhood not found");
  try { res.json(await fn(viewDoc(n.doc, role, u.handle), req.body ?? {})); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
app.post("/api/n/:id/ai/suggest", aiRoute((doc, b) => {
  if (typeof b.title !== "string" || typeof b.lat !== "number" || typeof b.lng !== "number") throw new Error("Invalid request");
  return aiSuggest(doc, { title: b.title.slice(0, 120), desc: String(b.desc ?? "").slice(0, 1000), cat: b.cat, lat: b.lat, lng: b.lng });
}, 30));
app.post("/api/n/:id/ai/image", aiRoute((_doc, b) => aiImage(String(b.photo ?? ""), String(b.mode ?? "report"), b.cat), 20));
app.post("/api/n/:id/ai/insights", aiRoute(doc => aiInsights(doc), 10));

const CATS = ["pothole", "garbage", "streetlight", "water", "unsafe", "blocked", "other"];
const tfFail = (e: unknown): never => { if (e instanceof TinyFishError) throw new HttpError(e.status, e.message); throw e; };
const tfAdmin = async (req: express.Request) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  if (!tfEnabled()) throw new HttpError(503, "TinyFish is not set up on this server");
  if ((await memberRole(pool, id, u)) !== "admin") throw new HttpError(403, "Only a coordinator can use the TinyFish web agent");
  return { u, id };
};

app.post("/api/n/:id/tinyfish/route", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  if (!tfEnabled()) throw new HttpError(503, "TinyFish is not set up on this server");
  rl(`tfroute:${u.id}`, 20, 3600000);
  await memberRole(pool, id, u);
  const cat = String(req.body?.cat ?? "other");
  if (!CATS.includes(cat)) throw new HttpError(400, "Invalid category");
  let city = String(req.body?.city ?? "").trim().slice(0, 80);
  if (!city) {
    const n = (await pool.query("select center_lat, center_lng from neighbourhoods where id = $1", [id])).rows[0];
    if (!n) throw new HttpError(404, "Neighbourhood not found");
    city = await cityOf(n.center_lat, n.center_lng);
  }
  if (!city) throw new HttpError(400, "Could not tell the city. Type it in and try again");
  try { res.json(await verifyRoute(city, cat as Cat)); } catch (e) { tfFail(e); }
}));

app.post("/api/n/:id/tinyfish/status", ah(async (req, res) => {
  const { u, id } = await tfAdmin(req);
  rl(`tfstatus:${u.id}`, 10, 3600000);
  rl("tfstatus:all", 100, 86400000);
  const n = (await pool.query("select doc from neighbourhoods where id = $1", [id])).rows[0];
  const issueId = String(req.body?.issueId ?? "");
  const i = n?.doc.issues.find((x: any) => x.id === issueId && !x.hidden);
  if (!i) throw new HttpError(404, "Issue not found");
  if (!i.handoff?.ref) throw new HttpError(400, "Save the reference number first");
  try {
    const runId = await startStatusRun(String(req.body?.url ?? ""), i.handoff.ref);
    trackRun(runId, { nid: id, uid: u.id, issueId });
    res.json({ runId });
  } catch (e) { tfFail(e); }
}));

app.get("/api/n/:id/tinyfish/runs/:runId", ah(async (req, res) => {
  const { u, id } = await tfAdmin(req);
  rl(`tfpoll:${u.id}`, 300, 3600000);
  const runId = String(req.params.runId), o = runOwner(runId);
  if (!o || o.nid !== id || o.uid !== u.id) throw new HttpError(404, "Run not found");
  try { res.json(await (o.kind === "ward" ? getWardRun(runId) : getStatusRun(runId))); } catch (e) { tfFail(e); }
}));

// Official addresses for the state this neighbourhood is in, so a coordinator does not have to look them up.
// Only the state and city of the neighbourhood's centre are used. A coordinator can always change the address.
app.post("/api/n/:id/authority-suggestions", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighbourhood");
  if ((await memberRole(pool, id, u)) !== "admin") throw new HttpError(403, "Only a coordinator can see authority suggestions");
  rl(`authsug:${u.id}`, 60, 3600000);
  const n = (await pool.query("select center_lat, center_lng from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighbourhood not found");
  const cat = String(req.body?.cat ?? ""), a = await areaOf(n.center_lat, n.center_lng), region = regionFor(a.state);
  res.json({ place: { city: a.city, state: a.state }, region: region?.label ?? null, entries: region ? suggestionsFor(region, (CATS as string[]).includes(cat) ? (cat as Cat) : undefined) : [] });
}));

app.post("/api/n/:id/tinyfish/ward/pages", ah(async (req, res) => {
  const { u, id } = await tfAdmin(req);
  rl(`tfwardpages:${u.id}`, 20, 3600000);
  const n = (await pool.query("select center_lat, center_lng from neighbourhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighbourhood not found");
  const a = await areaOf(n.center_lat, n.center_lng);
  const typed = String(req.body?.city ?? "").trim().slice(0, 80);
  const city = typed || [a.city, a.state].filter(Boolean).join(", ");
  if (!city) throw new HttpError(400, "Could not tell the city. Type it in and try again");
  try { res.json({ area: { locality: a.locality, city: typed || a.city, postcode: a.postcode }, sources: await wardPages(city) }); } catch (e) { tfFail(e); }
}));

app.post("/api/n/:id/tinyfish/ward", ah(async (req, res) => {
  const { u, id } = await tfAdmin(req);
  rl(`tfward:${u.id}`, 5, 3600000);
  rl("tfward:all", 30, 86400000);
  try {
    const runId = await startWardRun(String(req.body?.url ?? ""), req.body?.area);
    trackRun(runId, { nid: id, uid: u.id, kind: "ward" });
    res.json({ runId });
  } catch (e) { tfFail(e); }
}));

app.get("/api/public/tinyfish", (_req, res) => res.json({ enabled: tfEnabled() }));
app.post("/api/public/tinyfish/route", ah(async (req, res) => {
  if (!tfEnabled()) throw new HttpError(503, "TinyFish is not set up on this server");
  rl(`tfpub:${req.ip}`, 6, 3600000);
  rl("tfpub:all", 300, 86400000);
  const cat = String(req.body?.cat ?? "other");
  if (!CATS.includes(cat)) throw new HttpError(400, "Invalid category");
  const city = String(req.body?.city ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} ,.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (city.length < 2) throw new HttpError(400, "Enter a city name");
  try { res.json(await verifyRoute(city, cat as Cat)); } catch (e) { tfFail(e); }
}));

app.delete("/api/me", ah(async (req, res) => {
  const u = await authenticate(req);
  await tx(async c => {
    const ms = (await c.query("select neighbourhood_id from members where user_id = $1", [u.id])).rows;
    for (const { neighbourhood_id } of ms) {
      const n = (await c.query("select doc from neighbourhoods where id = $1 for update", [neighbourhood_id])).rows[0];
      if (!n) continue;
      const doc = JSON.stringify(n.doc).split(u.handle).join("Former member");
      await c.query("update neighbourhoods set doc = $2, version = version + 1 where id = $1", [neighbourhood_id, doc]);
    }
    await c.query("delete from text_drafts where user_id = $1", [u.id]);
    await c.query("delete from photos where user_id = $1", [u.id]);
    await c.query("delete from chat_messages where user_id = $1", [u.id]);
    await c.query("update chat_messages set reports = array_remove(reports, $1::uuid) where $1::uuid = any(reports)", [u.id]);
    await c.query("delete from members where user_id = $1", [u.id]);
  });
  const { error } = await sb.auth.admin.deleteUser(u.id);
  if (error) throw new HttpError(500, "Your data was removed but the login could not be deleted. Contact the administrator");
  for (const [k, v] of tokens) if (v.u.id === u.id) tokens.delete(k);
  res.json({ ok: true });
}));

async function purgeAll() {
  try { await pool.query(`delete from chat_messages where created_at < now() - interval '${CHAT_DAYS} days'`); } catch (e) { console.error("Chat purge failed:", e); }
  try {
    // Missions, volunteers, resources, check-ins, the care register, old emergency plans and exchange posts no longer exist.
    // Older neighbourhoods may still hold them, so they are wiped here once. SOS requests and safety plans are kept.
    await pool.query(`update neighbourhoods set doc = (doc - 'checkin' - 'care' - 'plan' - 'shares' - 'sosActive') || '{"volunteers":[],"missions":[],"resources":[]}'::jsonb, version = version + 1
      where doc ?| array['checkin', 'care', 'plan', 'shares', 'sosActive']
        or jsonb_array_length(coalesce(doc->'volunteers', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(doc->'missions', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(doc->'resources', '[]'::jsonb)) > 0`);
  } catch (e) { console.error("Legacy data cleanup failed:", e); }
  try {
    // SOS requests close after 24 hours and lose their location, note and phone number. Old safety plans close too.
    const r = await pool.query("select id from neighbourhoods where jsonb_array_length(coalesce(doc->'sos', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(doc->'safety', '[]'::jsonb)) > 0");
    for (const { id } of r.rows) {
      await tx(async c => {
        const n = (await c.query("select doc from neighbourhoods where id = $1 for update", [id])).rows[0];
        if (!n) return;
        const a = purgeSos(n.doc), b = purgeSafety(n.doc);
        if (a || b) await c.query("update neighbourhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(n.doc)]);
      });
    }
  } catch (e) { console.error("SOS purge failed:", e); }
}
async function escalationJob() {
  try {
    const rows = (await pool.query("select id from neighbourhoods where position('\"escalateAt\"' in doc::text) > 0")).rows;
    for (const { id } of rows) {
      const titles = await tx(async c => {
        const n = (await c.query("select name, doc from neighbourhoods where id = $1 for update", [id])).rows[0];
        if (!n) return [] as string[];
        const t = dueEscalations(n.doc, Date.now(), n.name);
        if (t.length) await c.query("update neighbourhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(n.doc)]);
        return t;
      });
      if (titles.length) await notify(id, "admins", { title: "Escalation draft ready", body: `${titles.slice(0, 3).join("; ")}. Review and approve it in the app.`, urgent: true });
    }
  } catch (e) { console.error("Escalation job failed:", e); }
}
const alerted = new Set<string>();
async function alertWatcher() {
  try {
    const rows = (await pool.query("select id, center_lat, center_lng, radius_m from neighbourhoods where exists (select 1 from channels c where c.neighbourhood_id = neighbourhoods.id and c.verified)")).rows;
    if (!rows.length) return;
    await getWorld().catch(() => undefined); await getCap().catch(() => undefined);
    if (alerted.size > 5000) alerted.clear();
    for (const n of rows) for (const a of alertsOf(n).filter(x => SEV_RANK[x.sev] >= 2)) {
      const k = `${n.id}:${a.id}`; if (alerted.has(k)) continue; alerted.add(k);
      await notify(n.id, "all", { title: "Official alert near your neighbourhood", body: `${a.title}${a.km ? ` (${a.km} km away)` : ""}. Follow your national authorities.`, urgent: true });
    }
  } catch (e) { console.error("Alert watcher failed:", e); }
}
async function digestJob() {
  try {
    const ids = (await pool.query("select id from neighbourhoods where (doc->>'digestAt') is null or (doc->>'digestAt')::bigint < $1", [Date.now() - 7 * 86400000])).rows;
    for (const { id } of ids) {
      const posted = await tx(async c => {
        const n = (await c.query("select doc from neighbourhoods where id = $1 for update", [id])).rows[0];
        if (!n) return null;
        const d: Doc = n.doc; d.digestAt = Date.now();
        if (!d.issues.length) { await c.query("update neighbourhoods set doc = $2 where id = $1", [id, JSON.stringify(d)]); return null; }
        const ins = await aiInsights(d), base = weeklyDigest(d);
        const body = `${ins.source === "ai" ? ins.summary : base.body.split("\n")[0]}\n${ins.bullets.map(b => `- ${b.title}: ${b.detail}`).join("\n")}`.slice(0, 1000);
        (d.notices ??= []).unshift({ id: "n" + Date.now().toString(36), title: base.title, body, author: "NEIGHBOURHOOD OS (automated)", created: Date.now(), pinned: false, urgent: false });
        d.notices = d.notices.slice(0, 50);
        await c.query("update neighbourhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(d)]);
        return { title: base.title, body };
      });
      if (posted) await notify(id, "all", { title: posted.title, body: posted.body, kinds: ["email"] });
    }
  } catch (e) { console.error("Digest job failed:", e); }
}
setInterval(alertWatcher, 300000).unref();
setInterval(escalationJob, 900000).unref();
setInterval(digestJob, 3600000).unref();
setTimeout(() => { void alertWatcher(); void digestJob(); void escalationJob(); }, 15000).unref();
void purgeAll();
setInterval(purgeAll, 600000).unref();

const dist = path.resolve("dist");
if (existsSync(dist)) {
  const supa = new URL(process.env.SUPABASE_URL!).origin;
  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self' ${supa}`);
    next();
  });
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((e: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => fail(res, e?.status && e.status < 500 ? new HttpError(e.status, "Invalid request") : e));

// Chat needs its table and the two-role fix. Older installs may never have re-run database/schema.sql, so this makes sure both exist.
async function ensureSchema() {
  try {
    await pool.query(`
      create sequence if not exists chat_rev_seq;
      create table if not exists chat_messages (
        id bigserial primary key,
        neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
        room text not null check (room in ('all', 'volunteers', 'coordinators')),
        user_id uuid not null,
        display_name text not null,
        body text not null check (char_length(body) <= 500),
        state text not null default 'ok' check (state in ('ok', 'hidden', 'deleted')),
        reports uuid[] not null default '{}',
        rev bigint not null default nextval('chat_rev_seq'),
        created_at timestamptz not null default now()
      );
      create index if not exists chat_room_idx on chat_messages (neighbourhood_id, room, id desc);
      create index if not exists chat_rev_idx on chat_messages (neighbourhood_id, room, rev);
      create index if not exists chat_user_idx on chat_messages (user_id);
      create index if not exists chat_created_idx on chat_messages (created_at);
      alter table chat_messages enable row level security;
      update members set role = 'resident' where role in ('volunteer', 'moderator');
    `);
  } catch (e) { console.error("Schema check failed. Run database/schema.sql in the Supabase SQL editor:", (e as Error).message); }
  // Messaging tables and the Telegram channel kind (kept apart so a problem above cannot block them)
  try {
    await pool.query(`
      create table if not exists text_drafts (
        user_id uuid not null,
        neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
        text text, photo uuid, lat double precision, lng double precision,
        approx boolean not null default false,
        created_at timestamptz not null default now(),
        primary key (user_id, neighbourhood_id)
      );
      alter table text_drafts enable row level security;
      alter table channels drop constraint if exists channels_kind_check;
      alter table channels add constraint channels_kind_check check (kind in ('push', 'email', 'sms', 'whatsapp', 'telegram'));
      create index if not exists channels_tg_idx on channels (target) where kind = 'telegram';
    `);
  } catch (e) { console.error("Messaging schema check failed. Run database/add-telegram.sql in the Supabase SQL editor:", (e as Error).message); }
}
void ensureSchema();
app.listen(PORT, () => { void tgSetup(); console.log(`API on http://localhost:${PORT} · AI: ${aiLabel()} · TinyFish: ${tfLabel()}${existsSync(dist) ? " · serving built app" : ""}`); });