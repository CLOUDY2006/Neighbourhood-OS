import type { Cat } from "../src/logic";

const DAY = 86400000;

export class TinyFishError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

/** Read the settings each time so tests and late-loaded .env files both work. */
export function tfConfig() {
  const e = process.env;
  const key = (e.TINYFISH_API_KEY || "").trim();
  const base = (v: string | undefined, d: string) => ((v || "").trim() || d).replace(/\/+$/, "");
  const cc = (e.TINYFISH_COUNTRY ?? "IN").trim().toUpperCase();
  return {
    key,
    enabled: !!key,
    // Two-letter country code that searches are limited to. Unset means India. Set it to empty for worldwide results.
    country: /^[A-Z]{2}$/.test(cc) ? cc : "",
    search: base(e.TINYFISH_SEARCH_URL, "https://api.search.tinyfish.ai"),
    fetch: base(e.TINYFISH_FETCH_URL, "https://api.fetch.tinyfish.ai"),
    agent: base(e.TINYFISH_AGENT_URL, "https://agent.tinyfish.ai"),
  };
}
export const tfEnabled = () => tfConfig().enabled;
export const tfLabel = () => (tfEnabled() ? "on" : "off (TINYFISH_API_KEY not set)");

const lastWarn = new Map<string, number>();
function warn(msg: string) {
  const now = Date.now();
  if ((lastWarn.get(msg) ?? 0) > now - 30000) return;
  lastWarn.set(msg, now);
  console.warn(`[tinyfish] ${msg}`);
}
export function resetTinyFish() { lastWarn.clear(); cache.clear(); pageCache.clear(); runs.clear(); }

async function call(url: string, init: { method?: string; body?: unknown }, ms: number): Promise<any> {
  const c = tfConfig();
  if (!c.enabled) throw new TinyFishError(503, "TinyFish is not set up on this server");
  let r: Response;
  try {
    r = await fetch(url, {
      method: init.method ?? "GET",
      headers: { "X-API-Key": c.key, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(ms),
    });
  } catch {
    warn("request failed or timed out");
    throw new TinyFishError(504, "TinyFish did not answer in time. Please try again");
  }
  if (r.status === 401 || r.status === 403) { warn(`HTTP ${r.status}: the API key was refused`); throw new TinyFishError(502, "TinyFish refused the request. Check TINYFISH_API_KEY on the server"); }
  if (r.status === 429) { warn("rate limited (HTTP 429)"); throw new TinyFishError(429, "TinyFish is busy right now. Please try again in a minute"); }
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 200);
    warn(`HTTP ${r.status} ${body}`);
    throw new TinyFishError(r.status === 400 ? 400 : 502, `TinyFish returned an error (${r.status})`);
  }
  try { return await r.json(); } catch { throw new TinyFishError(502, "TinyFish sent a reply that could not be read"); }
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/* ------------------------------------------------------------ route verification (Search + Fetch, free) */

export interface RouteSource { title: string; url: string; official: boolean; snippet: string }
export interface RouteCheck {
  city: string; region: string; cat: Cat; checkedAt: number; source: "tinyfish";
  sources: RouteSource[];
  helplines: { value: string; url: string }[];
  emails: { value: string; url: string }[];
  links: { label: string; url: string; kind: "complaint" | "track" }[];
  note: string;
}

