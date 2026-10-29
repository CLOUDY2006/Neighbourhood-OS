import { CATS, isEmail } from "../src/logic";
import { DIRECTORY, regionFor, suggestionsFor } from "../src/authorityDirectory";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };

// ---- every entry is complete
for (const r of DIRECTORY) for (const e of r.entries) {
  check(`${e.id}: the address is a valid email`, isEmail(e.email), e.email);
  check(`${e.id}: the source is an https link`, /^https:\/\/[^\s]+$/.test(e.source), e.source);
  check(`${e.id}: it says whether the address is official or from records`, e.via === "official" || e.via === "records");
  check(`${e.id}: it has a check date`, /^\d{4}-\d{2}-\d{2}$/.test(e.checked), e.checked);
  check(`${e.id}: it covers at least one kind of report`, Object.keys(e.for).length > 0);
  check(`${e.id}: every kind it names is a real category`, Object.keys(e.for).every(k => (CATS as string[]).includes(k)));
}
check("no two entries share an id", new Set(DIRECTORY.flatMap(r => r.entries.map(e => e.id))).size === DIRECTORY.flatMap(r => r.entries.map(e => e.id)).length);
check("no address is listed twice", new Set(DIRECTORY.flatMap(r => r.entries.map(e => e.email.toLowerCase()))).size === DIRECTORY.flatMap(r => r.entries.map(e => e.email)).length);

// ---- which state gets which list
for (const s of ["Delhi", "delhi", "NCT of Delhi", "National Capital Territory of Delhi", "  DELHI  "]) check(`"${s}" is Delhi`, regionFor(s)?.id === "delhi");
// Nearby places that are not Delhi must never get Delhi addresses.
for (const s of ["Haryana", "Uttar Pradesh", "Rajasthan", "Maharashtra", "Karnataka", "", "   "]) check(`"${s}" gets no list`, regionFor(s) === null);

// ---- the right office for each kind of report
const delhi = regionFor("Delhi")!;
for (const c of CATS) check(`Delhi has a suggestion for ${c}`, suggestionsFor(delhi, c).length > 0);
check("water goes to the Delhi Jal Board first", suggestionsFor(delhi, "water")[0]?.id === "delhi-djb");
check("water is not sent to PWD or MCD", suggestionsFor(delhi, "water").length === 1);
check("garbage goes to MCD first", suggestionsFor(delhi, "garbage")[0]?.id === "delhi-mcd");
check("potholes offer MCD first (most streets are MCD roads) and PWD second", suggestionsFor(delhi, "pothole").map(e => e.id).join() === "delhi-mcd,delhi-pwd");
check("streetlights offer MCD first and PWD second", suggestionsFor(delhi, "streetlight").map(e => e.id).join() === "delhi-mcd,delhi-pwd");
check("with no kind given, every office is returned", suggestionsFor(delhi).length === delhi.entries.length);
check("suggestions are a copy, so the list cannot be changed by accident", (() => { const a = suggestionsFor(delhi); a.pop(); return suggestionsFor(delhi).length === delhi.entries.length; })());

if (bad) { console.log(`\n${bad} authority directory check(s) failed`); process.exit(1); }
console.log("\nall authority directory tests passed");