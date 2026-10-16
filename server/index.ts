import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import compression from "compression";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { can, dueEscalations, emptyDoc, publicSummary, purgeSos, reduce, sosActiveCount, STATUS_LABEL, visibleSos, weeklyDigest, type Action, type Doc, type Role } from "../src/logic";
import { alertsFor, SEV_RANK, type Alert } from "../src/world";
import { CELL_R, parseCell } from "../src/geo";
import { pool, tx } from "./db";
import { fetchMap, geocode, placeName } from "./osm";
import { aiAnalyze, aiCompare, aiEnabled, aiImage, aiInsights, aiLabel, aiSuggest } from "./ai";
import { getWorld, worldSnapshot } from "./world";
import { capAlertsFor, capFeedCount, capSnapshot, getCap } from "./cap";
import { caps, notify, sendEmail, sendText, sign, twilioReady, twilioToken } from "./notify";

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
  const r = await c.query("select role from members where neighborhood_id = $1 and user_id = $2", [nid, u.id]);
  if (!r.rows[0]) { if (u.platformAdmin) return "admin"; throw new HttpError(403, "Join this neighborhood first"); }
  return u.platformAdmin ? "admin" : (r.rows[0].role as Role);
}
const info = (n: any, role: Role) => ({ id: n.id, kind: n.kind, name: n.name, lat: n.center_lat, lng: n.center_lng, r: n.radius_m, role });
const viewDoc = (d: Doc, role: Role, handle: string, memberCount = 0): Doc => {
  const mod = role === "admin" || role === "moderator";
  const base: Doc = {
    ...d, memberCount, sos: visibleSos(d, role, handle), sosActive: sosActiveCount(d),
    events: d.events.filter(e => !e.to || e.to === handle),
    volunteers: d.volunteers.map(v => (mod || v.name === handle ? v : { ...v, lat: undefined, lng: undefined })),
  };
  if (role === "admin") return base;
  return {
    ...base, authorities: undefined,
    issues: (mod ? d.issues : d.issues.filter(i => !i.hidden)).map(i => ({ ...i, flags: mod ? i.flags : [], handoff: i.handoff ? { ...i.handoff, email: undefined } : undefined })),
    care: (d.care ?? []).filter(c => c.name === handle),
    checkin: d.checkin ? { ...d.checkin, replies: Object.fromEntries(Object.entries(d.checkin.replies).filter(([n]) => n === handle)) } : undefined,
  };
};
const countMembers = async (c: Q, id: string) => (await c.query("select count(*)::int as n from members where neighborhood_id = $1", [id])).rows[0].n as number;
const alertsOf = (n: { center_lat: number; center_lng: number; radius_m: number }): Alert[] => {
  const c = { lat: n.center_lat, lng: n.center_lng };
  return [...capAlertsFor(capSnapshot(), c, n.radius_m), ...alertsFor(worldSnapshot().events, c)].sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]).slice(0, 6);
};
const isId = (s: string) => /^[A-Za-z0-9:_-]{1,40}$/.test(s);

async function ensureMember(nid: string, u: User, role: Role = "resident"): Promise<Role> {
  const ex = await pool.query("select role from members where neighborhood_id = $1 and user_id = $2", [nid, u.id]);
  if (ex.rows[0]) return ex.rows[0].role;
  const cnt = await pool.query("select count(*)::int as n from members where user_id = $1", [u.id]);
  if (cnt.rows[0].n >= 5) throw new HttpError(400, "You can belong to up to 5 neighborhoods. Leave one first");
  await pool.query("insert into members (neighborhood_id, user_id, display_name, role) values ($1, $2, $3, $4) on conflict do nothing", [nid, u.id, u.handle, role]);
  return role;
}

const fail = (res: express.Response, e: unknown) => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Something went wrong on our side. Please try again" });
};
const ah = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => { fn(req, res).catch(e => fail(res, e)); };

const app = express();
app.disable("x-powered-by");
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

app.get("/api/neighborhoods/mine", ah(async (req, res) => {
  const u = await authenticate(req);
  const r = await pool.query("select n.*, m.role from members m join neighborhoods n on n.id = m.neighborhood_id where m.user_id = $1 order by m.joined_at", [u.id]);
  res.json(r.rows.map(n => info(n, u.platformAdmin ? "admin" : n.role)));
}));