const WHAT: Record<Cat, string> = {
  garbage: "garbage waste collection sanitation complaint", streetlight: "street light not working complaint electricity",
  water: "water supply leakage complaint water board", pothole: "pothole road repair complaint PWD roads department",
  unsafe: "unsafe public area hazard complaint", blocked: "road blockage obstruction encroachment complaint", other: "civic grievance complaint",
};
/** Words that show a page is about the problem itself, used so a pothole report prefers road and PWD pages over general city pages. */
const TOPIC: Record<Cat, string[]> = {
  garbage: ["garbage", "waste", "sanitation", "swachh", "sweeping", "solid waste", "dustbin", "cleanliness"],
  streetlight: ["street light", "streetlight", "lighting", "lamp", "electric"],
  water: ["water", "jal", "leak", "pipeline", "sewer", "supply"],
  pothole: ["pothole", "road repair", "roads", "road", "pwd", "public works"],
  unsafe: ["safety", "unsafe", "hazard", "disaster", "women", "emergency"],
  blocked: ["obstruction", "blocked", "blockage", "encroachment", "road", "traffic"],
  other: ["grievance", "complaint", "municipal", "civic"],
};
const GENERIC_PLACE = /^(colony|nagar|sector|sec|block|phase|extension|enclave|vihar|society|apartments?|road|market|village|town|city|area|ward|street)$/i;
/** If the person typed a locality plus a city ("dwarka sec-13 delhi"), the last word is usually the city, which is what the department pages are named after. */
export const cityOnly = (where: string): string | null => {
  const words = where.split(/[ ,]+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  return words.length >= 3 && last.length >= 4 && !/\d/.test(last) && !GENERIC_PLACE.test(last) ? last : null;
};
/** Order results: official government pages, pages about this kind of problem, pages that mention the place. Pure. */
export const rankSources = (found: RouteSource[], where: string, cat: Cat): RouteSource[] => rankBy(found, where, TOPIC[cat] ?? TOPIC.other);
function rankBy(found: RouteSource[], where: string, words: string[]): RouteSource[] {
  const uniq = [...new Map(found.map(r => [r.url, r])).values()];
  const tok = where.split(/[ ,]+/)[0].toLowerCase();
  const mentions = (r: RouteSource) => tok.length >= 3 && `${r.title} ${r.snippet} ${r.url}`.toLowerCase().includes(tok);
  const topical = (r: RouteSource) => { const h = `${r.title} ${r.snippet} ${r.url}`.toLowerCase(); return Math.min(2, words.filter(w => h.includes(w)).length); };
  const score = (r: RouteSource) => (r.official ? 3 : 0) + topical(r) * 2 + (mentions(r) ? 1 : 0);
  return [...uniq].sort((a, b) => score(b) - score(a));
}

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const REGION: Record<string, string> = { IN: "India" };
const GOV_DOMAINS: Record<string, string> = { IN: "gov.in,nic.in" };
/** Only strict government domain patterns count as official. Everything else is shown as "not confirmed". */
export const isOfficial = (u: string, country: string = tfConfig().country) =>
  country === "IN"
    ? /(^|\.)(gov|nic)\.in$/.test(hostOf(u))
    : /(^|\.)(gov|nic)\.[a-z]{2,3}(\.[a-z]{2})?$|\.gov$|\.gob\.[a-z]{2}$|\.govt\.[a-z]{2}$|\.go\.[a-z]{2}$/.test(hostOf(u));
/** When searching in India, drop pages that clearly belong to another country's government, school or military. */
const isForeign = (u: string, country: string) => country === "IN" && /\.(gov|edu|mil|us)$|\.(gov|co|ac)\.(uk|au|nz|za)$|\.gc\.ca$/.test(hostOf(u));
const httpsUrl = (u: unknown) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href.slice(0, 300) : ""; } catch { return ""; } };

const cache = new Map<string, { at: number; v: RouteCheck }>();

export async function tfSearch(query: string, includeDomains?: string): Promise<RouteSource[]> {
  const c = tfConfig(), q = new URLSearchParams({ query });
  if (c.country) q.set("location", c.country);
  if (includeDomains) q.set("include_domains", includeDomains);
  const j = await call(`${c.search}?${q}`, {}, 15000);
  const rows: any[] = Array.isArray(j?.results) ? j.results : [];
  return rows.map(r => ({ title: clean(r?.title, 140), url: httpsUrl(r?.url), official: false, snippet: clean(r?.snippet, 220) }))
    .filter(r => r.url && !isForeign(r.url, c.country)).map(r => ({ ...r, official: isOfficial(r.url, c.country) }));
}

export async function tfFetch(urls: string[]): Promise<{ url: string; text: string }[]> {
  if (!urls.length) return [];
  const j = await call(tfConfig().fetch, { method: "POST", body: { urls: urls.slice(0, 10), format: "markdown" } }, 30000);
  const rows: any[] = Array.isArray(j?.results) ? j.results : [];
  return rows.filter(r => typeof r?.text === "string").map(r => ({ url: httpsUrl(r.final_url || r.url), text: String(r.text).slice(0, 200000) })).filter(r => r.url);
}

