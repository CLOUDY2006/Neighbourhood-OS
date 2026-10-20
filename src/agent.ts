import type { Cat, Doc, Issue, Priority } from "./logic";
import { routeFor } from "./routes";
import { osmLink } from "./geo";

export const CAT_EN: Record<Cat, string> = { pothole: "Road damage", garbage: "Garbage problem", streetlight: "Faulty street light", water: "Water leak or supply problem", unsafe: "Safety hazard", blocked: "Blocked road", other: "Civic problem" };
export const CAT_HI: Record<Cat, string> = { pothole: "सड़क पर गड्ढा", garbage: "कचरे और गंदगी की समस्या", streetlight: "खराब स्ट्रीट लाइट", water: "पानी के रिसाव या आपूर्ति की समस्या", unsafe: "असुरक्षित और खतरनाक स्थिति", blocked: "रास्ता अवरुद्ध", other: "नागरिक समस्या" };
const PHRASE: Record<Cat, string> = {
  pothole: "A road has damage or potholes", garbage: "Garbage has piled up on the street", streetlight: "Street lights are not working",
  water: "There is a water leak or supply problem", unsafe: "There is a safety hazard", blocked: "A road or path is blocked", other: "A civic problem was reported",
};

const HI: Record<Cat, string[]> = {
  garbage: ["कचरा", "कचरे", "कूड़ा", "कूड़े", "गंदगी", "गंदा", "बदबू", "सफाई", "कचरापेटी"],
  streetlight: ["बत्ती", "स्ट्रीट लाइट", "स्ट्रीटलाइट", "लाइट", "रोशनी", "अंधेरा", "खंभा", "खंभे"],
  water: ["पानी", "लीक", "रिसाव", "पाइप", "पाइपलाइन", "जलभराव", "नल", "टंकी", "सीवर", "नाली"],
  pothole: ["गड्ढा", "गड्ढे", "गड्ढों", "टूटी सड़क", "सड़क टूट", "सड़क"],
  unsafe: ["मैनहोल", "नंगा तार", "खुला तार", "करंट", "खतरनाक", "असुरक्षित", "आवारा", "खतरा"],
  blocked: ["रास्ता बंद", "सड़क बंद", "रास्ता रुका", "पेड़ गिरा", "गिरा हुआ पेड़", "अवरुद्ध", "रुकावट", "जाम"],
  other: [],
};
const EN: Record<Cat, string[]> = {
  pothole: ["pothole", "crater", "road", "broken road"], garbage: ["garbage", "trash", "waste", "bin", "litter", "dump", "smell"],
  streetlight: ["streetlight", "street light", "lamp", "light", "dark"], water: ["water", "leak", "pipe", "flood", "tanker", "sewer", "drain"],
  unsafe: ["manhole", "wire", "live wire", "electric", "unsafe", "danger", "stray"],
  blocked: ["blocked", "road closed", "fallen tree", "tree fell", "obstruction", "barricade", "jam"], other: [],
};
const URGENT = ["बच्चे", "बच्चों", "बीमार", "तुरंत", "जल्दी", "खतरा", "खतरनाक", "urgent", "children", "kids", "sick", "danger", "emergency", "accident"];
const CRITICAL = ["मैनहोल", "करंट", "नंगा तार", "manhole", "live wire", "electric shock"];

export interface Analysis { lang: "hi" | "en" | "other"; cat: Cat; priority: Priority; summaryEn: string; source: "ai" | "rules" }

export function detectLang(text: string): "hi" | "en" | "other" {
  const letters = [...text].filter(c => /\p{L}/u.test(c));
  if (!letters.length) return "en";
  const dev = letters.filter(c => /[\u0900-\u097F]/.test(c)).length / letters.length;
  const lat = letters.filter(c => /[A-Za-z]/.test(c)).length / letters.length;
  return dev > 0.3 ? "hi" : lat > 0.6 ? "en" : "other";
}

export function understand(text: string): Analysis {
  const t = text.toLowerCase(), lang = detectLang(text);
  let cat: Cat = "other", best = 0;
  (Object.keys(HI) as Cat[]).forEach(c => {
    const n = HI[c].filter(k => text.includes(k)).length + EN[c].filter(k => t.includes(k)).length;
    if (n > best) { best = n; cat = c; }
  });
  const priority: Priority = CRITICAL.some(k => t.includes(k)) ? "critical" : URGENT.some(k => t.includes(k)) ? "high" : "medium";
  const extra = priority === "high" || priority === "critical" ? " Residents mention a health or safety concern." : "";
  return { lang, cat, priority, summaryEn: `${PHRASE[cat]}${lang === "hi" ? " (reported in Hindi)" : ""}.${extra}`, source: "rules" };
}

