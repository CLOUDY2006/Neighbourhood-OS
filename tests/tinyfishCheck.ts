import http from "node:http";
import type { AddressInfo } from "node:net";
import { extractContacts, getStatusRun, isOfficial, cleanRef, resetTinyFish, runOwner, safePortalUrl, startStatusRun, suggestStatus, tfEnabled, trackRun, verifyRoute, TinyFishError } from "../server/tinyfish";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const KEY = "test-key-not-real";

type Hit = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any };
let hits: Hit[] = [], mode = "ok";
const PAGE = [
  "# Municipal Corporation grievance cell",
  "Call our toll free helpline 1800 11 2345 or dial 1916 for sanitation complaints.",
  "Established in 1998 and renovated 2019. Call 2024 for nothing.",
  "Email: grievance.cell@city.gov.in",
  "[Register a complaint](https://city.gov.in/complaint/new) and [Track your complaint status](https://city.gov.in/track)",
  "[About us](https://city.gov.in/about)",
].join("\n");

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => (raw += c));
  req.on("end", () => {
    const h: Hit = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null };
    hits.push(h);
    const send = (code: number, o: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(typeof o === "string" ? o : JSON.stringify(o)); };
    if (mode === "429") return send(429, {});
    if (mode === "401") return send(401, { error: "bad key " + KEY });
    if (mode === "badjson") return send(200, "not json");
    if (req.url?.startsWith("/search")) {
      return send(200, { query: "q", results: [
        { position: 1, site_name: "blog", title: "A blog about civic life", snippet: "tips", url: "https://civic-blog.example.com/post" },
        { position: 2, site_name: "city.gov.in", title: "City Municipal Corporation", snippet: "Official site", url: "https://city.gov.in/grievance" },
        { position: 3, site_name: "x", title: "Bad link", snippet: "", url: "javascript:alert(1)" },
      ] });
    }
    if (req.url?.startsWith("/fetch")) {
      return send(200, { results: h.body.urls.map((u: string) => ({ url: u, final_url: u, title: "t", format: "markdown", text: u.includes("city.gov.in") ? PAGE : "nothing useful here" })), errors: [] });
    }
    if (req.url === "/agent/v1/automation/run-async") {
      if (mode === "schema400" && h.body.output_schema) return send(400, { error: "unsupported schema" });
      return send(200, { run_id: "run_abc123", error: null });
    }
    const m = req.url?.match(/^\/agent\/v1\/runs\/([^/]+)$/);
    if (m) {
      if (mode === "running") return send(200, { run_id: m[1], status: "RUNNING", streaming_url: "https://stream.example.com/x" });
      if (mode === "insecure-stream") return send(200, { status: "RUNNING", streaming_url: "http://evil.example.com/x" });
      if (mode === "failed") return send(200, { status: "FAILED", error: { code: "SITE_BLOCKED", message: "Blocked", help_message: "The site blocked the agent." } });
      if (mode === "bare") return send(200, { status: "COMPLETED", result: { result: "Status: Closed" } });
      if (mode === "notfound") return send(200, { status: "COMPLETED", result: { found: false, remarks: "Number not found" } });
      return send(200, { status: "COMPLETED", result: { found: true, status: "Action taken. Complaint closed", lastUpdated: "12 Oct 2026", remarks: "<b>Fixed</b> by zone 4" } });
    }
    send(404, {});
  });
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const reset = () => { hits = []; mode = "ok"; resetTinyFish(); };
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as TinyFishError; } };

delete process.env.TINYFISH_API_KEY;
reset();
check("no key means TinyFish is off", !tfEnabled());
let e = await fails(verifyRoute("Pune", "water"));
check("no key: verifyRoute refuses with 503 and makes no request", e?.status === 503 && hits.length === 0, `(${e?.status})`);

Object.assign(process.env, { TINYFISH_API_KEY: KEY, TINYFISH_SEARCH_URL: `${base}/search`, TINYFISH_FETCH_URL: `${base}/fetch`, TINYFISH_AGENT_URL: `${base}/agent` });
reset();
check("key set means TinyFish is on", tfEnabled());

const r = await verifyRoute("Pune, Maharashtra", "garbage");
check("search sends the key in X-API-Key and the query in the URL", hits[0].headers["x-api-key"] === KEY && hits[0].method === "GET" && hits[0].url.includes("query=Pune"), hits[0].url.slice(0, 60));
check("fetch is a POST of up to 3 urls as markdown", hits.some(h => h.url === "/fetch" && h.method === "POST" && h.body.format === "markdown" && h.body.urls.length <= 3 && h.body.urls.length >= 1));
check("official government site is ranked first and flagged", r.sources[0].url.includes("city.gov.in") && r.sources[0].official && !r.sources[1].official);
check("non-http links in results are dropped", r.sources.every(s => /^https?:/.test(s.url)));
check("helplines are found (1800 number and 1916), years are not", r.helplines.some(h => h.value.includes("1800")) && r.helplines.some(h => h.value === "1916") && !r.helplines.some(h => h.value === "2024" || h.value === "1998"), JSON.stringify(r.helplines.map(h => h.value)));
check("email found", r.emails[0]?.value === "grievance.cell@city.gov.in");
check("complaint and tracker links are labeled, other links ignored", r.links.some(l => l.kind === "complaint") && r.links.some(l => l.kind === "track") && !r.links.some(l => l.url.includes("about")));
check("note tells the person to confirm", /confirm/i.test(r.note) && r.source === "tinyfish");
const n = hits.length;
await verifyRoute("pune, maharashtra", "garbage");
check("same city and category is served from the cache (no new requests)", hits.length === n);
e = await fails(verifyRoute("x", "water"));
check("a one-letter city is rejected before any request", e?.status === 400 && hits.length === n);