app.post("/api/neighborhoods/cell", ah(async (req, res) => {
  const u = await authenticate(req); rl(`cell:${u.id}`, 30, 3600000);
  const cell = parseCell(String(req.body?.cell ?? ""));
  if (!cell) throw new HttpError(400, "Invalid area");
  let n = (await pool.query("select * from neighborhoods where id = $1", [cell.id])).rows[0];
  if (!n) {
    const name = await placeName(cell.lat, cell.lng);
    n = (await pool.query(
      "insert into neighborhoods (id, kind, name, center_lat, center_lng, radius_m, doc) values ($1, 'cell', $2, $3, $4, $5, $6) on conflict (id) do update set id = excluded.id returning *",
      [cell.id, name, cell.lat, cell.lng, CELL_R, JSON.stringify(emptyDoc())],
    )).rows[0];
  }
  res.json(info(n, await ensureMember(n.id, u)));
}));

app.post("/api/neighborhoods", ah(async (req, res) => {
  const u = await authenticate(req); rl(`create:${u.id}`, 3, 86400000);
  const name = String(req.body?.name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng), r = Math.round(Number(req.body?.r));
  if (name.length < 3) throw new HttpError(400, "Choose a name with at least 3 characters");
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, "Invalid location");
  if (!(r >= 200 && r <= 2000)) throw new HttpError(400, "The radius must be between 200 and 2000 meters");
  const id = "n_" + randomUUID().replace(/-/g, "").slice(0, 12);
  const n = (await pool.query("insert into neighborhoods (id, kind, name, center_lat, center_lng, radius_m, created_by, doc) values ($1, 'named', $2, $3, $4, $5, $6, $7) returning *", [id, name, lat, lng, r, u.id, JSON.stringify(emptyDoc())])).rows[0];
  res.json(info(n, await ensureMember(id, u, "admin")));
}));

app.post("/api/neighborhoods/:id/join", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id); rl(`join:${u.id}`, 30, 3600000);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  let n = (await pool.query("select * from neighborhoods where id = $1", [id])).rows[0];
  if (!n) {
    const cell = parseCell(id);
    if (!cell) throw new HttpError(404, "Neighborhood not found");
    n = (await pool.query("insert into neighborhoods (id, kind, name, center_lat, center_lng, radius_m, doc) values ($1, 'cell', $2, $3, $4, $5, $6) on conflict (id) do update set id = excluded.id returning *", [cell.id, await placeName(cell.lat, cell.lng), cell.lat, cell.lng, CELL_R, JSON.stringify(emptyDoc())])).rows[0];
  }
  res.json(info(n, await ensureMember(id, u)));
}));

const near = (rows: any[]) => rows.map(n => ({ id: n.id, name: n.name, r: n.radius_m, lat: n.center_lat, lng: n.center_lng, members: n.members }));
app.get("/api/neighborhoods/nearby", ah(async (req, res) => {
  const u = await authenticate(req); rl(`nearby:${u.id}`, 60, 3600000);
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new HttpError(400, "Invalid location");
  const r = await pool.query("select n.*, (select count(*)::int from members m where m.neighborhood_id = n.id) as members from neighborhoods n where kind = 'named' and center_lat between $1 and $2 and center_lng between $3 and $4 limit 20", [lat - 0.03, lat + 0.03, lng - 0.04, lng + 0.04]);
  res.json(near(r.rows));
}));
app.get("/api/neighborhoods/search", ah(async (req, res) => {
  const u = await authenticate(req); rl(`search:${u.id}`, 60, 3600000);
  const q = String(req.query.q ?? "").trim().replace(/[%_\\]/g, m => "\\" + m).slice(0, 60);
  if (q.length < 2) return res.json([]);
  const r = await pool.query("select n.*, (select count(*)::int from members m where m.neighborhood_id = n.id) as members from neighborhoods n where kind = 'named' and name ilike $1 limit 10", [`%${q}%`]);
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
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  const role = await memberRole(pool, id, u);
  const v = (await pool.query("select version, center_lat, center_lng, radius_m from neighborhoods where id = $1", [id])).rows[0];
  if (!v) throw new HttpError(404, "Neighborhood not found");
  const alerts = alertsOf(v);
  if (Number(req.query.v) === v.version) return res.json({ unchanged: true, version: v.version, role, alerts });
  const d = (await pool.query("select doc, version from neighborhoods where id = $1", [id])).rows[0];
  res.json({ version: d.version, doc: viewDoc(d.doc, role, u.handle, await countMembers(pool, id)), role, alerts });
}));

