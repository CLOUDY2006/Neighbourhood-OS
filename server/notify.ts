import { createHash, createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import webpush from "web-push";
import { pool } from "./db";

const VAPID = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
if (VAPID.pub && VAPID.priv) webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.CONTACT_EMAIL || "admin@example.com"}`, VAPID.pub, VAPID.priv);
const mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const TW = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM, wa: process.env.TWILIO_WHATSAPP_FROM };

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const caps = () => ({ push: VAPID.pub && VAPID.priv ? VAPID.pub : null, email: !!mailer, sms: !!(TW.sid && TW.token && TW.from), whatsapp: !!(TW.sid && TW.token && TW.wa), telegram: !!TG_TOKEN });

// ---- Telegram (free, no templates: the bot can message anyone who pressed Start)
export const tgToken = () => TG_TOKEN;
/** The secret Telegram sends back with every update, so only Telegram can call our webhook. */
export const tgSecret = () => createHash("sha256").update(`tg:${TG_TOKEN ?? ""}`).digest("hex").slice(0, 48);
export async function tgApi(method: string, body: Record<string, unknown>): Promise<any> {
  if (!TG_TOKEN) throw new Error("Telegram is not configured on this server");
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!r.ok || !j.ok) throw new Error(`Telegram ${method} failed: ${j.description ?? r.status}`);
  return j.result;
}
export const tgSend = (chatId: string, text: string) => tgApi("sendMessage", { chat_id: chatId, text: text.slice(0, 3500) });
let botName: string | null = null;
export async function tgBot(): Promise<string> { if (!botName) botName = String((await tgApi("getMe", {})).username); return botName; }
/** Called once at startup: points Telegram at this server. Needs PUBLIC_URL. */
export async function tgSetup() {
  if (!TG_TOKEN) return;
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  if (!base) { console.warn("[tg] TELEGRAM_BOT_TOKEN is set but PUBLIC_URL is empty, so the webhook was not registered"); return; }
  try {
    await tgApi("setWebhook", { url: `${base}/api/telegram`, secret_token: tgSecret(), allowed_updates: ["message"] });
    console.log("[tg] webhook set to", `${base}/api/telegram`, "bot:", await tgBot());
  } catch (e) { console.error("[tg] setup failed:", (e as Error).message); }
}
export const twilioReady = () => !!(TW.sid && TW.token);
export const twilioToken = () => TW.token;
/** Basic-auth header for downloading a photo a person sent to the Twilio number. */
export const twilioAuth = () => (TW.sid && TW.token ? `Basic ${Buffer.from(`${TW.sid}:${TW.token}`).toString("base64")}` : "");
export const sign = (url: string, params: Record<string, string>) => createHmac("sha1", TW.token ?? "").update(url + Object.keys(params).sort().map(k => k + params[k]).join("")).digest("base64");

export async function sendText(to: string, body: string, whatsapp = false) {
  const from = whatsapp ? TW.wa : TW.from;
  if (!TW.sid || !TW.token || !from) throw new Error("Messaging is not configured on this server");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW.sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${TW.sid}:${TW.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(whatsapp && process.env.TWILIO_WHATSAPP_TEMPLATE_SID
      ? { To: `whatsapp:${to}`, From: from, ContentSid: process.env.TWILIO_WHATSAPP_TEMPLATE_SID, ContentVariables: JSON.stringify({ "1": body.replace(/\s+/g, " ").slice(0, 600) }) }
      : { To: whatsapp ? `whatsapp:${to}` : to, From: from, Body: body.slice(0, 600) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Messaging provider responded with ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
export interface MailExtra { replyTo?: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }
export async function sendEmail(to: string, subject: string, text: string, extra: MailExtra = {}) {
  if (!mailer) throw new Error("Email is not configured on this server");
  const from = process.env.SMTP_FROM || process.env.CONTACT_EMAIL;
  await mailer.sendMail({ from, to, subject, text, replyTo: extra.replyTo, attachments: extra.attachments });
}

type Msg = { title: string; body: string; urgent?: boolean; kinds?: string[] };
const sentLog = new Map<string, number[]>();
const allowed = (key: string, urgent?: boolean) => {
  if (urgent) return true;
  const now = Date.now(), a = (sentLog.get(key) ?? []).filter(t => now - t < 3600000);
  if (a.length >= 8) return false;
  a.push(now); sentLog.set(key, a); return true;
};

export async function notify(nid: string, who: "all" | "admins" | { name: string }, msg: Msg) {
  try {
    const r = await pool.query("select c.user_id, c.kind, c.target, m.display_name, m.role from channels c join members m on m.user_id = c.user_id and m.neighbourhood_id = c.neighbourhood_id where c.neighbourhood_id = $1 and c.verified", [nid]);
    for (const c of r.rows) {
      if (who === "admins" ? c.role !== "admin" : typeof who === "object" ? c.display_name !== who.name : false) continue;
      if (msg.kinds && !msg.kinds.includes(c.kind)) continue;
      if (!allowed(`${c.user_id}:${nid}`, msg.urgent)) continue;
      try {
        if (c.kind === "push") await webpush.sendNotification(JSON.parse(c.target), JSON.stringify({ title: msg.title, body: msg.body.slice(0, 160), url: "/" }));
        else if (c.kind === "email") await sendEmail(c.target, msg.title, msg.body);
        else if (c.kind === "telegram") await tgSend(c.target, `${msg.title}\n${msg.body}`);
        else if (c.kind === "sms" || c.kind === "whatsapp") await sendText(c.target, `${msg.title}: ${msg.body}`, c.kind === "whatsapp");
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (c.kind === "push" && (code === 404 || code === 410)) await pool.query("delete from channels where user_id = $1 and neighbourhood_id = $2 and kind = 'push'", [c.user_id, nid]);
        else console.warn(`Notify ${c.kind} failed:`, (e as Error).message);
      }
    }
  } catch (e) { console.error("notify failed:", e); }
}