reset(); mode = "429";
e = await fails(verifyRoute("Delhi", "water"));
check("HTTP 429 gives a friendly 429 error", e?.status === 429 && /busy/i.test(e.message), e?.message);
reset(); mode = "401";
e = await fails(verifyRoute("Delhi", "water"));
check("HTTP 401 mentions the server setting and never leaks the key", e?.status === 502 && /TINYFISH_API_KEY/.test(e.message) && !e.message.includes(KEY), e?.message);
reset(); mode = "badjson";
e = await fails(verifyRoute("Delhi", "water"));
check("unreadable reply gives a clean error", e instanceof TinyFishError && e.status === 502);

const x = extractContacts("Dial 100 for police. Contact helpdesk: 011-2345-6789 call. info@x.org", "https://a.gov.in");
check("extractContacts finds a phone near a help word and an email", x.helplines.some(h => h.value.startsWith("011")) && x.emails[0].value === "info@x.org", JSON.stringify(x.helplines));
check("official domain patterns", isOfficial("https://mcd.nic.in/x") && isOfficial("https://city.gov.in") && isOfficial("https://www.nyc.gov/a") && !isOfficial("https://gov.in.evil.com") && !isOfficial("https://notgov.com") && !isOfficial("https://example.com"));

check("portal url: normal https accepted, hash removed", safePortalUrl("https://mcdonline.nic.in/track#top") === "https://mcdonline.nic.in/track");
for (const bad1 of ["http://city.gov.in/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://user:pw@city.gov.in/", "https://city.gov.in:8443/", "https://intranet/", "ftp://city.gov.in", "javascript:alert(1)", "https://printer.local/"]) {
  let blocked = false; try { safePortalUrl(bad1); } catch (er) { blocked = er instanceof TinyFishError && er.status === 400; }
  check(`portal url blocked: ${bad1}`, blocked);
}
check("reference number: normal accepted", cleanRef("DEL/2026/00123") === "DEL/2026/00123");
let refBad = false; try { cleanRef("<script>x</script>"); } catch { refBad = true; }
check("reference number: markup rejected", refBad);

reset();
const id = await startStatusRun("https://city.gov.in/track", "DEL/2026/00123");
const call = hits.find(h => h.url === "/agent/v1/automation/run-async")!;
check("status run: returns the run id and sends the key", id === "run_abc123" && call.headers["x-api-key"] === KEY);
check("status run: goal is read-only and has the reference number", /read-only/i.test(call.body.goal) && /do not log in/i.test(call.body.goal) && call.body.goal.includes("DEL/2026/00123") && call.body.url === "https://city.gov.in/track");
check("status run: asks for a JSON schema and a time limit", call.body.output_schema?.required?.[0] === "found" && call.body.agent_config.max_duration_seconds === 120);
reset(); mode = "schema400";
const id2 = await startStatusRun("https://city.gov.in/track", "ABC-123");
check("rejected schema is retried once without it", id2 === "run_abc123" && hits.length === 2 && !hits[1].body.output_schema, `(${hits.length} requests)`);
e = await fails(startStatusRun("http://city.gov.in/track", "ABC-123"));
check("status run: bad address is refused before any request", e?.status === 400 && hits.length === 2);

reset(); mode = "running";
let s = await getStatusRun("run_abc123");
check("running run shows the live link", s.state === "running" && s.streamingUrl === "https://stream.example.com/x");
mode = "insecure-stream"; s = await getStatusRun("run_abc123");
check("non-https live link is dropped", s.state === "running" && !s.streamingUrl);
mode = "ok"; s = await getStatusRun("run_abc123");
check("completed run is normalized and the page's own words are plain text", s.state === "done" && s.found === true && s.status === "Action taken. Complaint closed" && s.lastUpdated === "12 Oct 2026" && s.remarks === "<b>Fixed</b> by zone 4");
check("a closed status suggests 'resolved' (a person still decides)", s.suggest === "resolved");
mode = "notfound"; s = await getStatusRun("run_abc123");
check("not found gives no suggestion", s.found === false && !s.suggest && s.remarks === "Number not found");
mode = "bare"; s = await getStatusRun("run_abc123");
check("bare text answer under result.result is handled", s.state === "done" && s.found === false && s.remarks === "Status: Closed");
mode = "failed"; s = await getStatusRun("run_abc123");
check("failed run gives the help message", s.state === "failed" && /blocked/i.test(s.error ?? ""));
e = await fails(getStatusRun("../../etc/passwd"));
check("run id with odd characters is rejected", e?.status === 400);

const T: [string, string | undefined][] = [
  ["Closed", "resolved"], ["Complaint disposed and action taken", "resolved"], ["Not resolved", undefined], ["Unresolved, work in progress", "acknowledged"],
  ["Registered. Assigned to zonal officer", "acknowledged"], ["Under process", "acknowledged"], ["Pending", undefined], ["", undefined],
];
for (const [t, want] of T) check(`suggestStatus("${t}") is ${want ?? "nothing"}`, suggestStatus(t) === want, `(${suggestStatus(t)})`);

trackRun("run_abc123", { nid: "n1", uid: "u1", issueId: "i1" });
check("run ownership is remembered", runOwner("run_abc123")?.uid === "u1" && runOwner("nope") === undefined);

server.close();
if (bad) { console.log(`\n${bad} TinyFish test(s) failed`); process.exit(1); }
console.log("\nall TinyFish tests passed");