const LONG_NUMBER = /\+?\d[\d ()-]{6,16}\d/g;
const SHORT_CODE = /\b(dial|helpline|help line|toll[- ]?free|call|number|no\.?|code)\s*[:\-]?\s*(\d{3,6})\b/gi;
const HELP_WORD = /helpline|help line|toll[- ]?free|call|dial|control room|complaint (?:no|number)|whatsapp/i;

/** Pull helplines, emails and complaint or tracking links out of page text. Pure, no AI, no guessing. */
export function extractContacts(text: string, url: string) {
  const helplines: { value: string; url: string }[] = [], emails: { value: string; url: string }[] = [], links: { label: string; url: string; kind: "complaint" | "track" }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (HELP_WORD.test(line) && line.length < 400) {
      const add = (value: string) => {
        const digits = value.replace(/\D/g, "");
        if (seen.has("p" + digits)) return;
        seen.add("p" + digits); helplines.push({ value: value.trim().slice(0, 20), url });
      };
      for (const m of line.match(LONG_NUMBER) ?? []) { const n = m.replace(/\D/g, "").length; if (n >= 8 && n <= 13) add(m); }
      // Short codes such as 1916 or 100 only count right after a word like "dial" or "helpline". A year after "call" is ignored.
      for (const m of line.matchAll(SHORT_CODE)) {
        const word = m[1].toLowerCase(), code = m[2], yearLike = /^(19|20)\d{2}$/.test(code);
        if (yearLike && !/^(dial|helpline|help line|toll)/.test(word)) continue;
        add(code);
      }
    }
    for (const m of line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
      const v = m.toLowerCase();
      if (!seen.has("e" + v)) { seen.add("e" + v); emails.push({ value: v.slice(0, 80), url }); }
    }
    for (const m of line.matchAll(/\[([^\]]{1,80})\]\((https?:\/\/[^)\s]{4,300})\)/g)) {
      const label = clean(m[1], 80), href = httpsUrl(m[2]);
      if (!href || seen.has("l" + href)) continue;
      const hay = `${label} ${href}`.toLowerCase();
      const kind = /track|status/.test(hay) ? "track" : /grievance|complaint|cpgrams|swachh|register/.test(hay) ? "complaint" : null;
      if (kind) { seen.add("l" + href); links.push({ label, url: href, kind }); }
    }
  }
  return { helplines: helplines.slice(0, 4), emails: emails.slice(0, 3), links: links.slice(0, 5) };
}

export async function verifyRoute(city: string, cat: Cat): Promise<RouteCheck> {
  const where = clean(city, 80);
  if (where.length < 2) throw new TinyFishError(400, "Enter the city name first");
  const { country } = tfConfig(), region = REGION[country] ?? country;
  const key = `${country}|${where.toLowerCase()}|${cat}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.v;

  const what = WHAT[cat] ?? WHAT.other;
  // Naming the country in the query keeps a short name such as "Delhi" from matching places abroad.
  const place = region && !where.toLowerCase().includes(region.toLowerCase()) ? `${where}, ${region}` : where;
  const q = (w: string) => `${w} municipal ${what} online portal helpline number`;
  const cityName = cityOnly(where), cityPlace = cityName && region ? `${cityName}, ${region}` : cityName;
  let found: RouteSource[];
  if (cityPlace) {
    // Search the exact place and the city at the same time. The city-wide search finds the department pages for this kind of problem.
    const both = await Promise.allSettled([tfSearch(q(place)), tfSearch(q(cityPlace))]);
    found = both.flatMap(r => (r.status === "fulfilled" ? r.value : []));
    if (!found.length) { const bad = both.find(r => r.status === "rejected") as PromiseRejectedResult | undefined; if (bad) throw bad.reason; }
  } else found = await tfSearch(q(place));
  if (!found.some(r => r.official) && GOV_DOMAINS[country]) {
    try { found = [...found, ...(await tfSearch(`${place} ${what}`, GOV_DOMAINS[country]))]; } catch (e) { if (!found.length) throw e; }
  }
  const ranked = rankSources(found, where, cat).slice(0, 5);
  if (!ranked.length) throw new TinyFishError(404, "No pages were found for that city. Check the spelling or try a larger nearby city");

  const toRead = ranked.slice(0, 3).map(r => r.url);
  let pages: { url: string; text: string }[] = [];
  try { pages = await tfFetch(toRead); } catch (e) { warn(`fetch step failed: ${(e as Error).message}`); }

  const helplines: RouteCheck["helplines"] = [], emails: RouteCheck["emails"] = [], links: RouteCheck["links"] = [];
  for (const p of pages) {
    const x = extractContacts(p.text, p.url);
    helplines.push(...x.helplines); emails.push(...x.emails); links.push(...x.links);
  }
  const official = ranked.some(r => r.official);
  const v: RouteCheck = {
    city: where, region, cat, checkedAt: Date.now(), source: "tinyfish", sources: ranked,
    helplines: helplines.slice(0, 5), emails: emails.slice(0, 4), links: links.slice(0, 6),
    note: official
      ? "Found on pages TinyFish read just now. Open the official link and confirm before you send anything."
      : `No ${region ? region + " " : ""}government website was among the top results. Treat these as leads only and check your city's official site.`,
  };
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return v;
}