const LIMITS: Partial<Record<Action["t"], [number, number]>> = {
  report: [10, 86400000], proof: [30, 86400000], spam: [20, 86400000], merge: [40, 86400000], flag: [20, 86400000], mission: [20, 86400000], addResource: [20, 86400000], sos: [3, 86400000],
  update: [40, 86400000], feedback: [30, 86400000], agentStart: [20, 86400000], agentDraft: [60, 86400000], agentSend: [30, 86400000], shareAdd: [10, 86400000], shareMsg: [40, 86400000], careSet: [10, 86400000], noticeAdd: [20, 86400000], checkinStart: [10, 86400000],
};
const ADMIN_ACTIONS = new Set(["verify", "advance", "mission", "assign", "delivery", "shortage", "addResource", "hide", "restore", "sosAck", "sosAssign", "handoff", "handoffStatus", "planSet", "noticeAdd", "noticeRemove", "checkinStart", "checkinClose", "authoritySet", "authorityRemove", "agentEscalate", "approveResolution", "rejectResolution", "actionPlanApprove"]);

interface Actor { id: string; handle: string; platformAdmin: boolean }
async function runAction(id: string, u: Actor, a: Action) {
  if (!a || typeof a.t !== "string") throw new HttpError(400, "Invalid request");
  rl(`act:${u.id}`, 120, 60000);
  const lim = LIMITS[a.t]; if (lim) rl(`${a.t}:${id}:${u.id}`, lim[0], lim[1]);
  if (a.t === "report") rl(`reportH:${id}:${u.id}`, 4, 3600000);
  const out = await tx(async c => {
    const role = await memberRole(c, id, u as User);
    if (!can(role, a.t)) throw new HttpError(403, `The ${role} role is not allowed to do this`);
    if (a.t === "demo" || a.t === "reset") throw new HttpError(403, "Demo actions are not available in real neighborhoods");
    if (a.t === "agentSend" && a.via === "simulated") throw new HttpError(400, "Simulated sending is only for the demo");
    const n = (await c.query("select name, center_lat, center_lng, radius_m, doc, version from neighborhoods where id = $1 for update", [id])).rows[0];
    if (!n) throw new HttpError(404, "Neighborhood not found");
    if ("photo" in a && a.photo != null) {
      if (!/^[0-9a-f-]{36}$/.test(String(a.photo))) throw new HttpError(400, "Upload the photo first");
      if (!(await c.query("select 1 from photos where id = $1 and neighborhood_id = $2 and user_id = $3", [a.photo, id, u.id])).rows[0]) throw new HttpError(400, "Photo not found");
    }
    let r;
    try { r = reduce(n.doc, { role, name: u.handle }, a, { lat: n.center_lat, lng: n.center_lng, r: n.radius_m, name: n.name }); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const version = n.version + 1;
    await c.query("update neighborhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(r.doc)]);
    if (ADMIN_ACTIONS.has(a.t)) await c.query("insert into audit_log (neighborhood_id, user_id, who, action, detail) values ($1, $2, $3, $4, $5)", [id, u.id, u.handle, a.t, JSON.stringify({ id: (a as any).id ?? (a as any).mid ?? null }).slice(0, 200)]);
    return { raw: r.doc, doc: viewDoc(r.doc, role, u.handle, await countMembers(c, id)), result: r.result, version, role };
  });
  void afterAction(id, a, out.raw);
  return out;
}

async function afterAction(id: string, a: Action, raw: Doc) {
  try {
    if (a.t === "sos") await notify(id, "admins", { title: "New SOS request", body: "A neighbor asked for help. Open the SOS tab.", urgent: true });
    else if (a.t === "sosAssign") await notify(id, { name: a.name }, { title: "You were assigned to an SOS request", body: "Open the SOS tab for details.", urgent: true });
    else if (a.t === "assign") await notify(id, { name: a.name }, { title: "You were assigned to a mission", body: "Open the Missions tab." });
    else if (a.t === "checkinStart") await notify(id, "all", { title: "Safety check-in", body: `${a.title}. Please reply whether you are safe.`, urgent: true });
    else if (a.t === "noticeAdd" && a.urgent) await notify(id, "all", { title: a.title, body: a.body.slice(0, 140), urgent: true });
    else if (a.t === "advance" || a.t === "approveResolution" || a.t === "rejectResolution") {
      const i = raw.issues.find(x => x.id === a.id);
      if (i) {
        await notify(id, { name: i.author }, { title: "Update on your report", body: `"${i.title}" is now: ${STATUS_LABEL[i.status]}` });
        if (i.status === "pending") await notify(id, "reviewers", { title: "A fix is waiting for review", body: i.title, urgent: true });
      }
    }
    else if (a.t === "handoff") {
      const i = raw.issues.find(x => x.id === a.id);
      if (i?.handoff?.email) {
        const url = `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=18/${i.lat}/${i.lng}`;
        await sendEmail(i.handoff.email, `Community report: ${i.title}`, `A neighborhood coordinator is forwarding a community-reported issue.\n\nTitle: ${i.title}\nType: ${i.cat}\nPriority: ${i.priority}\nReports from neighbors: ${i.reports}\nDetails: ${i.desc || "none"}\nLocation: ${url}\nReference: ${i.handoff.ref || "none"}\n\nThis message was sent through NEIGHBORHOOD OS. It contains no personal details of the people who reported it. This issue is community-reported and has been reviewed by a human coordinator.`).catch(e => console.warn("Handoff email failed:", e.message));
      }
    }
  } catch (e) { console.error("afterAction failed:", e); }
}

app.post("/api/n/:id/action", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  const a = req.body as Action;
  if (a && a.t === "sos") delete (a as { contact?: string }).contact;
  const out = await runAction(id, u, a);
  res.json({ doc: out.doc, result: out.result, version: out.version, role: out.role });
}));

