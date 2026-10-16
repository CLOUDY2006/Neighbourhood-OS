import http from "node:http";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };

const queries: string[] = [];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => (raw += c));
  req.on("end", () => {
    const send = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url?.startsWith("/search")) {
      queries.push(decodeURIComponent(new URL(req.url, "http://x").searchParams.get("query") ?? ""));
      return send({ results: [{ title: "City Municipal Corporation", snippet: "Official", url: "https://city.gov.in/grievance" }] });
    }
    if (req.url?.startsWith("/fetch")) return send({ results: JSON.parse(raw).urls.map((u: string) => ({ url: u, final_url: u, text: "Toll free helpline 1800 11 2345\n[Register a complaint](https://city.gov.in/new)" })), errors: [] });
    res.writeHead(404); res.end("{}");
  });
});
await new Promise<void>(r => mock.listen(0, "127.0.0.1", r));
const mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

const freePort = () => new Promise<number>(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
const children: ChildProcess[] = [];

async function boot(extra: Record<string, string>) {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env, PORT: String(port), SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "x", DATABASE_URL: "postgres://u:p@127.0.0.1:1/db", DATABASE_SSL: "false",
    CONTACT_EMAIL: "test@example.com", AI_API_KEY: "", ANTHROPIC_API_KEY: "", TINYFISH_API_KEY: "", ...extra,
  };
  const child = spawn("npx", ["tsx", "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let log = "";
  child.stdout!.on("data", d => (log += d)); child.stderr!.on("data", d => (log += d));
  const t0 = Date.now();
  while (!log.includes("API on") && Date.now() - t0 < 30000 && child.exitCode === null) await new Promise(r => setTimeout(r, 150));
  if (!log.includes("API on")) { console.log(log); throw new Error("the server did not start"); }
  return { base: `http://127.0.0.1:${port}`, log: () => log };
}
const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

try {
  const a = await boot({ TINYFISH_API_KEY: "test-key", TINYFISH_SEARCH_URL: `${mockBase}/search`, TINYFISH_FETCH_URL: `${mockBase}/fetch`, TINYFISH_AGENT_URL: `${mockBase}/agent` });
  check("startup log says TinyFish is on", /TinyFish: on/.test(a.log()));
  let r = await fetch(a.base + "/api/public/tinyfish");
  check("public status says enabled", (await r.json() as any).enabled === true);

  r = await post(a.base, "/api/public/tinyfish/route", { city: "Pune", cat: "garbage" }, { "x-forwarded-for": "1.1.1.1" });
  const j: any = await r.json();
  check("public route answers 200 with the official site first", r.status === 200 && j.sources[0].official === true && j.source === "tinyfish", `(${r.status})`);
  check("public route returns the helpline and complaint link", j.helplines?.[0]?.value?.includes("1800") && j.links?.[0]?.kind === "complaint");

  r = await post(a.base, "/api/public/tinyfish/route", { city: "<script>alert(1)</script>Nagpur", cat: "water" }, { "x-forwarded-for": "1.1.1.2" });
  await r.json();
  check("markup in the city is stripped before searching", r.status === 200 && queries.every(q => !/[<>()]/.test(q)) && queries.some(q => q.includes("Nagpur")), JSON.stringify(queries.at(-1)));

  r = await post(a.base, "/api/public/tinyfish/route", { city: "Pune", cat: "nonsense" }, { "x-forwarded-for": "1.1.1.3" });
  check("unknown category is rejected with 400", r.status === 400);
  r = await post(a.base, "/api/public/tinyfish/route", { city: "x", cat: "water" }, { "x-forwarded-for": "1.1.1.4" });
  check("one-letter city is rejected with 400", r.status === 400);

  let got429 = 0, sent = 0;
  for (let n = 0; n < 9 && !got429; n++) { sent++; const x = await post(a.base, "/api/public/tinyfish/route", { city: "Pune", cat: "garbage" }, { "x-forwarded-for": "2.2.2.2" }); if (x.status === 429) got429 = n + 1; await x.text(); }
  check("one visitor is limited to 6 tries an hour", got429 === 7, `(429 on request ${got429})`);
  r = await post(a.base, "/api/public/tinyfish/route", { city: "Pune", cat: "garbage" }, { "x-forwarded-for": "3.3.3.3" });
  check("a different visitor is not affected (proxy address is honored)", r.status === 200, `(${r.status})`);
  await r.text();

  r = await post(a.base, "/api/n/abc/tinyfish/route", { cat: "water" });
  check("signed-out request to the neighborhood route gets 401", r.status === 401);
  r = await post(a.base, "/api/n/abc/tinyfish/status", { issueId: "i1", url: "https://city.gov.in/track" });
  check("signed-out request to the status route gets 401", r.status === 401);
  r = await fetch(a.base + "/api/n/abc/tinyfish/runs/run_abc123");
  check("signed-out request to the run route gets 401", r.status === 401);

  const b = await boot({});
  check("startup log says TinyFish is off without a key", /TinyFish: off/.test(b.log()));
  r = await fetch(b.base + "/api/public/tinyfish");
  check("public status says disabled without a key", (await r.json() as any).enabled === false);
  r = await post(b.base, "/api/public/tinyfish/route", { city: "Pune", cat: "garbage" });
  check("public route answers 503 without a key", r.status === 503);
} catch (e) {
  bad++; console.log("FAIL", (e as Error).message);
} finally {
  for (const c of children) c.kill("SIGKILL");
  mock.close();
}
if (bad) { console.log(`\n${bad} TinyFish route test(s) failed`); process.exit(1); }
console.log("\nall TinyFish route tests passed");
process.exit(0);