/* ------------------------------------------------------------ status check (Web Agent, uses credits) */

export const cleanRef = (s: unknown) => {
  const r = clean(s, 60);
  if (!/^[A-Za-z0-9][A-Za-z0-9 /._-]{2,59}$/.test(r)) throw new TinyFishError(400, "The reference number looks wrong. Fix it in the agent panel first");
  return r;
};

/** Only public https websites. Blocks addresses, localhost, internal hosts and logins inside the link. */
export function safePortalUrl(u: unknown): string {
  let x: URL;
  try { x = new URL(String(u ?? "").trim()); } catch { throw new TinyFishError(400, "Enter a full web address that starts with https://"); }
  const h = x.hostname.toLowerCase();
  if (x.protocol !== "https:" || x.username || x.password || x.port && x.port !== "443") throw new TinyFishError(400, "Only normal https:// addresses are allowed");
  if (!h.includes(".") || h.length > 120 || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) throw new TinyFishError(400, "That address is not a public website");
  x.hash = "";
  return x.href.slice(0, 300);
}

const SCHEMA = {
  type: "object",
  properties: { found: { type: "boolean" }, status: { type: "string" }, lastUpdated: { type: "string" }, remarks: { type: "string" } },
  required: ["found"],
};

export const statusGoal = (ref: string) =>
  `Find this website's page for tracking or checking the status of an existing complaint. Look up complaint or reference number "${ref}" and read what the page shows. ` +
  `This is read-only. Do not log in, do not register, do not create or submit any new complaint or feedback, do not enter anything except the reference number, and do not enter any name, phone number or email. ` +
  `If the page needs a login, an OTP, a mobile number or a CAPTCHA, stop. ` +
  `Reply as JSON with: found (true only if the page showed a status for this exact number), status (the status text exactly as shown), lastUpdated (the date shown, if any), remarks (any officer remark shown, or why nothing was found).`;

type RunKind = "status" | "ward";
const runs = new Map<string, { nid: string; uid: string; issueId?: string; kind: RunKind; at: number }>();
export function trackRun(runId: string, o: { nid: string; uid: string; issueId?: string; kind?: RunKind }) {
  const now = Date.now();
  for (const [k, v] of runs) if (now - v.at > 2 * 3600000) runs.delete(k);
  runs.set(runId, { ...o, kind: o.kind ?? "status", at: now });
  if (runs.size > 500) runs.delete(runs.keys().next().value as string);
}
export const runOwner = (runId: string) => runs.get(runId);

async function startRun(url: string, goal: string, schema: object, seconds: number): Promise<string> {
  const c = tfConfig(), body = { url, goal, browser_profile: "lite", agent_config: { max_duration_seconds: seconds } };
  let j: any;
  try { j = await call(`${c.agent}/v1/automation/run-async`, { method: "POST", body: { ...body, output_schema: schema } }, 20000); }
  catch (e) {
    // The goal already asks for JSON, so a rejected schema is not fatal.
    if (e instanceof TinyFishError && e.status === 400) j = await call(`${c.agent}/v1/automation/run-async`, { method: "POST", body }, 20000);
    else throw e;
  }
  const id = typeof j?.run_id === "string" ? j.run_id : "";
  if (!id || j?.error) throw new TinyFishError(502, "TinyFish could not start the check");
  return id;
}