app.get("/api/world", ah(async (req, res) => {
  const u = await authenticate(req); rl(`world:${u.id}`, 30, 60000);
  const w = await getWorld();
  res.json({ events: w.events, sources: w.sources, updated: w.updated });
}));

const mapMisses = new Map<string, number>();
app.get("/api/n/:id/map", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  await memberRole(pool, id, u);
  const n = (await pool.query("select center_lat, center_lng, radius_m, map, map_fetched_at from neighborhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighborhood not found");
  if (n.map && n.map_fetched_at && Date.now() - new Date(n.map_fetched_at).getTime() < 30 * 86400000) return res.json(n.map);
  if (Date.now() - (mapMisses.get(id) ?? 0) < 600000) return res.json({ source: "none" });
  try {
    const m = await fetchMap(n.center_lat, n.center_lng, n.radius_m);
    if (m.roads.length < 8) throw new Error("too little map data");
    await pool.query("update neighborhoods set map = $2, map_fetched_at = now() where id = $1", [id, JSON.stringify(m)]);
    res.json(m);
  } catch (e) { console.warn("Map fetch failed for", id, (e as Error).message); mapMisses.set(id, Date.now()); res.json({ source: "none" }); }
}));

const MAGIC = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b.subarray(1, 4).toString() === "PNG" ? "image/png" : b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null);
app.post("/api/n/:id/photos", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  rl(`photo:${u.id}`, 30, 86400000);
  await memberRole(pool, id, u);
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.photo ?? ""));
  if (!m) throw new HttpError(400, "Send a JPEG, PNG or WebP image");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 300000) throw new HttpError(400, "That image is too large");
  const mime = MAGIC(buf);
  if (!mime) throw new HttpError(400, "That file is not a valid image");
  const r = await pool.query("insert into photos (neighborhood_id, user_id, mime, data) values ($1, $2, $3, $4) returning id", [id, u.id, mime, buf]);
  res.json({ id: r.rows[0].id });
}));
app.get("/api/photos/:pid", ah(async (req, res) => {
  const u = await authenticate(req); const pid = String(req.params.pid);
  if (!/^[0-9a-f-]{36}$/.test(pid)) throw new HttpError(400, "Invalid photo");
  const p = (await pool.query("select neighborhood_id, mime, data from photos where id = $1", [pid])).rows[0];
  if (!p) throw new HttpError(404, "Photo not found");
  await memberRole(pool, p.neighborhood_id, u);
  res.setHeader("Content-Type", p.mime); res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(p.data);
}));