export interface DraftInput {
  lang: "en" | "hi"; level: number; to: string; nbhd: string; cat: Cat; summaryEn: string; original?: string;
  lat: number; lng: number; reports: number; created: number; hasPhoto: boolean; verified: boolean;
  prev?: { to: string; sentAt: number; ref?: string };
}
const fmt = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function draftComplaint(a: DraftInput): { subject: string; body: string } {
  const route = routeFor(a.cat), map = osmLink(a.lat, a.lng);
  if (a.lang === "hi") {
    const problem = a.original && /[\u0900-\u097F]/.test(a.original) ? a.original : a.summaryEn;
    const lines = [
      `प्रति: ${a.to}`, "", `विषय: ${a.nbhd} में ${CAT_HI[a.cat]}${a.level > 0 ? " (अनुवर्ती शिकायत)" : ""}`, "", "महोदय/महोदया,", "",
      `हम ${a.nbhd} के निवासी आपका ध्यान इस समस्या की ओर आकर्षित करना चाहते हैं: ${problem}`, "",
      `स्थान: ${map}`, `पहली बार रिपोर्ट किया गया: ${fmt(a.created)}`, `इस समस्या की पुष्टि करने वाले निवासी: ${a.reports}`,
    ];
    if (a.hasPhoto) lines.push("फोटो उपलब्ध है और माँगने पर साझा की जा सकती है।");
    if (a.verified) lines.push("मोहल्ले के समन्वयक ने इस रिपोर्ट की समीक्षा की है।");
    lines.push("", `कृपया स्थल का निरीक्षण कर ${route.deadlineDays} दिनों के भीतर समस्या का समाधान करें तथा शिकायत संख्या और की गई कार्रवाई की जानकारी साझा करें।`);
    if (a.prev) lines.push("", `यह अनुवर्ती शिकायत है। ${fmt(a.prev.sentAt)} को ${a.prev.to} को भेजी गई हमारी पिछली शिकायत${a.prev.ref ? ` (संदर्भ संख्या ${a.prev.ref})` : ""} का समाधान नहीं हुआ है।`);
    lines.push("", "धन्यवाद।", `मोहल्ला समन्वयक, ${a.nbhd}`);
    return { subject: `${a.nbhd} में ${CAT_HI[a.cat]}${a.level > 0 ? " (अनुवर्ती शिकायत)" : ""}`, body: lines.join("\n") };
  }
  const lines = [
    `To: ${a.to}`, "", `Subject: ${CAT_EN[a.cat]} at ${a.nbhd}${a.level > 0 ? " (follow-up)" : ""}`, "", "Respected Sir/Madam,", "",
    `On behalf of the residents of ${a.nbhd}, we are writing about the following problem: ${a.summaryEn}`, "",
    `Location: ${map}`, `First reported: ${fmt(a.created)}`, `Residents who confirmed the problem: ${a.reports}`,
  ];
  if (a.hasPhoto) lines.push("A photo is available and can be shared on request.");
  if (a.verified) lines.push("A neighbourhood coordinator has reviewed this report.");
  lines.push("", `We request you to inspect the site, resolve the problem within ${route.deadlineDays} days, and share the complaint number and the action taken.`);
  if (a.prev) lines.push("", `This is a follow-up. Our earlier complaint to ${a.prev.to} on ${fmt(a.prev.sentAt)}${a.prev.ref ? ` (reference ${a.prev.ref})` : ""} has not been resolved.`);
  lines.push("", "Thank you.", `Community coordinators, ${a.nbhd}`);
  return { subject: `${CAT_EN[a.cat]} at ${a.nbhd}${a.level > 0 ? " (follow-up)" : ""}`, body: lines.join("\n") };
}

export function proposeMission(i: Pick<Issue, "cat" | "title">) {
  const short = i.title.length > 50 ? i.title.slice(0, 49) + "…" : i.title;
  switch (i.cat) {
    case "garbage": return { title: `Community cleanup: ${short}`, need: 6, safety: "Bring gloves and bags. Do not handle sharp, medical or chemical waste." };
    case "water": return { title: `Follow-up crew: ${short}`, need: 2, safety: "Do not touch pipes or valves. Document the problem and follow up with the water department." };
    case "streetlight": return { title: `Follow-up crew: ${short}`, need: 2, safety: "Never touch electrical equipment. Document and follow up with the department." };
    case "pothole": return { title: `Follow-up crew: ${short}`, need: 2, safety: "Place a visible warning only if it is safe to do so." };
    case "blocked": return { title: `Follow-up crew: ${short}`, need: 2, safety: "Do not try to move large objects such as trees. Warn others from a safe distance and contact the authority." };
    case "unsafe": return { title: `Follow-up crew: ${short}`, need: 2, safety: "Keep people away from the hazard and contact the authority. Do not try to repair it." };
    default: return { title: `Community follow-up: ${short}`, need: 3, safety: "Stay safe and follow the coordinator's instructions." };
  }
}

export interface Step { id: string; label: string; done: boolean; note?: string }
export function workflow(d: Doc, i: Issue) {
  const a = i.agent, m = d.missions.find(x => x.id === i.missionId), sent = !!a && a.history.length > 0;
  const steps: Step[] = [
    { id: "understood", label: "Report understood", done: !!a, note: a ? `${a.lang === "hi" ? "Hindi" : a.lang === "en" ? "English" : "Other language"}, ${a.source}` : undefined },
    { id: "dups", label: "Duplicates checked", done: !!a, note: i.reports > 1 ? `${i.reports} reports merged` : "No duplicates" },
    { id: "route", label: "Complaint route chosen", done: !!a, note: a ? routeFor(i.cat).authority : undefined },
    { id: "draft", label: "Complaint drafted", done: !!a?.draft },
    { id: "approved", label: "Approved by a person", done: !!a && (!!a.draft.approvedAt || sent) },
    { id: "sent", label: "Sent to the authority", done: sent, note: sent ? a!.history[a!.history.length - 1].to : undefined },
    { id: "ref", label: "Reference number received", done: !!i.handoff?.ref, note: i.handoff?.ref || undefined },
    { id: "mission", label: "Community mission created", done: !!m, note: m?.title },
    { id: "volunteers", label: "Volunteers joined", done: !!m && m.joined.length >= 1, note: m ? `${m.joined.length} of ${m.need}` : undefined },
    { id: "proof", label: "Proof of fix uploaded", done: i.proof.length > 0 },
    { id: "verified", label: "Verified resolved", done: i.status === "resolved" && i.verif === "resolved" },
  ];
  const done = steps.filter(s => s.done).length;
  return { steps, done, total: steps.length, current: steps.findIndex(s => !s.done) };
}