export async function startStatusRun(portalUrl: string, ref: string): Promise<string> {
  const url = safePortalUrl(portalUrl), r = cleanRef(ref);
  return startRun(url, statusGoal(r), SCHEMA, 120);
}

type RunRead = { state: "running" | "failed"; streamingUrl?: string; error?: string } | { state: "done"; streamingUrl?: string; res: any };
async function readRun(runId: string): Promise<RunRead> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(runId)) throw new TinyFishError(400, "Invalid run");
  const j = await call(`${tfConfig().agent}/v1/runs/${encodeURIComponent(runId)}`, {}, 15000);
  const st = String(j?.status ?? "");
  const stream = typeof j?.streaming_url === "string" && /^https:\/\//.test(j.streaming_url) ? j.streaming_url.slice(0, 500) : undefined;
  if (st === "PENDING" || st === "RUNNING" || !st) return { state: "running", streamingUrl: stream };
  if (st !== "COMPLETED") return { state: "failed", streamingUrl: stream, error: clean(j?.error?.help_message || j?.error?.message, 200) || "TinyFish could not finish the check" };
  let res: any = j?.result;
  if (typeof res === "string") { try { res = JSON.parse(res); } catch { res = { found: false, remarks: res }; } }
  if (res && res.found === undefined && res.result !== undefined) res = typeof res.result === "object" ? res.result : { found: false, remarks: res.result };
  return { state: "done", streamingUrl: stream, res };
}

export interface StatusResult {
  state: "running" | "done" | "failed"; streamingUrl?: string;
  found?: boolean; status?: string; lastUpdated?: string; remarks?: string;
  suggest?: "acknowledged" | "resolved"; error?: string;
}

/** Map the portal's own words to one of the app's hand-off states. A person still decides. */
export function suggestStatus(text: string): "acknowledged" | "resolved" | undefined {
  const t = text.toLowerCase();
  if (!t.trim() || /\b(not|un)\s?(yet\s)?(resolved|closed|completed|disposed)\b/.test(t) || /\bunresolved\b/.test(t)) return /\b(in progress|under process|assigned|forwarded|registered|received|acknowledged)\b/.test(t) ? "acknowledged" : undefined;
  if (/\b(resolved|closed|disposed|completed|redressed|rectified|action taken)\b/.test(t)) return "resolved";
  if (/\b(in progress|under process|processing|assigned|forwarded|registered|received|acknowledged|work started)\b/.test(t)) return "acknowledged";
  return undefined;
}

export async function getStatusRun(runId: string): Promise<StatusResult> {
  const r = await readRun(runId);
  if (r.state !== "done") return r;
  const res = r.res, found = res?.found === true;
  const status = clean(res?.status, 200), remarks = clean(res?.remarks, 400);
  return {
    state: "done", streamingUrl: r.streamingUrl, found, status, lastUpdated: clean(res?.lastUpdated, 60), remarks,
    suggest: found ? suggestStatus(`${status} ${remarks}`) : undefined,
  };
}

/* ------------------------------------------------------------ ward councillor lookup (Search is free, the Web Agent uses credits) */