const needAdmin = async (req: express.Request) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  if ((await memberRole(pool, id, u)) !== "admin") throw new HttpError(403, "Only coordinators can do this");
  return { u, id };
};
app.get("/api/n/:id/members", ah(async (req, res) => {
  const { id } = await needAdmin(req);
  const r = await pool.query("select user_id, display_name, role, coordinator_requested_at, joined_at from members where neighborhood_id = $1 order by joined_at limit 500", [id]);
  res.json(r.rows.map(m => ({ userId: m.user_id, name: m.display_name, role: m.role, requested: !!m.coordinator_requested_at, joined: m.joined_at })));
}));
app.post("/api/n/:id/members/:uid/role", ah(async (req, res) => {
  const { u, id } = await needAdmin(req); const uid = String(req.params.uid), role = String(req.body?.role);
  if (!["resident", "volunteer", "moderator", "admin"].includes(role)) throw new HttpError(400, "Invalid role");
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new HttpError(400, "Invalid member");
  await tx(async c => {
    const t = (await c.query("select role from members where neighborhood_id = $1 and user_id = $2 for update", [id, uid])).rows[0];
    if (!t) throw new HttpError(404, "Member not found");
    if (t.role === "admin" && role !== "admin") {
      const n = (await c.query("select count(*)::int as n from members where neighborhood_id = $1 and role = 'admin'", [id])).rows[0].n;
      if (n <= 1) throw new HttpError(400, "A neighborhood needs at least one coordinator");
    }
    await c.query("update members set role = $3, coordinator_requested_at = null where neighborhood_id = $1 and user_id = $2", [id, uid, role]);
    await c.query("insert into audit_log (neighborhood_id, user_id, who, action, detail) values ($1, $2, $3, 'role', $4)", [id, u.id, u.handle, JSON.stringify({ member: uid, role })]);
  });
  res.json({ ok: true });
}));
app.get("/api/n/:id/audit", ah(async (req, res) => {
  const { id } = await needAdmin(req);
  const r = await pool.query("select at, who, action, detail from audit_log where neighborhood_id = $1 order by at desc limit 30", [id]);
  res.json(r.rows.map(a => ({ at: a.at, who: a.who, action: a.action, detail: a.detail ? Object.values(a.detail).filter(Boolean).join(" ") : "" })));
}));
app.post("/api/n/:id/me/role", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id), role = String(req.body?.role);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  if (!["resident", "volunteer"].includes(role)) throw new HttpError(400, "Invalid role");
  const cur = await memberRole(pool, id, u);
  if (cur === "admin" || cur === "moderator") throw new HttpError(400, "Ask a coordinator to change your role");
  await pool.query("update members set role = $3 where neighborhood_id = $1 and user_id = $2", [id, u.id, role]);
  res.json({ role });
}));
app.post("/api/n/:id/coordinator-request", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id); rl(`coord:${u.id}`, 5, 86400000);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  await memberRole(pool, id, u);
  await pool.query("update members set coordinator_requested_at = now() where neighborhood_id = $1 and user_id = $2 and role <> 'admin'", [id, u.id]);
  res.json({ ok: true });
}));
app.post("/api/n/:id/leave", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  await tx(async c => {
    const m = (await c.query("select role from members where neighborhood_id = $1 and user_id = $2 for update", [id, u.id])).rows[0];
    if (!m) return;
    if (m.role === "admin") {
      const k = (await c.query("select count(*)::int as n from members where neighborhood_id = $1", [id])).rows[0].n;
      const a = (await c.query("select count(*)::int as n from members where neighborhood_id = $1 and role = 'admin'", [id])).rows[0].n;
      if (a <= 1 && k > 1) throw new HttpError(400, "Promote another coordinator before leaving");
    }
    await c.query("delete from members where neighborhood_id = $1 and user_id = $2", [id, u.id]);
  });
  res.json({ ok: true });
}));

app.get("/api/capabilities", ah(async (req, res) => {
  await authenticate(req);
  res.json({ ai: aiEnabled(), ...caps(), cap: capFeedCount() });
}));

