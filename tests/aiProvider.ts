import http from "node:http";
import type { AddressInfo } from "node:net";
import { aiAnalyze, aiConfig, aiEnabled, aiImage, aiLabel, askAI, resetAi } from "../server/ai";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const clear = () => { for (const k of ["AI_API_KEY", "ANTHROPIC_API_KEY", "AI_PROVIDER", "AI_MODEL", "AI_BASE_URL", "AI_VISION"]) delete process.env[k]; resetAi(); };

let mode = "ok", hits = 0, last: { url: string; headers: http.IncomingHttpHeaders; body: any } | null = null;
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", c => (raw += c));
  req.on("end", () => {
    hits++; last = { url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null };
    if (mode === "429") { res.writeHead(429, { "retry-after": "30" }); res.end("{}"); return; }
    if (mode === "404") { res.writeHead(404); res.end('{"error":"model not found"}'); return; }
    const out = mode === "badjson" ? "sorry, no json" : mode === "fenced" ? '```json\n{"lang":"en","category":"water","priority":"high","summaryEn":"Pipe is leaking."}\n```' : '{"lang":"hi","category":"garbage","priority":"critical","summaryEn":"Garbage on the road.","label":"garbage pile","note":"Looks plausible.","plausible":true}';
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.includes("generateContent")) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }] }));
    else if (req.url?.includes("chat/completions")) res.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    else res.end(JSON.stringify({ content: [{ type: "text", text: out }] }));
  });
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const text = [{ type: "text" as const, text: "hello" }];
const img = [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "AAAA" } }, ...text];
const PHOTO = "data:image/png;base64,AAAA";

clear();
check("no key means AI is off", !aiEnabled() && aiLabel().startsWith("off"));
check("no key: askAI returns null without any request", (await askAI(text)) === null && hits === 0);
const rules = await aiAnalyze("garbage on the road");
check("no key: analyze uses the rule-based fallback", (rules as any).source === "rules", `(${(rules as any).source})`);

process.env.ANTHROPIC_API_KEY = "k"; process.env.AI_MODEL = "claude-sonnet-5-5";
check("old setup (only ANTHROPIC_API_KEY) still selects anthropic", aiConfig().provider === "anthropic" && aiConfig().model === "claude-sonnet-5-5");

clear(); Object.assign(process.env, { AI_API_KEY: "gk", AI_BASE_URL: base, AI_MODEL: "claude-sonnet-5-5" });
check("gemini is the default for AI_API_KEY and a leftover Claude model name is ignored", aiConfig().provider === "gemini" && !/^claude/.test(aiConfig().model), `(${aiConfig().model})`);
hits = 0; let o = await askAI(text, 300);
check("gemini request shape", last!.url.includes("/models/") && last!.url.endsWith(":generateContent") && last!.headers["x-goog-api-key"] === "gk" && last!.body.contents[0].parts[0].text === "hello" && last!.body.generationConfig.maxOutputTokens >= 1024 && !!last!.body.systemInstruction);
check("gemini reply parsed", o?.category === "garbage");
o = await askAI(img, 300);
check("gemini image is sent as inlineData", last!.body.contents[0].parts[0].inlineData?.mimeType === "image/png");
const full = await aiAnalyze("anything");
check("analyze goes through the provider and is labeled ai", (full as any).source === "ai" && full.cat === "garbage" && full.priority === "critical");
const im = await aiImage(PHOTO, "report", "garbage");
check("image check works with gemini", (im as any).source === "ai" && im.label === "garbage pile");

clear(); Object.assign(process.env, { AI_PROVIDER: "groq", AI_API_KEY: "qk", AI_BASE_URL: base });
check("groq defaults", aiConfig().model === "llama-3.3-70b-versatile" && !aiConfig().vision);
hits = 0; o = await askAI(text);
check("openai-style request shape", last!.url.endsWith("/chat/completions") && last!.headers.authorization === "Bearer qk" && last!.body.messages[0].role === "system" && last!.body.messages[1].content === "hello");
check("openai-style reply parsed", o?.category === "garbage");
hits = 0; o = await askAI(img);
check("groq without AI_VISION skips image calls and makes no request", o === null && hits === 0);
const im2 = await aiImage(PHOTO, "report", "garbage");
check("image check falls back to 'Not checked'", (im2 as any).source === "none");
process.env.AI_VISION = "true"; o = await askAI(img);
check("AI_VISION=true sends image_url", Array.isArray(last!.body.messages[1].content) && last!.body.messages[1].content[0].image_url.url.startsWith("data:image/png;base64,"));

clear(); Object.assign(process.env, { AI_PROVIDER: "anthropic", AI_API_KEY: "ak", AI_BASE_URL: base });
o = await askAI(text);
check("anthropic request shape and reply", last!.url === "/v1/messages" && last!.headers["x-api-key"] === "ak" && last!.body.system && o?.category === "garbage");

clear(); Object.assign(process.env, { AI_API_KEY: "gk", AI_BASE_URL: base });
mode = "fenced"; o = await askAI(text);
check("JSON inside a code fence is accepted", o?.category === "water");
mode = "badjson"; o = await askAI(text);
check("invalid JSON gives null (fallback)", o === null);
mode = "404"; o = await askAI(text);
check("HTTP error gives null (fallback)", o === null);
mode = "429"; hits = 0; o = await askAI(text); const after429 = hits; o = await askAI(text);
check("rate limit gives null and pauses further calls", o === null && hits === after429 && after429 === 1, `(requests sent: ${hits})`);
const paused = await aiAnalyze("garbage on the road");
check("while paused, analyze still answers with rules", (paused as any).source === "rules");

server.close(); clear();
if (bad) { console.log(`${bad} AI test(s) failed`); process.exitCode = 1; } else console.log("all AI tests passed");