export interface WardArea { locality: string; city: string; postcode: string }
const WARD_WORDS = ["ward", "councillor", "corporator", "parshad", "know your", "elected"];
const placeText = (s: unknown, max: number) => clean(s, max).normalize("NFKC").replace(/[^\p{L}\p{N} ,.'-]/gu, "").replace(/\s+/g, " ").trim();
const pageCache = new Map<string, { at: number; v: RouteSource[] }>();

/** Find the city's "know your ward" or councillor list pages. Government sites first. Free to run. */
export async function wardPages(city: string): Promise<RouteSource[]> {
  const where = placeText(city, 80);
  if (where.length < 2) throw new TinyFishError(400, "Enter the city name first");
  const { country } = tfConfig(), region = REGION[country] ?? country;
  const key = `${country}|${where.toLowerCase()}`, hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.v;
  const place = region && !where.toLowerCase().includes(region.toLowerCase()) ? `${where}, ${region}` : where;
  const q = `${place} municipal corporation know your ward councillor corporator list`;
  const got = await Promise.allSettled([tfSearch(q), ...(GOV_DOMAINS[country] ? [tfSearch(q, GOV_DOMAINS[country])] : [])]);
  const found = got.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  if (!found.length) {
    const bad = got.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (bad) throw bad.reason;
    throw new TinyFishError(404, "No ward pages were found for that city. Check the spelling, or paste the address of your city corporation's ward page");
  }
  const v = rankBy(found, where, WARD_WORDS).slice(0, 5);
  pageCache.set(key, { at: Date.now(), v });
  if (pageCache.size > 200) pageCache.delete(pageCache.keys().next().value as string);
  return v;
}

/** Only an area name, a city and a PIN code ever reach the agent, never a street address or a person's details. */
export function cleanArea(a: unknown): WardArea {
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const locality = placeText(o.locality, 60), city = placeText(o.city, 60), postcode = clean(o.postcode, 12).replace(/\s/g, "");
  if (locality.length < 2) throw new TinyFishError(400, "Enter the area name first");
  if (city.length < 2) throw new TinyFishError(400, "Enter the city first");
  if (postcode && !(tfConfig().country === "IN" ? /^\d{6}$/ : /^[A-Za-z0-9-]{3,10}$/).test(postcode)) throw new TinyFishError(400, "The PIN code looks wrong");
  return { locality, city, postcode };
}

const WARD_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" }, ward: { type: "string" }, councillor: { type: "string" }, phone: { type: "string" },
    email: { type: "string" }, office: { type: "string" }, sourceUrl: { type: "string" }, remarks: { type: "string" },
  },
  required: ["found"],
};

export const wardGoal = (a: WardArea) =>
  `Find which municipal ward covers the area "${a.locality}" in ${a.city}${a.postcode ? ` (PIN code ${a.postcode})` : ""}, and who its elected ward councillor is (also called corporator, parshad or ward member). ` +
  `You may use this website's ward search, ward lookup form, ward list or list of councillors. You may type or choose only the area name, the city or the PIN code. ` +
  `This is read-only. Do not log in, do not register, do not submit any complaint, feedback or other form, and do not enter any name, phone number, email or street address. If the page needs a login, an OTP, a mobile number or a CAPTCHA, stop. ` +
  `Do not guess. Only report what a page on this website shows. If the seat is vacant, or the city is run by an administrator with no elected councillors, say so in remarks. ` +
  `Reply as JSON with: found (true only if a page showed which ward covers this area), ward (the ward number and name as shown), councillor (the name exactly as shown, empty if none), ` +
  `phone, email and office (the ward office address), each only if shown, sourceUrl (the address of the page where you read this), remarks (anything to double-check, or why nothing was found).`;

export async function startWardRun(portalUrl: string, area: unknown): Promise<string> {
  const url = safePortalUrl(portalUrl), a = cleanArea(area);
  return startRun(url, wardGoal(a), WARD_SCHEMA, 150);
}

export interface WardResult {
  state: "running" | "done" | "failed"; streamingUrl?: string; error?: string;
  found?: boolean; ward?: string; councillor?: string; phone?: string; email?: string; office?: string; sourceUrl?: string; remarks?: string;
}
const phoneOf = (s: unknown) => (clean(s, 80).match(LONG_NUMBER) ?? []).find(m => { const n = m.replace(/\D/g, "").length; return n >= 8 && n <= 13; })?.trim().slice(0, 20) ?? "";
const emailOf = (s: unknown) => { const v = clean(s, 120).toLowerCase(); return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : ""; };

export async function getWardRun(runId: string): Promise<WardResult> {
  const r = await readRun(runId);
  if (r.state !== "done") return r;
  const x = r.res ?? {}, ward = clean(x.ward, 80), councillor = clean(x.councillor, 80), remarks = clean(x.remarks, 400);
  if (x.found !== true || !(ward || councillor)) return { state: "done", streamingUrl: r.streamingUrl, found: false, remarks };
  const src = httpsUrl(x.sourceUrl);
  return {
    state: "done", streamingUrl: r.streamingUrl, found: true, ward, councillor, remarks,
    phone: phoneOf(x.phone), email: emailOf(x.email), office: clean(x.office, 200), sourceUrl: src.startsWith("https://") ? src : "",
  };
}