const KINDS_CH = ["push", "email", "sms", "whatsapp"];
const mask = (k: string, t: string) => (k === "push" ? "This device" : k === "email" ? t.replace(/^(.).*(@.*)$/, "$1***$2") : `***${t.slice(-4)}`);
app.get("/api/n/:id/channels", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  await memberRole(pool, id, u);
  const r = await pool.query("select kind, target, verified from channels where user_id = $1 and neighborhood_id = $2", [u.id, id]);
  res.json(r.rows.map(c => ({ kind: c.kind, target: mask(c.kind, c.target), verified: c.verified })));
}));
app.post("/api/n/:id/channels/:kind", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id), kind = String(req.params.kind), b = req.body ?? {};
  if (!isId(id) || !KINDS_CH.includes(kind)) throw new HttpError(400, "Invalid request");
  rl(`chan:${u.id}`, 20, 3600000);
  await memberRole(pool, id, u);
  const put = (target: string, verified: boolean, code: string | null) => pool.query(
    "insert into channels (user_id, neighborhood_id, kind, target, verified, code, code_at) values ($1, $2, $3, $4, $5, $6, now()) on conflict (user_id, neighborhood_id, kind) do update set target = excluded.target, verified = excluded.verified, code = excluded.code, code_at = now()",
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
  if (typeof b.phone === "string") {
    if (!/^\+[1-9]\d{7,14}$/.test(b.phone)) throw new HttpError(400, "Use the international format, for example +919876543210");
    if (!(kind === "sms" ? caps().sms : caps().whatsapp)) throw new HttpError(400, "This channel is not set up on this server");
    rl(`code:${u.id}`, 3, 3600000);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await put(b.phone, false, code);
    await sendText(b.phone, `NEIGHBORHOOD OS code: ${code}`, kind === "whatsapp").catch(() => { throw new HttpError(502, "Could not send the code. Check the number"); });
    return res.json({ sent: true });
  }
  if (typeof b.code === "string") {
    rl(`verify:${u.id}`, 10, 3600000);
    const r = (await pool.query("select code, code_at from channels where user_id = $1 and neighborhood_id = $2 and kind = $3", [u.id, id, kind])).rows[0];
    if (!r || !r.code || Date.now() - new Date(r.code_at).getTime() > 600000 || r.code !== b.code.trim()) throw new HttpError(400, "That code is wrong or expired");
    await pool.query("update channels set verified = true, code = null where user_id = $1 and neighborhood_id = $2 and kind = $3", [u.id, id, kind]);
    return res.json({ ok: true });
  }
  throw new HttpError(400, "Invalid request");
}));
app.delete("/api/n/:id/channels/:kind", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id) || !KINDS_CH.includes(String(req.params.kind))) throw new HttpError(400, "Invalid request");
  await pool.query("delete from channels where user_id = $1 and neighborhood_id = $2 and kind = $3", [u.id, id, req.params.kind]);
  res.json({ ok: true });
}));

const esc = (t: string) => t.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
app.post("/api/sms", ah(async (req, res) => {
  const reply = (t: string) => res.type("text/xml").send(`<Response><Message>${esc(t.slice(0, 450))}</Message></Response>`);
  const token = twilioToken();
  if (!token) throw new HttpError(503, "Messaging is not configured");
  const url = `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/api/sms`, given = String(req.headers["x-twilio-signature"] || ""), want = sign(url, req.body as Record<string, string>);
  if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) throw new HttpError(403, "Invalid signature");
  const from = String(req.body.From || "").replace(/^whatsapp:/, ""), words = String(req.body.Body || "").trim().split(/\s+/);
  rl(`sms:${from}`, 10, 3600000);
  const ch = (await pool.query("select c.user_id, c.neighborhood_id, m.display_name, n.center_lat, n.center_lng from channels c join members m on m.user_id = c.user_id and m.neighborhood_id = c.neighborhood_id join neighborhoods n on n.id = c.neighborhood_id where c.kind in ('sms', 'whatsapp') and c.target = $1 and c.verified order by c.created_at desc limit 1", [from])).rows[0];
  if (!ch) return reply("This number is not linked. Link it in NEIGHBORHOOD OS under Account, Notifications.");
  const actor: Actor = { id: ch.user_id, handle: ch.display_name, platformAdmin: false }, cmd = (words[0] || "").toUpperCase();
  try {
    if (cmd === "SAFE") { await runAction(ch.neighborhood_id, actor, { t: "checkinReply", ok: true }); return reply("Thanks. You are marked safe."); }
    if (cmd === "NEED" || cmd === "HELP" && (words[1] || "").toUpperCase() === "ME") { await runAction(ch.neighborhood_id, actor, { t: "checkinReply", ok: false }); return reply("Noted. Coordinators can see that you need help. If in danger call your local emergency number."); }
    if (cmd === "STATUS") { const n = (await pool.query("select doc, center_lat, center_lng, radius_m from neighborhoods where id = $1", [ch.neighborhood_id])).rows[0]; const al = alertsOf(n).filter(a => SEV_RANK[a.sev] >= 2); return reply(`${n.doc.issues.filter((i: any) => i.status !== "resolved" && !i.hidden).length} open issues. ${al.length ? `ALERT: ${al[0].title}` : "No official alerts."}`); }
    if (cmd === "SOS") {
      const need = ({ MEDICAL: "medical", RESCUE: "rescue", SHELTER: "shelter", FOOD: "food_water", WATER: "food_water" } as Record<string, string>)[(words[1] || "").toUpperCase()] ?? "other";
      const people = /^\d+$/.test(words[2] || "") ? Number(words[2]) : 1, note = words.slice(/^\d+$/.test(words[2] || "") ? 3 : 2).join(" ");
      await runAction(ch.neighborhood_id, actor, { t: "sos", need: need as any, people, note: `[via text message] ${note}`.slice(0, 300), lat: ch.center_lat, lng: ch.center_lng, consent: true, contact: from } as any);
      return reply("SOS received. A coordinator will review it. It is unverified. If anyone is in danger call your local emergency number now.");
    }
    return reply("Commands: SAFE, NEED HELP, STATUS, SOS <medical|rescue|shelter|food> <people> <where you are and what you need>. Call your local emergency number first in danger.");
  } catch (e) { return reply(e instanceof HttpError ? e.message : "Something went wrong. Try again."); }
}));

app.get("/api/public/:id/summary", ah(async (req, res) => {
  rl(`pub:${req.ip}`, 30, 60000);
  const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  const n = (await pool.query("select name, doc from neighborhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighborhood not found");
  res.json({ name: n.name, summary: publicSummary(n.doc) });
}));

app.post("/api/n/:id/agent/analyze", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  rl(`analyze:${u.id}`, 40, 3600000);
  await memberRole(pool, id, u);
  const text = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (text.length < 3) throw new HttpError(400, "Describe the problem first");
  res.json(await aiAnalyze(text));
}));

app.post("/api/n/:id/ai/compare", ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  rl(`ai:${u.id}`, 20, 3600000);
  await memberRole(pool, id, u);
  const n = (await pool.query("select doc from neighborhoods where id = $1", [id])).rows[0];
  const i = n?.doc.issues.find((x: any) => x.id === req.body?.issueId && !x.hidden);
  if (!i?.photo || !/^[0-9a-f-]{36}$/.test(i.photo)) throw new HttpError(400, "This issue has no original photo to compare with");
  const p = (await pool.query("select mime, data from photos where id = $1 and neighborhood_id = $2", [i.photo, id])).rows[0];
  if (!p) throw new HttpError(404, "Original photo not found");
  try { res.json(await aiCompare({ mime: p.mime, b64: p.data.toString("base64") }, String(req.body?.photo ?? ""), i.cat)); } catch (e) { throw new HttpError(400, (e as Error).message); }
}));

const aiRoute = (fn: (doc: Doc, body: any) => Promise<unknown>, max: number) => ah(async (req, res) => {
  const u = await authenticate(req); const id = String(req.params.id);
  if (!isId(id)) throw new HttpError(400, "Invalid neighborhood");
  rl(`ai:${u.id}`, max, 3600000);
  const role = await memberRole(pool, id, u);
  const n = (await pool.query("select doc from neighborhoods where id = $1", [id])).rows[0];
  if (!n) throw new HttpError(404, "Neighborhood not found");
  try { res.json(await fn(viewDoc(n.doc, role, u.handle), req.body ?? {})); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
app.post("/api/n/:id/ai/suggest", aiRoute((doc, b) => {
  if (typeof b.title !== "string" || typeof b.lat !== "number" || typeof b.lng !== "number") throw new Error("Invalid request");
  return aiSuggest(doc, { title: b.title.slice(0, 120), desc: String(b.desc ?? "").slice(0, 1000), cat: b.cat, lat: b.lat, lng: b.lng });
}, 30));
app.post("/api/n/:id/ai/image", aiRoute((_doc, b) => aiImage(String(b.photo ?? ""), String(b.mode ?? "report"), b.cat), 20));
app.post("/api/n/:id/ai/insights", aiRoute(doc => aiInsights(doc), 10));

app.delete("/api/me", ah(async (req, res) => {
  const u = await authenticate(req);
  await tx(async c => {
    const ms = (await c.query("select neighborhood_id from members where user_id = $1", [u.id])).rows;
    for (const { neighborhood_id } of ms) {
      const n = (await c.query("select doc from neighborhoods where id = $1 for update", [neighborhood_id])).rows[0];
      if (!n) continue;
      const doc = JSON.stringify(n.doc).split(u.handle).join("Former member");
      await c.query("update neighborhoods set doc = $2, version = version + 1 where id = $1", [neighborhood_id, doc]);
    }
    await c.query("delete from photos where user_id = $1", [u.id]);
    await c.query("delete from members where user_id = $1", [u.id]);
  });
  const { error } = await sb.auth.admin.deleteUser(u.id);
  if (error) throw new HttpError(500, "Your data was removed but the login could not be deleted. Contact the administrator");
  for (const [k, v] of tokens) if (v.u.id === u.id) tokens.delete(k);
  res.json({ ok: true });
}));

async function purgeAll() {
  try {
    const r = await pool.query("select id from neighborhoods where jsonb_array_length(coalesce(doc->'sos', '[]'::jsonb)) > 0");
    for (const { id } of r.rows) {
      await tx(async c => {
        const n = (await c.query("select doc from neighborhoods where id = $1 for update", [id])).rows[0];
        if (n && purgeSos(n.doc)) await c.query("update neighborhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(n.doc)]);
      });
    }
  } catch (e) { console.error("SOS purge failed:", e); }
}
async function escalationJob() {
  try {
    const rows = (await pool.query("select id from neighborhoods where position('\"escalateAt\"' in doc::text) > 0")).rows;
    for (const { id } of rows) {
      const titles = await tx(async c => {
        const n = (await c.query("select name, doc from neighborhoods where id = $1 for update", [id])).rows[0];
        if (!n) return [] as string[];
        const t = dueEscalations(n.doc, Date.now(), n.name);
        if (t.length) await c.query("update neighborhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(n.doc)]);
        return t;
      });
      if (titles.length) await notify(id, "admins", { title: "Escalation draft ready", body: `${titles.slice(0, 3).join("; ")}. Review and approve it in the app.`, urgent: true });
    }
  } catch (e) { console.error("Escalation job failed:", e); }
}
const alerted = new Set<string>();
async function alertWatcher() {
  try {
    const rows = (await pool.query("select id, center_lat, center_lng, radius_m from neighborhoods where exists (select 1 from channels c where c.neighborhood_id = neighborhoods.id and c.verified)")).rows;
    if (!rows.length) return;
    await getWorld().catch(() => undefined); await getCap().catch(() => undefined);
    if (alerted.size > 5000) alerted.clear();
    for (const n of rows) for (const a of alertsOf(n).filter(x => SEV_RANK[x.sev] >= 2)) {
      const k = `${n.id}:${a.id}`; if (alerted.has(k)) continue; alerted.add(k);
      await notify(n.id, "all", { title: "Official alert near your neighborhood", body: `${a.title}${a.km ? ` (${a.km} km away)` : ""}. Follow your national authorities.`, urgent: true });
    }
  } catch (e) { console.error("Alert watcher failed:", e); }
}
async function digestJob() {
  try {
    const ids = (await pool.query("select id from neighborhoods where (doc->>'digestAt') is null or (doc->>'digestAt')::bigint < $1", [Date.now() - 7 * 86400000])).rows;
    for (const { id } of ids) {
      const posted = await tx(async c => {
        const n = (await c.query("select doc from neighborhoods where id = $1 for update", [id])).rows[0];
        if (!n) return null;
        const d: Doc = n.doc; d.digestAt = Date.now();
        if (!d.issues.length) { await c.query("update neighborhoods set doc = $2 where id = $1", [id, JSON.stringify(d)]); return null; }
        const ins = await aiInsights(d), base = weeklyDigest(d);
        const body = `${ins.source === "ai" ? ins.summary : base.body.split("\n")[0]}\n${ins.bullets.map(b => `- ${b.title}: ${b.detail}`).join("\n")}`.slice(0, 1000);
        (d.notices ??= []).unshift({ id: "n" + Date.now().toString(36), title: base.title, body, author: "NEIGHBORHOOD OS (automated)", created: Date.now(), pinned: false, urgent: false });
        d.notices = d.notices.slice(0, 50);
        await c.query("update neighborhoods set doc = $2, version = version + 1 where id = $1", [id, JSON.stringify(d)]);
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

app.listen(PORT, () => console.log(`API on http://localhost:${PORT} · AI: ${aiLabel()}${existsSync(dist) ? " · serving built app" : ""}`));